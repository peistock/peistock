"""core/evals/assertions.py — 可编程断言（不依赖股价）

每个断言接收 decision_dict（来自 data/stock_decisions/*.json 的结构）
返回 (passed: bool, detail: str)。
"""
import re
from typing import Dict, List, Tuple, Optional, Any


def format_valid(decision_dict: Dict[str, Any]) -> Tuple[bool, str]:
    """检查 Chair 输出是否包含所有必填字段。"""
    required = ["decision", "conviction", "kill_switch", "holding_period"]
    missing = [k for k in required if not decision_dict.get(k)]
    if missing:
        return False, f"缺少必填字段: {', '.join(missing)}"
    # decision 必须是合法值
    d = str(decision_dict.get("decision", "")).upper()
    if d not in ("LONG", "SHORT", "NEUTRAL"):
        return False, f"decision 值非法: {d}"
    # conviction 必须是 0-100 的数字
    try:
        c = float(decision_dict.get("conviction", -1))
        if not (0 <= c <= 100):
            return False, f"conviction 越界: {c}"
    except Exception:
        return False, "conviction 非数字"
    return True, "格式合规"


def risk_compliance(
    decision_dict: Dict[str, Any],
    preemption_score: Optional[float] = None,
    sentiment_rating: Optional[str] = None,
) -> Tuple[bool, str]:
    """检查是否违反硬性风控规则。"""
    decision = str(decision_dict.get("decision", "")).upper()
    errors: List[str] = []

    # 规则 1: Preemption 过低时禁止做多
    if preemption_score is not None and preemption_score < 30 and decision == "LONG":
        errors.append(f"Preemption={preemption_score}<30，禁止做多")

    # 规则 2: 极度恐慌时禁止做空（情绪已price in，做空性价比极低）
    if sentiment_rating and "恐慌" in str(sentiment_rating) and decision == "SHORT":
        errors.append(f"Sentiment={sentiment_rating}，禁止做空")

    # 规则 3: 高 bear_confidence + 低 bull_confidence 时禁止做多
    bull = decision_dict.get("bull_confidence")
    bear = decision_dict.get("bear_confidence")
    if (
        bull is not None
        and bear is not None
        and bear > bull + 20
        and decision == "LONG"
    ):
        errors.append(f"Bear置信度({bear}) > Bull置信度({bull})+20，禁止做多")

    # 规则 4: 止损位不能为空（LONG/SHORT 必须有）
    if decision in ("LONG", "SHORT"):
        ks = str(decision_dict.get("kill_switch", "")).strip()
        if not ks or ks.lower() in ("无", "none", "null", "-"):
            errors.append("有方向决策但 kill_switch 为空")

    if errors:
        return False, "; ".join(errors)
    return True, "风控合规"


def data_coverage(
    decision_dict: Dict[str, Any],
    required_metrics: Optional[List[str]] = None,
) -> Tuple[bool, str]:
    """检查决策理由中是否提及至少一个预注入关键指标。"""
    thesis = str(decision_dict.get("thesis", ""))
    if not required_metrics:
        # 默认关键指标词表
        required_metrics = [
            "CRI", "BIAS", "成本偏离", "MAHS", "EMAHS",
            "经营现金流", "毛利率", "ROE", "营收", "净利润",
            "PE", "PB", "分位", "偏离",
        ]
    found = [m for m in required_metrics if m in thesis]
    if not found:
        return False, f"thesis 中未提及任何关键指标（检查了 {len(required_metrics)} 个关键词）"
    return True, f"提及指标: {', '.join(found[:3])}"


def expected_decision_match(
    decision_dict: Dict[str, Any],
    expected: Optional[str] = None,
) -> Tuple[bool, str]:
    """检查 Chair 输出是否与预期决策一致。

    expected 为 None 时跳过（不强制要求每个用例都有预期）。
    """
    if not expected:
        return True, "无预期决策，跳过"
    actual = str(decision_dict.get("decision", "")).upper()
    expected_up = str(expected).upper()
    if actual == expected_up:
        return True, f"决策匹配: {actual}"
    return False, f"预期 {expected_up}，实际 {actual}"


def confidence_reason_alignment(decision_dict: Dict[str, Any]) -> Tuple[bool, str]:
    """检查 confidence 与 reasoning 的自洽性。

    当 confidence > 80 时，thesis 中不应出现过多否定/风险词汇。
    """
    try:
        confidence = float(decision_dict.get("conviction", 0))
    except Exception:
        return False, "conviction 无法解析"

    thesis = str(decision_dict.get("thesis", ""))
    # 简单否定词表（中文 + 英文）
    risk_words = [
        "但是", "然而", "不过", "尽管", "虽然",
        "风险", "下跌", "跌破", "回撤", "亏损", "恶化",
        "不确定", "存疑", "难以", "缺乏", "不足",
        "but", "however", "risk", "decline", "drop",
    ]
    found = [w for w in risk_words if w in thesis]
    risk_ratio = len(found) / len(risk_words)

    if confidence > 80 and risk_ratio > 0.15:
        return False, f"confidence={confidence}>80 但 thesis 风险词占比过高 ({len(found)}/{len(risk_words)})"
    if confidence < 30 and risk_ratio < 0.05:
        return False, f"confidence={confidence}<30 但 thesis 几乎无风险提示，过于乐观"
    return True, f"confidence 与 reasoning 一致 (风险词 {len(found)} 个)"
