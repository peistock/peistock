"""core/risk_manager.py — 零 LLM 规则风控层

在 Chair 调用 LLM 之前运行，防止明显高风险场景下做出激进决策。
所有计算纯规则，不调用 LLM。
"""
from typing import Dict, Any, Optional
import numpy as np


def _safe_float(val, default: float = 50.0) -> float:
    try:
        return float(val)
    except Exception:
        return default


def _safe_int(val, default: int = 50) -> int:
    try:
        return int(val)
    except Exception:
        return default


def assess_risk(
    bull_signal: Optional[Dict[str, Any]] = None,
    bear_signal: Optional[Dict[str, Any]] = None,
    preemption_signal: Optional[Dict[str, Any]] = None,
    sentiment_signal: Optional[Dict[str, Any]] = None,
    hist_volatility: float = 0.0,
    macro_signal: Optional[Dict[str, Any]] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """计算综合风险评分。

    各子风险先归一化到 0-100，再加权求总风险。

    Args:
        bull_signal: {"confidence": int, "signal": str}
        bear_signal: {"confidence": int, "signal": str}
        preemption_signal: {"entry_timing_score": int, ...}
        sentiment_signal: {"sentiment_score": int, ...}  # 0-100, 越高越贪婪
        hist_volatility: 20 日历史波动率（日收益率标准差，如 0.02 = 2%）
        macro_signal: 暂不使用
        config: 可覆盖阈值

    Returns:
        {
            "risk_level": "LOW|MEDIUM|HIGH",
            "position_limit": "full|half|none",
            "total_score": float,
            "sub_risks": {
                "consensus_risk": float,
                "sentiment_extreme_risk": float,
                "digestion_risk": float,
                "volatility_risk": float,
            },
        }
    """
    cfg = config or {}
    vol_threshold = cfg.get("volatility_threshold", 0.04)
    high_threshold = cfg.get("high_threshold", 70)
    medium_threshold = cfg.get("medium_threshold", 40)

    bull = bull_signal or {}
    bear = bear_signal or {}
    prep = preemption_signal or {}
    sent = sentiment_signal or {}

    bull_conf = _safe_int(bull.get("confidence"), 50)
    bear_conf = _safe_int(bear.get("confidence"), 50)
    entry_score = _safe_int(prep.get("entry_timing_score"), 50)
    sentiment_score = _safe_int(sent.get("sentiment_score"), 50)

    # 1. 共识风险 = abs(bull - bear)，差越大风险越高（已天然归一化 0-100）
    consensus_risk = abs(bull_conf - bear_conf)

    # 2. 情绪极端风险：>=80 或 <=20 时风险=100，否则 0
    if sentiment_score >= 80 or sentiment_score <= 20:
        sentiment_extreme_risk = 100.0
    else:
        sentiment_extreme_risk = 0.0

    # 3. 信息消化风险：entry_timing_score <=30 → 100, <=50 → 50, else 0
    if entry_score <= 30:
        digestion_risk = 100.0
    elif entry_score <= 50:
        digestion_risk = 50.0
    else:
        digestion_risk = 0.0

    # 4. 波动率风险：>= threshold → 100，否则 0
    if hist_volatility >= vol_threshold:
        volatility_risk = 100.0
    else:
        volatility_risk = 0.0

    # 5. 总风险加权
    weights = {
        "consensus": 0.30,
        "sentiment": 0.30,
        "digestion": 0.25,
        "volatility": 0.15,
    }
    total_score = (
        consensus_risk * weights["consensus"]
        + sentiment_extreme_risk * weights["sentiment"]
        + digestion_risk * weights["digestion"]
        + volatility_risk * weights["volatility"]
    )

    # 6. 风险等级
    if total_score >= high_threshold:
        risk_level = "HIGH"
        position_limit = "none"
    elif total_score >= medium_threshold:
        risk_level = "MEDIUM"
        position_limit = "half"
    else:
        risk_level = "LOW"
        position_limit = "full"

    return {
        "risk_level": risk_level,
        "position_limit": position_limit,
        "total_score": round(total_score, 2),
        "sub_risks": {
            "consensus_risk": round(consensus_risk, 2),
            "sentiment_extreme_risk": round(sentiment_extreme_risk, 2),
            "digestion_risk": round(digestion_risk, 2),
            "volatility_risk": round(volatility_risk, 2),
        },
    }


def calc_hist_volatility(closes: list) -> float:
    """从收盘价序列计算 20 日历史波动率（日收益率标准差）。

    Args:
        closes: 收盘价列表（按时间正序，最新在末尾）

    Returns:
        日收益率标准差（如 0.02 = 2%）
    """
    if len(closes) < 21:
        return 0.0
    arr = np.array(closes, dtype=float)
    returns = np.diff(arr) / arr[:-1]
    return float(np.std(returns[-20:]))
