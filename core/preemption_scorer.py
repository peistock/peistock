"""
core/preemption_scorer.py
Preemption 入场时机评分公式化计算。

设计原则：
- 不让 LLM 主观打分，用代码基于量化数据客观计算
- 基本面偏离度 × (1 - 价格消化度) = 入场时机评分
- 所有参数可追溯、可解释
"""
import re
from typing import Dict, Optional


def _extract_number_after(text: str, keyword: str) -> Optional[float]:
    """从文本中提取关键字后的第一个带 +/- 的数字（百分比）。"""
    pattern = re.compile(
        rf"{re.escape(keyword)}.*?([+-]?\d+\.?\d*)\s*%",
        re.IGNORECASE | re.DOTALL,
    )
    m = pattern.search(text)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    return None


def _extract_speed_values(md_text: str) -> Dict[str, float]:
    """
    从财报/预期 Markdown 中提取营收和净利润的同比增速。
    返回 {"revenue_yoy": float, "profit_yoy": float}
    """
    result = {}
    # 尝试多种关键字变体
    rev = (
        _extract_number_after(md_text, "营收同比增速")
        or _extract_number_after(md_text, "营业收入-同比增长")
        or _extract_number_after(md_text, "营业总收入-同比增长")
        or _extract_number_after(md_text, "营收同比")
    )
    profit = (
        _extract_number_after(md_text, "净利润同比增速")
        or _extract_number_after(md_text, "净利润-同比增长")
        or _extract_number_after(md_text, "净利润同比")
    )
    if rev is not None:
        result["revenue_yoy"] = rev
    if profit is not None:
        result["profit_yoy"] = profit
    return result


def calc_fundamental_score(actual_rev_yoy: float, actual_profit_yoy: float,
                           expected_rev_yoy: float, expected_profit_yoy: float) -> float:
    """
    基本面偏离分（0-100）。
    以预期基准为锚，计算实际偏离程度。
    - 平均偏离 +30% → 100 分（极度超预期）
    - 平均偏离 0% → 50 分（符合预期）
    - 平均偏离 -30% → 0 分（极度低于预期）
    """
    rev_diff = ((actual_rev_yoy - expected_rev_yoy) / abs(expected_rev_yoy) * 100
                if expected_rev_yoy else 0)
    profit_diff = ((actual_profit_yoy - expected_profit_yoy) / abs(expected_profit_yoy) * 100
                   if expected_profit_yoy else 0)
    avg_diff = (rev_diff + profit_diff) / 2
    score = 50 + (avg_diff / 30) * 50
    return max(0, min(100, score))


def calc_priced_in_score(price_change_5d: float) -> float:
    """
    价格提前反应度（0-100，越高表示股价已反应越多）。
    基于最近 5 日涨跌幅做经验映射：
    - >10% → 80 分（大部分已消化）
    - 5-10% → 50 分（部分消化）
    - <5% → 20 分（未充分消化）
    """
    if price_change_5d > 10:
        return 80
    elif price_change_5d > 5:
        return 50
    elif price_change_5d > 0:
        return 30
    else:
        return 10


def calc_preemption_score(
    actual_rev_yoy: float,
    actual_profit_yoy: float,
    expected_rev_yoy: float,
    expected_profit_yoy: float,
    price_change_5d: float = 0,
) -> Dict:
    """
    公式化计算 Preemption 入场时机评分。

    Returns:
        {
            "score": int,           # 0-100 合成评分
            "fundamental": int,     # 0-100 基本面偏离分
            "priced_in": int,       # 0-100 价格消化分
            "rev_diff": float,      # 营收偏离 %
            "profit_diff": float,   # 净利润偏离 %
            "details": str,         # 可读的计算过程
        }
    """
    fundamental = calc_fundamental_score(
        actual_rev_yoy, actual_profit_yoy,
        expected_rev_yoy, expected_profit_yoy,
    )
    priced_in = calc_priced_in_score(price_change_5d)

    # 合成：基本面越好 + 消化越少 = 分数越高
    raw = fundamental * (1 - priced_in / 100) * 1.2
    score = max(0, min(100, raw))

    details = (
        f"计算过程："
        f"实际营收同比 {actual_rev_yoy:+.2f}% vs 预期 {expected_rev_yoy:+.2f}% → 偏离 {((actual_rev_yoy-expected_rev_yoy)/abs(expected_rev_yoy)*100) if expected_rev_yoy else 0:+.1f}%；"
        f"实际净利润同比 {actual_profit_yoy:+.2f}% vs 预期 {expected_profit_yoy:+.2f}% → 偏离 {((actual_profit_yoy-expected_profit_yoy)/abs(expected_profit_yoy)*100) if expected_profit_yoy else 0:+.1f}%；"
        f"基本面偏离分 = {fundamental:.0f}；"
        f"最近5日涨幅 {price_change_5d:+.2f}% → 消化度 = {priced_in:.0f}；"
        f"合成 = {fundamental:.0f} × (1-{priced_in/100:.2f}) × 1.2 = {score:.0f}"
    )

    return {
        "score": round(score),
        "fundamental": round(fundamental),
        "priced_in": round(priced_in),
        "rev_diff": round((actual_rev_yoy - expected_rev_yoy) / abs(expected_rev_yoy) * 100, 2) if expected_rev_yoy else 0,
        "profit_diff": round((actual_profit_yoy - expected_profit_yoy) / abs(expected_profit_yoy) * 100, 2) if expected_profit_yoy else 0,
        "details": details,
    }


def build_preemption_score_from_prompt_data(
    financial_md: str,
    expectation_md: str,
    price_change_5d: float = 0,
) -> Optional[Dict]:
    """
    从 prompt 注入的 Markdown 数据中提取数字，自动计算 Preemption 评分。
    如果数据不全，返回 None（让 LLM 降级为定性分析）。
    """
    actual = _extract_speed_values(financial_md)
    expected = _extract_speed_values(expectation_md)

    if "revenue_yoy" not in actual or "profit_yoy" not in actual:
        return None
    if "revenue_yoy" not in expected or "profit_yoy" not in expected:
        return None

    return calc_preemption_score(
        actual_rev_yoy=actual["revenue_yoy"],
        actual_profit_yoy=actual["profit_yoy"],
        expected_rev_yoy=expected["revenue_yoy"],
        expected_profit_yoy=expected["profit_yoy"],
        price_change_5d=price_change_5d,
    )
