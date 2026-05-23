"""core/evals/gate.py — 5 维门控逻辑

用于量化 Chair 决策质量并防止退化。
初期 quality/trigger 维度用模拟值占位（需真实股价回测），
cost/latency/regression 可立即启用。
"""
from typing import Dict, List, Tuple, Any


# 初始阈值（可根据实际运行数据调优）
DEFAULT_THRESHOLDS = {
    "quality": 0.01,      # 回测超额收益变化 > +1%（模拟阶段）
    "trigger": 0.05,      # 信号准确率变化 ±5%（模拟阶段）
    "cost": 0.20,         # 单次决策 token 消耗增加 < 20%
    "latency": 0.20,      # 决策耗时增加 < 20%
    "regression": 0.95,   # 历史经典案例集断言通过率 ≥ 95%
}


def evaluate_gate(
    results_dict: Dict[str, Any],
    thresholds: Dict[str, float] = None,
) -> Tuple[bool, List[str]]:
    """评估 5 维门控。

    Args:
        results_dict: 必须包含以下键（缺失视为模拟跳过）
            - quality_delta: 超额收益变化（如 0.02 表示 +2%）
            - trigger_delta: 信号准确率变化（绝对值，如 0.03）
            - cost_ratio: token 消耗相对基线增长比例（如 0.15）
            - latency_ratio: 耗时相对基线增长比例（如 0.10）
            - regression_pass_rate: 回归集断言通过率（如 0.97）

    Returns:
        (pass: bool, failed_dimensions: List[str])
    """
    t = thresholds or DEFAULT_THRESHOLDS
    failed: List[str] = []

    # 1. quality — 超额收益必须提升（模拟阶段：值存在才检查）
    qd = results_dict.get("quality_delta")
    if qd is not None and qd < t["quality"]:
        failed.append(f"quality ({qd:.2%} < {t['quality']:.0%})")

    # 2. trigger — 准确率变化不能太大（模拟阶段）
    td = results_dict.get("trigger_delta")
    if td is not None and abs(td) > t["trigger"]:
        failed.append(f"trigger (|{td:.2%}| > {t['trigger']:.0%})")

    # 3. cost — token 消耗增长
    cr = results_dict.get("cost_ratio")
    if cr is not None and cr > t["cost"]:
        failed.append(f"cost ({cr:.1%} > {t['cost']:.0%})")

    # 4. latency — 耗时增长
    lr = results_dict.get("latency_ratio")
    if lr is not None and lr > t["latency"]:
        failed.append(f"latency ({lr:.1%} > {t['latency']:.0%})")

    # 5. regression — 断言通过率
    rr = results_dict.get("regression_pass_rate")
    if rr is not None and rr < t["regression"]:
        failed.append(f"regression ({rr:.1%} < {t['regression']:.0%})")

    return len(failed) == 0, failed
