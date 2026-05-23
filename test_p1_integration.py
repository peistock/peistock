#!/usr/bin/env python3
"""P1 集成测试：验证 Chair prompt 改造 + 评分提取 + ChairScorer 计算链路"""
import json
import re
from pathlib import Path
from datetime import datetime

from core.chair_scorer import ChairScorer

# ---------------------------------------------------------------------------
# 模拟 Chair 报告（符合改造后的 chair_debate.yaml 输出格式）
# ---------------------------------------------------------------------------
MOCK_CHAIR_REPORT = """
## 核心裁决（Verdict）

### 决策（Decision）
LONG

### 信心度（Conviction）
65

### 核心论点（Thesis）
Bull 认为 Q2 营收超预期，Preemption 显示信息未完全消化，MacroIndustry 给出正面评分。

### Bull 核心观点（Long Case）
- 营收同比 +45%，毛利率提升
- 置信度 75

### Bear 核心观点（Short Case）
- 估值偏高，短期获利盘抛压
- 置信度 30

### 五维度对比摘要
| 维度 | Bull | Bear | Preemption | Sentiment | MacroIndustry |
|------|------|------|------------|-----------|---------------|
| 置信度/评分 | 75 | 30 | 60 | 贪婪 | +20 |
| 核心论据 | 营收超预期 | 估值偏高 | 未完全消化 | 散户涌入 | PMI回升 |
| 关键风险 | 毛利率波动 | 宏观放缓 | 追涨陷阱 | 情绪顶部 | 行业政策 |

### 原始评分（Raw Scores）
- Bull 置信度: 75
- Preemption 评分: 60
- Bear 置信度: 30
- MacroIndustry 综合评分: 20
- Sentiment 情绪评级: 贪婪

### 裁决员独立判断
Bull 论据更有说服力，Preemption 时机尚可，建议 LONG。

## 时机与情绪（Timing & Sentiment）

### Preemption 时机判断
Preemption 评分 60 分，信息消化约 40%，具备入场价值。

### Sentiment 情绪判断
Sentiment 显示贪婪，但机构仍在流入，未达极度贪婪。

## 操作计划（Action Plan）

### 催化剂 / 触发条件（Catalyst / Trigger）
Q2 财报确认营收增速

### 止损位（Kill Switch）
Stop loss 5%

### 最大损失（Max Loss）
5%

### 持有期建议
T+5

## 核心摘要（≤150字）
LONG（conv=65）：Bull 营收超预期论据更扎实（75 vs 30），Preemption 60 分显示信息未完全消化，MacroIndustry +20 支持做多。Sentiment 贪婪但未极端，可持仓观察。
""".strip()


def test_extract_raw_scores():
    """测试从 Chair 报告中提取原始评分"""
    text = MOCK_CHAIR_REPORT

    def _extract_raw_score(text: str, label: str):
        m = re.search(
            rf"-\s*{re.escape(label)}\s*[:：]\s*([+-]?\d+\.?\d*)",
            text, re.IGNORECASE
        )
        return float(m.group(1)) if m else None

    def _extract_sentiment(text: str) -> str:
        m = re.search(
            r"-\s*Sentiment\s*情绪评级\s*[:：]\s*([^\n]+)",
            text, re.IGNORECASE
        )
        if m:
            return m.group(1).strip()
        m = re.search(
            r"情绪评级[是为]\s*[:：]?\s*(极度贪婪|贪婪|中性|恐慌|极度恐慌)",
            text
        )
        return m.group(1) if m else "中性"

    bull = _extract_raw_score(text, "Bull 置信度")
    bear = _extract_raw_score(text, "Bear 置信度")
    preemption = _extract_raw_score(text, "Preemption 评分")
    macro = _extract_raw_score(text, "MacroIndustry 综合评分")
    sentiment = _extract_sentiment(text)

    print("=" * 60)
    print("[TEST 1] 原始评分提取")
    print("=" * 60)
    print(f"  Bull 置信度: {bull} (expect 75)")
    print(f"  Bear 置信度: {bear} (expect 30)")
    print(f"  Preemption:  {preemption} (expect 60)")
    print(f"  Macro:       {macro} (expect 20)")
    print(f"  Sentiment:   {sentiment} (expect 贪婪)")

    assert bull == 75.0, f"Bull extraction failed: {bull}"
    assert bear == 30.0, f"Bear extraction failed: {bear}"
    assert preemption == 60.0, f"Preemption extraction failed: {preemption}"
    assert macro == 20.0, f"Macro extraction failed: {macro}"
    assert sentiment == "贪婪", f"Sentiment extraction failed: {sentiment}"
    print("  ✓ 全部提取正确")
    return bull, bear, preemption, macro, sentiment


def test_chair_scorer(bull, bear, preemption, macro, sentiment):
    """测试 ChairScorer 计算"""
    scorer = ChairScorer()
    result = scorer.calculate(bull, preemption, bear, macro, sentiment)

    # 手动验算：75*0.30 + 60*0.30 - 30*0.25 + 20*0.15 = 22.5 + 18 - 7.5 + 3 = 36
    expected_score = 22.5 + 18 - 7.5 + 3
    expected_decision = "long"

    print()
    print("=" * 60)
    print("[TEST 2] ChairScorer 计算")
    print("=" * 60)
    print(f"  weighted_score: {result['weighted_score']} (expect {expected_score})")
    print(f"  decision:       {result['decision']} (expect {expected_decision})")
    print(f"  conviction:     {result['conviction']} (expect {expected_score})")

    assert result["weighted_score"] == expected_score, f"Score mismatch: {result['weighted_score']}"
    assert result["decision"] == expected_decision, f"Decision mismatch: {result['decision']}"
    assert result["conviction"] == expected_score, f"Conviction mismatch: {result['conviction']}"
    print("  ✓ 计算正确")
    return result


