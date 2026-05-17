"""
core/decision_card.py
Force decision: long / short / neutral with kill switch.
Supports market-level (legacy) and stock-level (peistock-inspired) cards.
"""
import json
import os
from datetime import datetime
from typing import Dict, List, Optional


def _resolve_decision(bull_result, bear_result) -> Dict:
    """共享的 long/short/neutral conviction-gap 判定。"""
    bull_conf = bull_result.confidence if bull_result.stance == "bull" else 0
    bear_conf = bear_result.confidence if bear_result.stance == "bear" else 0

    if bull_conf > 70 and bear_conf < 30:
        decision = "long"
        conviction = bull_conf
        thesis = bull_result.thesis
        catalyst = bull_result.catalyst
        kill_switch = bear_result.trigger_condition or "Bull confidence drops below 50"
        holding_period = "T+5"
        risk = bear_result.max_loss or "Unknown"
    elif bear_conf > 70 and bull_conf < 30:
        decision = "short"
        conviction = bear_conf
        thesis = bear_result.thesis
        catalyst = bear_result.trigger_condition
        kill_switch = bull_result.catalyst or "Bear confidence drops below 50"
        holding_period = "T+3"
        risk = bull_result.max_upside or "Unknown"
    else:
        decision = "neutral"
        conviction = 100 - abs(bull_conf - bear_conf)
        thesis = "No clear edge. Bull " + str(bull_conf) + " vs Bear " + str(bear_conf) + ". Wait for divergence."
        catalyst = "N/A"
        kill_switch = "N/A"
        holding_period = "N/A"
        risk = "Opportunity cost"

    return {
        "decision": decision,
        "conviction": round(conviction, 1),
        "thesis": thesis,
        "catalyst": catalyst,
        "kill_switch": kill_switch,
        "holding_period": holding_period,
        "risk_if_wrong": risk,
        "bull_confidence": bull_conf,
        "bear_confidence": bear_conf,
        "bull_thesis": bull_result.thesis,
        "bull_catalyst": bull_result.catalyst,
        "bull_max_upside": bull_result.max_upside,
        "bear_thesis": bear_result.thesis,
        "bear_trigger_condition": bear_result.trigger_condition,
        "bear_max_loss": bear_result.max_loss,
    }


def generate_decision_card(bull_result, bear_result, signals: List,
                            news: Optional[List[Dict]] = None) -> Dict:
    """市场级决策卡(原 main.py 用)。"""
    base = _resolve_decision(bull_result, bear_result)
    base["anomaly_triggers"] = [s.note for s in signals]
    base["news_context"] = news or []
    base["timestamp"] = datetime.now().isoformat()
    return base


def generate_stock_card(
    bull_result,
    bear_result,
    code: str,
    quote: Dict,
    indicators_latest: Dict,
    signal_result: Dict,
    news: Optional[List[Dict]] = None,
) -> Dict:
    """
    个股决策卡(A/HK 通用,peistock-inspired)。
    indicators_latest: calculate_all_indicators[-1] 的子集
    signal_result: detect_signals 输出 {signals, signal_type}
    """
    base = _resolve_decision(bull_result, bear_result)

    key_indicators = {
        "close": indicators_latest.get("close"),
        "mahs": indicators_latest.get("mahs"),
        "ma20": indicators_latest.get("ma20"),
        "ma60": indicators_latest.get("ma60"),
        "ma225": indicators_latest.get("ma225"),
        "bias225": indicators_latest.get("bias225"),
        "bias225_percentile": indicators_latest.get("bias225_percentile"),
        "cri": indicators_latest.get("cri"),
        "cri_percentile": indicators_latest.get("cri_percentile"),
        "greedy_percentile": indicators_latest.get("greedy_percentile"),
        "cost_deviation": indicators_latest.get("cost_deviation"),
        "cost_deviation_percentile": indicators_latest.get("cost_deviation_percentile"),
        "adx": indicators_latest.get("adx"),
        "plus_di": indicators_latest.get("plus_di"),
        "minus_di": indicators_latest.get("minus_di"),
        "pvt_divergence": indicators_latest.get("pvt_divergence"),
        "trend_strength": indicators_latest.get("trend_strength"),
    }

    base.update({
        "code": code,
        "market": quote.get("market"),
        "name": quote.get("name"),
        "price": quote.get("price"),
        "change_pct": quote.get("change_pct"),
        "peistock_signal_type": signal_result.get("signal_type"),
        "peistock_signals": signal_result.get("signals", []),
        "key_indicators": key_indicators,
        "anomaly_triggers": [],  # 个股卡无 market-level 触发
        "news_context": news or [],
        "timestamp": datetime.now().isoformat(),
    })
    return base


def print_decision_card(card: Dict):
    """Print decision card in readable format."""
    print()
    print("=" * 50)
    print("DECISION CARD")
    print("=" * 50)
    if card.get("code"):
        print("Stock:       " + str(card.get("code")) + " " + str(card.get("name") or ""))
        print("Market:      " + str(card.get("market") or ""))
        print("Price:       " + str(card.get("price")) + "  (" + str(card.get("change_pct")) + "%)")
    print("Decision:    " + card["decision"].upper())
    print("Conviction:  " + str(card["conviction"]) + "%")
    print("Thesis:      " + card["thesis"])
    print("Catalyst:    " + str(card["catalyst"]))
    print("Kill Switch: " + str(card["kill_switch"]))
    print("Hold Period: " + str(card["holding_period"]))
    print("Risk:        " + str(card["risk_if_wrong"]))

    if card.get("peistock_signal_type"):
        print()
        print("Peistock Signal: " + str(card["peistock_signal_type"]))
        for s in card.get("peistock_signals", []):
            print("  - " + s)

    if card.get("key_indicators"):
        print()
        print("Key Indicators:")
        ki = card["key_indicators"]
        for k in ("bias225_percentile", "cri", "cri_percentile",
                 "greedy_percentile", "cost_deviation_percentile",
                 "adx", "pvt_divergence", "trend_strength"):
            if ki.get(k) is not None:
                print("  " + k + ": " + str(ki[k]))

    if card.get("anomaly_triggers"):
        print()
        print("Anomaly Triggers:")
        for i, t in enumerate(card["anomaly_triggers"], 1):
            print("  " + str(i) + ". " + t)
    print("=" * 50)


def save_decision_card(card: Dict, path: str = "data/decision.json"):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(card, f, ensure_ascii=False, indent=2)


def save_stock_card(card: Dict, base_dir: str = "data/stock_decisions") -> str:
    """写到 data/stock_decisions/<code>_<YYYYMMDD>.json。"""
    code = str(card.get("code", "unknown"))
    today = datetime.now().strftime("%Y%m%d")
    os.makedirs(base_dir, exist_ok=True)
    path = os.path.join(base_dir, code + "_" + today + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(card, f, ensure_ascii=False, indent=2)
    return path
