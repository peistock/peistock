"""
core/signal_detector.py
Strict B/S 信号检测 — 1:1 移植自 peistock src/utils/signals.ts (detectSignals)

只移植严格版 detectSignals(雪球大V同款逻辑),不移植 detectSignalsFrontend。
口径与 peistock K 线图上的 B/S 标记一致。
"""
from __future__ import annotations

from typing import Callable, Dict, List, Optional


# 雪球大V同款阈值(严格版)
XUEQIU_THRESHOLDS: Dict[str, float] = {
    "buyCostDev": 5,    # B(恐慌): 成本偏离<5%
    "buyBias": 5,       # B(恐慌): BIAS<5%
    "buyCRI": 90,       # B(恐慌): CRI>90
    "sellGreedy": 95,   # S(贪婪): 贪婪>95%
    "sellBias": 90,     # S(贪婪): BIAS>90%
    "sellCostDev": 95,  # S(高估): 成本偏离>95%
}

# B(底背离)阈值 — 与前端 K 线图一致
DIVERGENCE_BUY = {
    "criMin": 60,           # CRI≥60
    "costDevMax": 15,       # 成本偏离<15%
    "consecutiveDays": 2,   # 连续≥2天底背离
}

# S(顶背离)阈值
DIVERGENCE_SELL = {
    "biasMin": 50,          # BIAS>50%
    "consecutiveDays": 2,   # 连续≥2天顶背离
}


def count_consecutive_divergences(divergences: List[Optional[str]], kind: str) -> int:
    """从末尾反向扫描,连续命中 kind('top'/'bottom') 的天数。"""
    count = 0
    for v in reversed(divergences):
        if v == kind:
            count += 1
        else:
            break
    return count


def count_recent_meetings(values: List[Optional[float]], predicate: Callable[[float], bool]) -> int:
    """最近 N 天中满足 predicate 的非空值数量。"""
    out = 0
    for v in values:
        if v is None:
            continue
        try:
            if predicate(float(v)):
                out += 1
        except (TypeError, ValueError):
            continue
    return out


