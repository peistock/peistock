#!/usr/bin/env python3
"""
main_backtest.py
Backtest entry: validate RebelResearchOS decisions against historical data

两种模式：
  --mock   使用模拟决策（演示用）
  --real   读取 data/stock_decisions/*.json 真实 AI 决策卡
"""
import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.backtest import BacktestEngine


def load_decision_cards(path="data/decision_history.json"):
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_real_decisions(decisions_dir="data/stock_decisions"):
    """扫描 data/stock_decisions/*.json，读取真实 AI 决策卡。"""
    decisions = []
    p = Path(decisions_dir)
    if not p.exists():
        print(f"[Warning] 决策卡目录不存在: {decisions_dir}")
        return decisions

    for fpath in sorted(p.glob("*.json")):
        try:
            card = json.loads(fpath.read_text(encoding="utf-8"))
            # 从文件名提取日期作为 fallback
            # 文件名格式: <code>_<YYYYMMDD>.json
            date_from_name = ""
            stem = fpath.stem  # e.g. "600989_20260513"
            parts = stem.split("_")
            if len(parts) >= 2 and parts[-1].isdigit() and len(parts[-1]) == 8:
                date_from_name = f"{parts[-1][:4]}-{parts[-1][4:6]}-{parts[-1][6:8]}"

            timestamp = card.get("timestamp", "")
            entry_date = ""
            if isinstance(timestamp, str) and len(timestamp) >= 10:
                entry_date = timestamp[:10]
            elif date_from_name:
                entry_date = date_from_name
            else:
                continue

            decision = str(card.get("decision", "")).strip()
            if not decision:
                continue

            decisions.append({
                "code": card.get("code", ""),
                "market": card.get("market", ""),
                "name": card.get("name", ""),
                "decision": decision.lower(),
                "conviction": float(card.get("conviction", 0) or 0),
                "price": card.get("price"),
                "kill_switch": card.get("kill_switch", ""),
                "holding_period": card.get("holding_period", "T+5"),
                "thesis": card.get("thesis", ""),
                "timestamp": entry_date + "T00:00:00",
                "bull_confidence": card.get("bull_confidence"),
                "bear_confidence": card.get("bear_confidence"),
                "preemption_score": card.get("preemption_score"),
                "macro_industry_score": card.get("macro_industry_score"),
                "weighted_score": card.get("weighted_score"),
                "sentiment_rating": card.get("sentiment_rating"),
            })
        except Exception as e:
            print(f"[Warning] 读取决策卡失败 {fpath}: {e}")
            continue

    return decisions


def generate_mock_decisions():
    """Generate mock decision cards for backtest demo"""
    decisions = []
    base_date = datetime(2025, 1, 1)
    for i in range(20):
        date = (base_date + timedelta(days=i*5)).strftime("%Y-%m-%d")
        decisions.append({
            "timestamp": date + "T08:00:00",
            "decision": "long" if i % 3 != 0 else "short",
            "conviction": 75.0,
            "thesis": "Mag7 dispersion spike - " + ("GOOGL" if i % 2 == 0 else "NVDA") + " leadership rotation",
            "kill_switch": "Stop loss 5%",
            "holding_period": "T+5",
            "anomaly_triggers": ["dispersion_spike"],
        })
    return decisions


