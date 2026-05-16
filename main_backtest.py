#!/usr/bin/env python3
"""
main_backtest.py
Backtest entry: validate RebelResearchOS decisions against historical data
"""
import os
import sys
import json
import argparse
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.backtest import BacktestEngine

def load_decision_cards(path="data/decision_history.json"):
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

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

def main():
    parser = argparse.ArgumentParser(description="RebelResearchOS Backtest")
    parser.add_argument("--start", default="2024-01-01", help="Backtest start date")
    parser.add_argument("--end", default="2025-12-31", help="Backtest end date")
    parser.add_argument("--decisions", default="", help="Path to decision history JSON")
    parser.add_argument("--mock", action="store_true", help="Use mock decisions for demo")
    args = parser.parse_args()
    
    print("=" * 60)
    print("  RebelResearchOS - Backtest Engine")
    print("=" * 60)
    
    # Load decisions
    if args.mock:
        print("[Mode] Using mock decisions for demo")
        decisions = generate_mock_decisions()
    elif args.decisions:
        print("[Mode] Loading decisions from " + args.decisions)
        decisions = load_decision_cards(args.decisions)
    else:
        print("[Error] No decisions provided. Use --mock or --decisions")
        return
        
    print("  Loaded " + str(len(decisions)) + " decision cards")
    
    # Init backtest engine
    engine = BacktestEngine(
        tickers=["AAPL", "GOOGL", "META", "MSFT", "AMZN", "NVDA"],
        start_date=args.start,
        end_date=args.end,
        initial_capital=100000.0,
        position_size=0.2
    )
    
    # Run backtest
    print("\n[Running] Backtest from " + args.start + " to " + args.end + "...")
    stats = engine.run_full_backtest(decisions)

    # Print results
    print("\n" + "=" * 60)
    print("  BACKTEST RESULTS")
    print("=" * 60)
    
    combined = stats.get("combined", {})
    if not combined:
        print("  No trades executed.")
        return
        
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
    
    # Save report
    report_path = engine.save_report("data/backtest_report.json")
    print("\n  Report saved: " + report_path)
    print("=" * 60)

if __name__ == "__main__":
    main()
