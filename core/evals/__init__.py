"""core/evals — 轻量级策略评测框架

不依赖未来股价，只验证 Chair 决策的过程合规性与逻辑一致性。
"""
from .assertions import (
    format_valid,
    risk_compliance,
    data_coverage,
    expected_decision_match,
    confidence_reason_alignment,
)
from .gate import evaluate_gate
from .runner import run_regression, load_test_cases, run_assertions

__all__ = [
    "format_valid",
    "risk_compliance",
    "data_coverage",
    "expected_decision_match",
    "confidence_reason_alignment",
    "evaluate_gate",
    "run_regression",
    "load_test_cases",
    "run_assertions",
]