def print_stats(stats: dict):
    """打印回测统计结果到控制台。"""
    combined = stats.get("combined", {})
    if not combined:
        print("  No trades executed.")
        return

    print("\n" + "=" * 60)
    print("  BACKTEST RESULTS")
    print("=" * 60)
    print("\n  Period:        " + stats.get("period", ""))
    print("  Total Trades:  " + str(stats.get("total_trades", 0)))

    print("\n  --- Combined ---")
    print("  Win Rate:      " + str(combined.get("win_rate", 0)) + "%")
    print("  Avg PnL:       " + str(combined.get("avg_pnl", 0)) + "%")
    print("  Avg Win:       " + str(combined.get("avg_win", 0)) + "%")
    print("  Avg Loss:      " + str(combined.get("avg_loss", 0)) + "%")
    print("  Max PnL:       " + str(combined.get("max_pnl", 0)) + "%")
    print("  Min PnL:       " + str(combined.get("min_pnl", 0)) + "%")
    print("  Total PnL:     " + str(combined.get("total_pnl", 0)) + "%")
    print("  Kill Switch:   " + str(combined.get("kill_switch_rate", 0)) + "%")

    longs = stats.get("longs", {})
    if longs:
        print("\n  --- Longs ---")
        print("  Count:         " + str(longs.get("count", 0)))
        print("  Win Rate:      " + str(longs.get("win_rate", 0)) + "%")
        print("  Avg PnL:       " + str(longs.get("avg_pnl", 0)) + "%")

    shorts = stats.get("shorts", {})
    if shorts:
        print("\n  --- Shorts ---")
        print("  Count:         " + str(shorts.get("count", 0)))
        print("  Win Rate:      " + str(shorts.get("win_rate", 0)) + "%")
        print("  Avg PnL:       " + str(shorts.get("avg_pnl", 0)) + "%")

    # 按置信度分组
    by_conv = stats.get("by_conviction", {})
    if by_conv:
        print("\n  --- By Conviction ---")
        for label, metrics in by_conv.items():
            if metrics:
                print(f"  {label}: count={metrics.get('count',0)}, win_rate={metrics.get('win_rate',0)}%, avg_pnl={metrics.get('avg_pnl',0)}%")

    # 按 Preemption 分组
    by_prep = stats.get("by_preemption", {})
    if by_prep:
        print("\n  --- By Preemption Score ---")
        for label, metrics in by_prep.items():
            if metrics:
                print(f"  {label}: count={metrics.get('count',0)}, win_rate={metrics.get('win_rate',0)}%, avg_pnl={metrics.get('avg_pnl',0)}%")

    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="RebelResearchOS Backtest")
    parser.add_argument("--start", default="2024-01-01", help="Backtest start date")
    parser.add_argument("--end", default="", help="Backtest end date (default today)")
    parser.add_argument("--decisions", default="", help="Path to decision history JSON")
    parser.add_argument("--mock", action="store_true", help="Use mock decisions for demo")
    parser.add_argument("--real", action="store_true", help="Use real AI decision cards from data/stock_decisions/")
    args = parser.parse_args()

    print("=" * 60)
    print("  RebelResearchOS - Backtest Engine")
    print("=" * 60)

    # Load decisions
    if args.real:
        print("[Mode] Reading real AI decision cards from data/stock_decisions/")
        decisions = load_real_decisions()
    elif args.mock:
        print("[Mode] Using mock decisions for demo")
        decisions = generate_mock_decisions()
    elif args.decisions:
        print("[Mode] Loading decisions from " + args.decisions)
        decisions = load_decision_cards(args.decisions)
    else:
        print("[Error] No decisions provided. Use --mock, --real, or --decisions")
        return

    print(f"  Loaded {len(decisions)} decision cards")
    if not decisions:
        print("[Error] No decisions loaded.")
        return

    # Infer tickers from decisions
    tickers = set()
    for d in decisions:
        code = d.get("code", "")
        market = d.get("market", "")
        if market == "a" or (len(code) == 6 and code.isdigit()):
            tickers.add(code + ".SS" if code.startswith("6") or code.startswith("5") else code + ".SZ")
        elif market == "hk" or len(code) == 5:
            tickers.add(code + ".HK")
        else:
            tickers.add(code.upper())

    # Init backtest engine
    engine = BacktestEngine(
        tickers=list(tickers),
        start_date=args.start,
        end_date=args.end or datetime.now().strftime("%Y-%m-%d"),
        initial_capital=100000.0,
        position_size=0.2
    )

    # Run backtest
    print("\n[Running] Backtest from " + engine.start_date + " to " + engine.end_date + "...")
    stats = engine.run_full_backtest(decisions)

    # Print results
    print_stats(stats)

    # Save report
    report_path = engine.save_report("data/backtest_report.json")
    print("\n  Report saved: " + report_path)
    print("=" * 60)


if __name__ == "__main__":
    main()
