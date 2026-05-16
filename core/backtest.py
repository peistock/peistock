"""
core/backtest.py
Backtest engine: validate decision cards against historical data
"""
import json
import os
import re
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import yfinance as yf
import pandas as pd


@dataclass
class TradeRecord:
    entry_date: str
    decision: str  # long / short / neutral
    conviction: float
    ticker: str
    entry_price: float
    exit_date: str
    exit_price: float
    pnl_pct: float
    hit_kill_switch: bool
    kill_switch_reason: str
    holding_period: int  # days
    thesis: str
    
    def to_dict(self):
        return asdict(self)


class BacktestEngine:
    def __init__(self, tickers: List[str], start_date: str, end_date: str,
                 initial_capital: float = 100000.0, position_size: float = 0.2):
        self.tickers = tickers
        self.start_date = start_date
        self.end_date = end_date
        self.initial_capital = initial_capital
        self.position_size = position_size
        self.trades: List[TradeRecord] = []
        self.capital_history: List[Dict] = []
        self.price_cache: Dict[str, pd.DataFrame] = {}
        
    def _load_history(self, ticker: str) -> pd.DataFrame:
        if ticker in self.price_cache:
            return self.price_cache[ticker]
        df = yf.download(ticker, start=self.start_date, end=self.end_date, progress=False)
        if df.empty:
            raise ValueError("No data for " + ticker)
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
        self.price_cache[ticker] = df
        return df
        
    def get_price_on_date(self, ticker: str, date_str: str) -> Optional[float]:
        df = self._load_history(ticker)
        mask = df.index.strftime("%Y-%m-%d") == date_str
        if mask.any():
            return float(df.loc[mask, "Close"].iloc[0])
        return None
        
    def get_price_after_days(self, ticker: str, date_str: str, days: int) -> Optional[float]:
        df = self._load_history(ticker)
        try:
            idx = df.index.get_loc(pd.Timestamp(date_str))
            target_idx = idx + days
            if target_idx < len(df):
                return float(df["Close"].iloc[target_idx])
        except Exception:
            pass
        return None
        
    def check_kill_switch(self, ticker: str, entry_date: str, 
                         kill_switch: str, holding_days: int) -> tuple:
        df = self._load_history(ticker)
        try:
            entry_idx = df.index.get_loc(pd.Timestamp(entry_date))
        except Exception:
            return False, "", 0
            
        ks_lower = kill_switch.lower()
        stop_pct = None
        m = re.search(r'stop\s*loss\s*(\d+\.?\d*)\s*%', ks_lower)
        if m:
            try:
                stop_pct = float(m.group(1)) / 100.0
            except ValueError:
                stop_pct = None

        for i in range(1, min(holding_days + 1, len(df) - entry_idx)):
            current_idx = entry_idx + i
            current_price = float(df["Close"].iloc[current_idx])
            entry_price = float(df["Close"].iloc[entry_idx])

            if stop_pct is not None:
                # long: price drop > stop_pct; short: price rise > stop_pct
                move = (current_price - entry_price) / entry_price
                if move <= -stop_pct or move >= stop_pct:
                    return True, "Stop loss at " + str(round(current_price, 2)), i

            if "drops below" in ks_lower:
                threshold = entry_price * 0.95
                if current_price < threshold:
                    return True, "Stop loss at " + str(round(current_price, 2)), i

            if "reverses" in ks_lower:
                if current_price < entry_price * 0.97:
                    return True, "Reversal triggered", i

            if i >= holding_days:
                return False, "Holding period reached", i
                
        last_idx = min(entry_idx + holding_days, len(df) - 1)
        return False, "End of data", last_idx - entry_idx
        
    def run_trade(self, entry_date: str, decision: str, ticker: str,
                  conviction: float, kill_switch: str, holding_period: str,
                  thesis: str) -> Optional[TradeRecord]:
        entry_price = self.get_price_on_date(ticker, entry_date)
        if entry_price is None:
            return None
            
        days = 5
        if holding_period.upper().startswith("T+"):
            try:
                days = int(holding_period.replace("T+", "").replace("T-", ""))
            except Exception:
                pass
                
        hit_ks, ks_reason, actual_days = self.check_kill_switch(
            ticker, entry_date, kill_switch, days)
            
        exit_date = (datetime.strptime(entry_date, "%Y-%m-%d") + timedelta(days=actual_days)).strftime("%Y-%m-%d")
        exit_price = self.get_price_after_days(ticker, entry_date, actual_days)
        if exit_price is None:
            return None
            
        if decision == "long":
            pnl = (exit_price - entry_price) / entry_price * 100
        elif decision == "short":
            pnl = (entry_price - exit_price) / entry_price * 100
        else:
            pnl = 0.0
            
        return TradeRecord(
            entry_date=entry_date,
            decision=decision,
            conviction=conviction,
            ticker=ticker,
            entry_price=round(entry_price, 2),
            exit_date=exit_date,
            exit_price=round(exit_price, 2),
            pnl_pct=round(pnl, 2),
            hit_kill_switch=hit_ks,
            kill_switch_reason=ks_reason,
            holding_period=actual_days,
            thesis=thesis[:100]
        )
        
    def run_full_backtest(self, decision_cards: List[Dict]) -> Dict:
        for card in decision_cards:
            if card.get("decision") == "neutral":
                continue
                
            ticker = self._infer_ticker(card)
            if not ticker:
                continue
                
            trade = self.run_trade(
                entry_date=card.get("timestamp", "")[:10],
                decision=card["decision"],
                ticker=ticker,
                conviction=card.get("conviction", 0),
                kill_switch=card.get("kill_switch", ""),
                holding_period=card.get("holding_period", "T+5"),
                thesis=card.get("thesis", "")
            )
            if trade:
                self.trades.append(trade)
                
        return self._calculate_stats()
        
    def _infer_ticker(self, card: Dict) -> Optional[str]:
        text = card.get("thesis", "") + " " + " ".join(card.get("anomaly_triggers", []))
        ticker_map = {
            "GOOGL": "GOOGL", "Alphabet": "GOOGL",
            "META": "META", "Meta": "META",
            "MSFT": "MSFT", "Microsoft": "MSFT",
            "AMZN": "AMZN", "Amazon": "AMZN",
            "NVDA": "NVDA", "NVIDIA": "NVDA",
            "AAPL": "AAPL", "Apple": "AAPL",
        }
        for key, ticker in ticker_map.items():
            if key in text:
                return ticker
        return "AAPL"
        
    def _calculate_stats(self) -> Dict:
        if not self.trades:
            return {"message": "No trades executed"}
            
        longs = [t for t in self.trades if t.decision == "long"]
        shorts = [t for t in self.trades if t.decision == "short"]
        
        def calc_metrics(trades):
            if not trades:
                return {}
            pnls = [t.pnl_pct for t in trades]
            wins = [p for p in pnls if p > 0]
            losses = [p for p in pnls if p <= 0]
            return {
                "count": len(trades),
                "win_rate": round(len(wins) / len(trades) * 100, 1) if trades else 0,
                "avg_pnl": round(sum(pnls) / len(pnls), 2) if pnls else 0,
                "avg_win": round(sum(wins) / len(wins), 2) if wins else 0,
                "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0,
                "max_pnl": round(max(pnls), 2) if pnls else 0,
                "min_pnl": round(min(pnls), 2) if pnls else 0,
                "total_pnl": round(sum(pnls), 2),
                "kill_switch_rate": round(sum(1 for t in trades if t.hit_kill_switch) / len(trades) * 100, 1),
            }
            
        return {
            "period": self.start_date + " to " + self.end_date,
            "total_trades": len(self.trades),
            "longs": calc_metrics(longs),
            "shorts": calc_metrics(shorts),
            "combined": calc_metrics(self.trades),
        }
        
    def save_report(self, path: str = "data/backtest_report.json"):
        report = {
            "stats": self._calculate_stats(),
            "trades": [t.to_dict() for t in self.trades],
        }
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        return path
