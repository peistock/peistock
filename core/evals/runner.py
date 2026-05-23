"""core/evals/runner.py — 评测运行器

提供测试用例加载、断言批量执行、回归测试与报告生成。
"""
import json
import time
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

from .assertions import (
    format_valid,
    risk_compliance,
    data_coverage,
    expected_decision_match,
    confidence_reason_alignment,
)
from .gate import evaluate_gate

# 目录常量
ROOT = Path(__file__).resolve().parent.parent.parent
EVALS_DIR = ROOT / "data" / "evals"
EVALS_DIR.mkdir(parents=True, exist_ok=True)

TEST_CASES_PATH = EVALS_DIR / "test_cases.jsonl"
REPORT_PATH = EVALS_DIR / "latest_report.json"


def load_test_cases(path: Optional[Path] = None) -> List[Dict[str, Any]]:
    """从 jsonl 文件加载测试用例。"""
    p = path or TEST_CASES_PATH
    cases = []
    if p.exists():
        with p.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    cases.append(json.loads(line))
    return cases


def run_assertions(
    test_case: Dict[str, Any],
    chair_output: Dict[str, Any],
) -> Dict[str, Any]:
    """对单条测试用例运行所有断言。

    Returns:
        {
            "name": str,
            "passed": bool,
            "assertions": {
                "format_valid": {"passed": bool, "detail": str},
                "risk_compliance": {"passed": bool, "detail": str},
                ...
            },
            "pass_rate": float,
        }
    """
    preemption = test_case.get("preemption_score")
    sentiment = test_case.get("sentiment_rating")
    required_metrics = test_case.get("required_metrics")

    results: Dict[str, Dict[str, Any]] = {}

    # 1. 格式
    ok, detail = format_valid(chair_output)
    results["format_valid"] = {"passed": ok, "detail": detail}

    # 2. 风控
    ok, detail = risk_compliance(chair_output, preemption, sentiment)
    results["risk_compliance"] = {"passed": ok, "detail": detail}

    # 3. 数据覆盖
    ok, detail = data_coverage(chair_output, required_metrics)
    results["data_coverage"] = {"passed": ok, "detail": detail}

    # 4. 预期决策匹配
    expected = test_case.get("expected_decision")
    ok, detail = expected_decision_match(chair_output, expected)
    results["expected_decision_match"] = {"passed": ok, "detail": detail}

    # 5. 置信-理由对齐
    ok, detail = confidence_reason_alignment(chair_output)
    results["confidence_reason_alignment"] = {"passed": ok, "detail": detail}

    total = len(results)
    passed = sum(1 for r in results.values() if r["passed"])
    pass_rate = passed / total if total else 0.0

    return {
        "name": test_case.get("name", "unnamed"),
        "passed": pass_rate == 1.0,
        "assertions": results,
        "pass_rate": pass_rate,
    }


def run_regression(
    test_cases_path: Optional[Path] = None,
    extra_cases: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """在回归集上跑所有断言，输出通过率与报告。

    Args:
        test_cases_path: 测试用例文件路径，默认 data/evals/test_cases.jsonl
        extra_cases: 额外追加的用例（例如当前正在分析的 chair_output）

    Returns:
        评测报告 dict，同时写入 data/evals/latest_report.json
    """
    cases = load_test_cases(test_cases_path)
    if extra_cases:
        cases = cases + extra_cases

    if not cases:
        return {"error": "无测试用例"}

    report: Dict[str, Any] = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "total_cases": len(cases),
        "cases": [],
    }

    all_pass_rates: List[float] = []
    for case in cases:
        # 构造 chair_output（测试用例里的字段直接映射）
        chair_output = case.get("chair_output", case)
        result = run_assertions(case, chair_output)
        report["cases"].append(result)
        all_pass_rates.append(result["pass_rate"])

    avg_pass_rate = sum(all_pass_rates) / len(all_pass_rates) if all_pass_rates else 0.0
    report["avg_pass_rate"] = round(avg_pass_rate, 4)
    report["fully_passed_cases"] = sum(1 for r in report["cases"] if r["passed"])

    # 5 维门控评估（初期只有 regression 有真实数据）
    gate_pass, gate_failed = evaluate_gate(
        {"regression_pass_rate": avg_pass_rate}
    )
    report["gate"] = {
        "pass": gate_pass,
        "failed_dimensions": gate_failed,
    }

    # 持久化
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def evaluate_current_decision(
    decision_dict: Dict[str, Any],
    preemption_score: Optional[float] = None,
    sentiment_rating: Optional[str] = None,
) -> Tuple[bool, Dict[str, Any]]:
    """对单条实时 Chair 决策运行断言并追加到回归报告。

    返回 (overall_pass, detail_dict)。
    """
    # 构造一个伪测试用例
    case = {
        "name": f"live_{decision_dict.get('code', 'unknown')}_{decision_dict.get('date', '')}",
        "preemption_score": preemption_score,
        "sentiment_rating": sentiment_rating,
        "chair_output": decision_dict,
    }
    result = run_assertions(case, decision_dict)

    # 追加到 latest_report（增量更新）
    existing = {}
    if REPORT_PATH.exists():
        try:
            existing = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass

    live_cases = existing.get("live_cases", [])
    live_cases.append(result)
    existing["live_cases"] = live_cases
    existing["live_avg_pass_rate"] = round(
        sum(c["pass_rate"] for c in live_cases) / len(live_cases), 4
    ) if live_cases else 0.0
    REPORT_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")

    return result["passed"], result