def detect_signals(data: Dict, use_divergence: bool = True) -> Dict:
    """
    严格 B/S 信号检测。

    data 期望键(对齐 TS ExtendedSignalData):
      cost_deviation_percentile / bias225_percentile / cri / greedy_percentile
      recent_divergences: List[Optional[str]]   # 'none'/'top'/'bottom'/None
      recent_cri: List[Optional[float]]
      recent_cost_dev: List[Optional[float]]
      plus_di / minus_di / prev_plus_di / prev_minus_di / next_plus_di / next_minus_di

    返回 {signals: List[str], signal_type: 'B'|'S'|None}
    """
    signals: List[str] = []
    signal_type: Optional[str] = None

    cost_dev = data.get("cost_deviation_percentile")
    bias = data.get("bias225_percentile")
    cri = data.get("cri")
    greedy = data.get("greedy_percentile")
    recent_divergences = data.get("recent_divergences") or []
    recent_cri = data.get("recent_cri") or []
    recent_cost_dev = data.get("recent_cost_dev") or []
    plus_di = data.get("plus_di")
    minus_di = data.get("minus_di")
    prev_plus_di = data.get("prev_plus_di")
    prev_minus_di = data.get("prev_minus_di")
    next_plus_di = data.get("next_plus_di")
    next_minus_di = data.get("next_minus_di")

    t = XUEQIU_THRESHOLDS

    # DI 拐点判断(与前端 K 线 B/S 标记一致)
    # B(恐慌) 在 -DI 峰值 或 +DI 谷值标记
    is_di_pivot_for_panic = (
        (prev_minus_di is not None and minus_di is not None and next_minus_di is not None
         and minus_di > prev_minus_di and minus_di > next_minus_di)
        or (prev_plus_di is not None and plus_di is not None and next_plus_di is not None
            and plus_di < prev_plus_di and plus_di < next_plus_di)
    )
    # S(贪婪) 在 +DI 峰值 或 -DI 谷值标记
    is_di_pivot_for_greedy = (
        (prev_plus_di is not None and plus_di is not None and next_plus_di is not None
         and plus_di > prev_plus_di and plus_di > next_plus_di)
        or (prev_minus_di is not None and minus_di is not None and next_minus_di is not None
            and minus_di < prev_minus_di and minus_di < next_minus_di)
    )

    # ===== 买入信号 =====

    # B(底背离): 连续≥2天底背离 + CRI≥60 有 2 天 + 成本偏离<15% 有 2 天
    if use_divergence and len(recent_divergences) > 0:
        bottom_div_count = count_consecutive_divergences(recent_divergences, "bottom")
        if bottom_div_count >= DIVERGENCE_BUY["consecutiveDays"]:
            recent_days = min(bottom_div_count, len(recent_cri))
            cri_slice = recent_cri[-recent_days:] if recent_days > 0 else []
            cri_meeting = count_recent_meetings(cri_slice, lambda v: v >= DIVERGENCE_BUY["criMin"])

            cost_dev_slice = recent_cost_dev[-recent_days:] if recent_days > 0 else []
            cost_dev_meeting = count_recent_meetings(cost_dev_slice, lambda v: v < DIVERGENCE_BUY["costDevMax"])

            if cri_meeting >= 2 and cost_dev_meeting >= 2:
                signals.append(f"B(底背离{bottom_div_count}天)")
                signal_type = "B"

    # B(恐慌): 成本偏离<5% + BIAS<5% + CRI>90,且为 DI 拐点
    is_cost_dev_panic = cost_dev is not None and cost_dev < t["buyCostDev"]
    is_bias_panic = bias is not None and bias < t["buyBias"]
    is_cri_panic = cri is not None and cri > t["buyCRI"]

    if is_cost_dev_panic and is_bias_panic and is_cri_panic:
        # 底背离不判断 DI 拐点;B(恐慌) 只在 DI 拐点标记
        if signal_type == "B" or is_di_pivot_for_panic:
            signals.append("B(恐慌)")
            signal_type = "B"

    # ===== 卖出信号 =====

    # S(顶背离): 连续≥2天顶背离 + BIAS>50%
    if use_divergence and len(recent_divergences) > 0:
        top_div_count = count_consecutive_divergences(recent_divergences, "top")
        is_bias_high = bias is not None and bias > DIVERGENCE_SELL["biasMin"]
        if top_div_count >= DIVERGENCE_SELL["consecutiveDays"] and is_bias_high:
            signals.append(f"S(顶背离{top_div_count}天)")
            signal_type = "S"

    # S(贪婪): 贪婪>95% + BIAS>90%,且为 DI 拐点
    is_greedy_high = greedy is not None and greedy > t["sellGreedy"]
    is_bias_sell_high = bias is not None and bias > t["sellBias"]

    if is_greedy_high and is_bias_sell_high:
        # 顶背离不判断 DI 拐点;S(贪婪) 只在 DI 拐点标记
        if signal_type == "S" or is_di_pivot_for_greedy:
            signals.append("S(贪婪)")
            signal_type = "S"

    return {"signals": signals, "signal_type": signal_type}


def build_signal_input(indicators: List[Dict], lookback: int = 5) -> Dict:
    """
    便利函数: 从 calculate_all_indicators 输出构造 detect_signals 的输入。

    indicators: List[Dict] 每行包含 bias225_percentile/cri/cri_percentile/greedy_percentile
                /cost_deviation_percentile/pvt_divergence/plus_di/minus_di
    lookback: 取最近 N 天构造 recent_* 序列
    返回 dict 已对齐 detect_signals 期望的键
    """
    if not indicators:
        return {}
    last = indicators[-1]
    n = len(indicators)
    start = max(0, n - lookback)
    recent = indicators[start:n]

    out = {
        "cost_deviation_percentile": last.get("cost_deviation_percentile"),
        "bias225_percentile": last.get("bias225_percentile"),
        "cri": last.get("cri"),
        "greedy_percentile": last.get("greedy_percentile"),
        "recent_divergences": [r.get("pvt_divergence") for r in recent],
        "recent_cri": [r.get("cri") for r in recent],
        "recent_cost_dev": [r.get("cost_deviation_percentile") for r in recent],
        "plus_di": last.get("plus_di"),
        "minus_di": last.get("minus_di"),
    }
    if n >= 2:
        prev = indicators[-2]
        out["prev_plus_di"] = prev.get("plus_di")
        out["prev_minus_di"] = prev.get("minus_di")
    # next_* 在实时检测里通常拿不到(未来数据),留 None 即可
    out["next_plus_di"] = None
    out["next_minus_di"] = None
    return out