def test_chair_scorer_edge_cases():
    """测试边界情况"""
    scorer = ChairScorer()

    print()
    print("=" * 60)
    print("[TEST 3] 边界情况")
    print("=" * 60)

    # Case 1: Preemption < 15 → 强制 NEUTRAL
    r = scorer.calculate(90, 10, 10, 30, "中性")
    assert r["decision"] == "neutral", f"Preemption filter failed: {r}"
    print(f"  Preemption=10 → {r['decision']} ✓ (强制 NEUTRAL)")

    # Case 2: 极度贪婪 + score > -10 → NEUTRAL
    r = scorer.calculate(90, 80, 10, 30, "极度贪婪")
    assert r["decision"] == "neutral", f"Extreme greed filter failed: {r}"
    print(f"  极度贪婪, score={r['weighted_score']:.1f} → {r['decision']} ✓")

    # Case 3: 极度贪婪 + score < -10 → SHORT（注意 Preemption 必须 >=15，否则先被 Preemption 过滤拦截）
    r = scorer.calculate(10, 15, 90, -30, "极度贪婪")
    # score = 10*0.30 + 15*0.30 - 90*0.25 + (-30)*0.15 = 3+4.5-22.5-4.5 = -19.5 < -10
    assert r["decision"] == "short", f"Extreme greed short failed: {r}"
    print(f"  极度贪婪+利空, score={r['weighted_score']:.1f} → {r['decision']} ✓")

    # Case 4: 极度恐慌 + score > 10 → LONG
    r = scorer.calculate(90, 80, 10, 30, "极度恐慌")
    assert r["decision"] == "long", f"Extreme fear long failed: {r}"
    print(f"  极度恐慌+利好, score={r['weighted_score']:.1f} → {r['decision']} ✓")

    # Case 5: 阈值边界 score=20 → NEUTRAL
    r = scorer.calculate(50, 50, 50, 0, "中性")
    # 50*0.30 + 50*0.30 - 50*0.25 + 0 = 15+15-12.5 = 17.5 < 20 → NEUTRAL
    assert r["decision"] == "neutral", f"Threshold boundary failed: {r}"
    print(f"  score={r['weighted_score']:.1f} < 20 → {r['decision']} ✓")

    # Case 6: score > 20 → LONG
    r = scorer.calculate(80, 50, 20, 0, "中性")
    # 80*0.30 + 50*0.30 - 20*0.25 = 24+15-5 = 34 > 20 → LONG
    assert r["decision"] == "long", f"Long threshold failed: {r}"
    print(f"  score={r['weighted_score']:.1f} > 20 → {r['decision']} ✓")

    print("  ✓ 全部边界通过")


def test_generate_decision_card():
    """测试完整的决策卡生成流程"""
    from api_server import _generate_stock_decision_card

    print()
    print("=" * 60)
    print("[TEST 4] 决策卡生成端到端")
    print("=" * 60)

    code = "600989"
    date_str = "20260523"
    path = _generate_stock_decision_card(code, date_str, MOCK_CHAIR_REPORT)

    assert path.exists(), f"决策卡文件未生成: {path}"
    card = json.loads(path.read_text(encoding="utf-8"))

    print(f"  文件: {path}")
    print(f"  decision: {card['decision']} (expect LONG)")
    print(f"  conviction: {card['conviction']} (expect 36.0)")
    print(f"  weighted_score: {card['weighted_score']} (expect 36.0)")
    print(f"  bull_confidence: {card['bull_confidence']} (expect 75.0)")
    print(f"  bear_confidence: {card['bear_confidence']} (expect 30.0)")
    print(f"  preemption_score: {card['preemption_score']} (expect 60.0)")
    print(f"  macro_industry_score: {card['macro_industry_score']} (expect 20.0)")
    print(f"  sentiment_rating: {card['sentiment_rating']} (expect 贪婪)")

    assert card["decision"] == "LONG", f"Decision mismatch: {card['decision']}"
    assert card["conviction"] == 36.0, f"Conviction mismatch: {card['conviction']}"
    assert card["weighted_score"] == 36.0, f"Weighted score mismatch: {card['weighted_score']}"
    assert card["bull_confidence"] == 75.0
    assert card["bear_confidence"] == 30.0
    assert card["preemption_score"] == 60.0
    assert card["macro_industry_score"] == 20.0
    assert card["sentiment_rating"] == "贪婪"

    print("  ✓ 决策卡字段全部正确")

    # 清理测试文件
    path.unlink()
    print(f"  已清理测试文件")


def test_config_override():
    """测试配置文件覆盖"""
    from core.chair_scorer import ChairScorer

    print()
    print("=" * 60)
    print("[TEST 5] 配置覆盖")
    print("=" * 60)

    scorer = ChairScorer()
    # 修改权重
    scorer.config["weights"]["bull"] = 0.50
    scorer.config["weights"]["preemption"] = 0.20
    result = scorer.calculate(80, 50, 20, 0, "中性")
    # 80*0.50 + 50*0.20 - 20*0.25 = 40+10-5 = 45
    assert result["weighted_score"] == 45.0, f"Config override failed: {result}"
    print(f"  自定义权重 → score={result['weighted_score']:.1f} ✓")
    print("  ✓ 配置覆盖生效")


if __name__ == "__main__":
    scores = test_extract_raw_scores()
    test_chair_scorer(*scores)
    test_chair_scorer_edge_cases()
    test_generate_decision_card()
    test_config_override()
    print()
    print("=" * 60)
    print("全部测试通过 ✓")
    print("=" * 60)
