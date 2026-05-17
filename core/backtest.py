"""
core/backtest.py
Backtest engine: validate decision cards against historical data

支持 A 股（akshare）、港股（yfinance）、美股（yfinance）。
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
    # 新增：用于条件细分统计
    bull_confidence: Optional[float] = None
    bear_confidence: Optional[float] = None
    preemption_score: Optional[float] = None

    def to_dict(self):
        return asdict(self)


def _parse_kill_switch(kill_switch) -> Optional[float]:
    """统一解析 kill_switch，返回止损百分比（如 0.05=5%），None=无止损。"""
    if not kill_switch or str(kill_switch).strip().upper() in ("N/A", "无", "NONE", ""):
        return None
    ks = str(kill_switch).lower()
    # "Stop loss 5%"
    m = re.search(r'stop\s*loss\s*(\d+\.?\d*)\s*%', ks)
    if m:
        return float(m.group(1)) / 100.0
    # "-8.5%" 或 "8.5%"
    m = re.search(r'[-]?\s*(\d+\.?\d*)\s*%', ks)
    if m:
        return abs(float(m.group(1))) / 100.0
    # 纯数字（如 8.5）
    m = re.search(r'(\d+\.?\d*)', ks)
    if m:
        val = float(m.group(1))
        return val / 100.0 if val > 1 else val
    return None


def _parse_holding_period(holding_period) -> int:
    """统一解析 holding_period，返回天数，默认 5。"""
    if not holding_period or str(holding_period).strip().upper() in ("N/A", "无", "NONE", ""):
        return 5
    hp = str(holding_period).upper()
    if hp.startswith("T+"):
        try:
            return int(hp.replace("T+", "").strip())
        except ValueError:
            pass
    if hp.startswith("T-"):
        try:
            return int(hp.replace("T-", "").strip())
        except ValueError:
            pass
    m = re.search(r'(\d+)', hp)
    if m:
        return int(m.group(1))
    return 5


class BacktestEngine:
    def __init__(self, tickers: List[str] = None, start_date: str = "2024-01-01",
                 end_date: str = None, initial_capital: float = 100000.0,
                 position_size: float = 0.2):
        self.tickers = tickers or []
        self.start_date = start_date
        self.end_date = end_date or datetime.now().strftime("%Y-%m-%d")
        self.initial_capital = initial_capital
        self.position_size = position_size
        self.trades: List[TradeRecord] = []
        self.capital_history: List[Dict] = []
        self.price_cache: Dict[str, pd.DataFrame] = {}

    def _load_history(self, ticker: str) -> pd.DataFrame:
        if ticker in self.price_cache:
            return self.price_cache[ticker]

        # A 股：优先 akshare（更准）
        if ticker.endswith(".SS") or ticker.endswith(".SZ"):
            code = ticker.split(".")[0]
            try:
                import akshare as ak
                df = ak.stock_zh_a_hist(
                    symbol=code, period="daily",
                    start_date=self.start_date.replace("-", ""),
                    end_date=self.end_date.replace("-", ""),
                    adjust="qfq",
                )
                if not df.empty:
                    df = df.rename(columns={
                        "日期": "Date", "开盘": "Open", "收盘": "Close",
                        "最高": "High", "最低": "Low", "成交量": "Volume",
                    })
                    df["Date"] = pd.to_datetime(df["Date"])
                    df.set_index("Date", inplace=True)
                    self.price_cache[ticker] = df
                    return df
            except Exception as e:
                print(f"[Backtest] akshare 获取 {ticker} 失败，fallback yfinance: {e}")

        # 港股 / 美股 / fallback：yfinance
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
                          kill_switch, holding_days: int, entry_price: float) -> tuple:
        df = self._load_history(ticker)
        try:
            entry_idx = df.index.get_loc(pd.Timestamp(entry_date))
        except Exception:
            return False, "", 0

        stop_pct = _parse_kill_switch(kill_switch)

        for i in range(1, min(holding_days + 1, len(df) - entry_idx)):
            current_idx = entry_idx + i
            current_price = float(df["Close"].iloc[current_idx])

            if stop_pct is not None:
                move = (current_price - entry_price) / entry_price
                if move <= -stop_pct or move >= stop_pct:
                    return True, f"Stop loss at {round(current_price, 2)}", i

            if i >= holding_days:
                return False, "Holding period reached", i

        last_idx = min(entry_idx + holding_days, len(df) - 1)
        return False, "End of data", last_idx - entry_idx

    def run_trade(self, entry_date: str, decision: str, ticker: str,
                  conviction: float, kill_switch, holding_period,
                  thesis: str, entry_price: float = None,
                  bull_confidence: float = None,
                  bear_confidence: float = None,
                  preemption_score: float = None) -> Optional[TradeRecord]:
        # 优先使用传入的 entry_price（决策卡中的 price），否则从行情获取
        if entry_price is None:
            entry_price = self.get_price_on_date(ticker, entry_date)
        if entry_price is None:
            return None

        days = _parse_holding_period(holding_period)

        hit_ks, ks_reason, actual_days = self.check_kill_switch(
            ticker, entry_date, kill_switch, days, entry_price)

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
            thesis=thesis[:200] if thesis else "",
            bull_confidence=bull_confidence,
            bear_confidence=bear_confidence,
            preemption_score=preemption_score,
        )

    def run_full_backtest(self, decision_cards: List[Dict]) -> Dict:
        skipped = 0
        for card in decision_cards:
            if card.get("decision", "").lower() == "neutral":
                continue

            ticker = self._infer_ticker(card)
            if not ticker:
                skipped += 1
                continue

            timestamp = card.get("timestamp", "")
            entry_date = timestamp[:10] if isinstance(timestamp, str) and len(timestamp) >= 10 else ""
            if not entry_date:
                skipped += 1
                continue

            try:
                trade = self.run_trade(
                    entry_date=entry_date,
                    decision=card.get("decision", "").lower(),
                    ticker=ticker,
                    conviction=card.get("conviction", 0),
                    kill_switch=card.get("kill_switch", ""),
                    holding_period=card.get("holding_period", "T+5"),
                    thesis=card.get("thesis", ""),
                    entry_price=card.get("price"),
                    bull_confidence=card.get("bull_confidence"),
                    bear_confidence=card.get("bear_confidence"),
                    preemption_score=card.get("preemption_score"),
                )
                if trade:
                    self.trades.append(trade)
                else:
                    skipped += 1
            except Exception as e:
                code = card.get("code", "?")
                print(f"[Backtest] Skip {code}@{entry_date}: {e}")
                skipped += 1
                continue

        if skipped > 0:
            print(f"[Backtest] Skipped {skipped} cards due to data unavailable or invalid")
        return self._calculate_stats()

    def _infer_ticker(self, card: Dict) -> Optional[str]:
        """从决策卡推断 yfinance/akshare 可用的 ticker。"""
        code = card.get("code", "")
        market = card.get("market", "")
        if not code:
            # fallback：从 thesis 文本推断美股
            text = card.get("thesis", "") + " " + " ".join(card.get("anomaly_triggers", []))
            ticker_map = {
                "GOOGL": "GOOGL", "Alphabet": "GOOGL",
                "META": "META", "Meta": "META",
                "MSFT": "MSFT", "Microsoft": "MSFT",
                "AMZN": "AMZN", "Amazon": "AMZN",
                "NVDA": "NVDA", "NVIDIA": "NVDA",
                "TSLA": "TSLA", "Tesla": "TSLA",
                "AAPL": "AAPL", "Apple": "AAPL",
            }
            for key, ticker in ticker_map.items():
                if key in text:
                    return ticker
            return None

        # A 股
        if market == "a" or (len(code) == 6 and code.isdigit()):
            if code.startswith("6") or code.startswith("5"):
                return code + ".SS"
            return code + ".SZ"
        # 港股
        if market == "hk" or len(code) == 5:
            return code + ".HK"
        # 美股（纯字母代码）
        if code.isalpha():
            return code.upper()
        return None

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

        # 按置信度分组
        def group_by_conviction(trades):
            high = [t for t in trades if t.conviction >= 70]
            mid = [t for t in trades if 40 <= t.conviction < 70]
            low = [t for t in trades if t.conviction < 40]
            return {
                "high_confidence(>=70)": calc_metrics(high),
                "mid_confidence(40-69)": calc_metrics(mid),
                "low_confidence(<40)": calc_metrics(low),
            }

        # 按 Preemption 分组（如果有数据）
        def group_by_preemption(trades):
            has_pre = [t for t in trades if t.preemption_score is not None]
            high = [t for t in has_pre if t.preemption_score >= 60]
            mid = [t for t in has_pre if 30 <= t.preemption_score < 60]
            low = [t for t in has_pre if t.preemption_score < 30]
            return {
                "preemption_high(>=60)": calc_metrics(high),
                "preemption_mid(30-59)": calc_metrics(mid),
                "preemption_low(<30)": calc_metrics(low),
            }

        return {
            "period": self.start_date + " to " + self.end_date,
            "total_trades": len(self.trades),
            "longs": calc_metrics(longs),
            "shorts": calc_metrics(shorts),
            "combined": calc_metrics(self.trades),
            "by_conviction": group_by_conviction(self.trades),
            "by_preemption": group_by_preemption(self.trades),
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
