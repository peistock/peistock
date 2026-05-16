"""
fact_check.py
Research Institute - 事实核查 v2
抽取报告中的关键声明，进行快速交叉验证
"""
import re
import json
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)

# 声明类型正则
CLAIM_PATTERNS = {
    "numeric": re.compile(r"([+-]?\d+\.?\d*%?|[+-]?\d+\.?\d*\s*(?:亿|万|千|百|十|元|美元|USD|CNY|bps|BP|bp))"),
    "price": re.compile(r"(\$|¥|￥|USD|CNY)?\s*\d+\.?\d*\s*(?:亿|万|千|百万|千万)?\s*(?:元|美元|镑|欧元)?"),
    "temporal": re.compile(r"(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日]?|Q[1-4][\s\'\"]?\d{2,4}|\d{4}年|(?:上|本|下)季度|(?:去|今|明)年)"),
    "attribution": re.compile(r"(?:据|根据|来自|数据显示|报告显示|统计|消息称|媒体报道)[^，。；\n]{3,40}"),
}

# 验证提示词
VERIFY_PROMPT = """你是一位严谨的事实核查员。请对以下声明进行快速判断。

规则：
1. 如果声明明显合理（符合常识、无矛盾），回复 "PASS"
2. 如果声明存疑（数字异常、逻辑矛盾、来源不明），回复 "QUESTION: 原因"
3. 如果声明明显错误（违背常识、数据荒谬），回复 "FAIL: 原因"

请逐条判断：

{claims}

输出格式（JSON）：
[{{"claim": "声明原文", "result": "PASS/QUESTION/FAIL", "reason": "判断理由"}}]
"""


def extract_claims(text: str, max_claims: int = 10) -> List[Dict]:
    """从报告中提取关键声明"""
    claims = []

    # 数字声明
    for m in CLAIM_PATTERNS["numeric"].finditer(text):
        claims.append({"type": "numeric", "text": m.group(0), "pos": m.start()})

    # 时间声明
    for m in CLAIM_PATTERNS["temporal"].finditer(text):
        claims.append({"type": "temporal", "text": m.group(0), "pos": m.start()})

    # 归因声明
    for m in CLAIM_PATTERNS["attribution"].finditer(text):
        claims.append({"type": "attribution", "text": m.group(0), "pos": m.start()})

    # 去重：相同文本只保留一次
    seen = set()
    unique = []
    for c in claims:
        key = c["text"].strip()
        if key not in seen and len(key) > 2:
            seen.add(key)
            unique.append(c)

    # 按类型排序，每种类型最多取前 N/3 条
    by_type = {}
    for c in unique:
        by_type.setdefault(c["type"], []).append(c)

    per_type = max(1, max_claims // len(by_type)) if by_type else 0
    result = []
    for t, items in by_type.items():
        result.extend(items[:per_type])

    return result[:max_claims]


def verify_claims(claims: List[Dict], llm_client) -> List[Dict]:
    """用 LLM 验证声明"""
    if not claims or llm_client is None:
        return []

    claim_texts = "\n".join([f"{i+1}. [{c['type']}] {c['text']}" for i, c in enumerate(claims)])
    prompt = VERIFY_PROMPT.format(claims=claim_texts)

    try:
        # 调用 LLM 的 chat 方法
        resp = llm_client.chat(
            system="你是一位严谨的事实核查员，只输出 JSON 格式的判断结果。",
            user_prompt=prompt,
            max_tokens=1500,
            temperature=0.1,
        )
        # 尝试解析 JSON
        json_match = re.search(r'\[.*\]', resp, re.DOTALL)
        if json_match:
            results = json.loads(json_match.group(0))
            return results
    except Exception as e:
        logger.warning(f"Fact-Check LLM 验证失败: {e}")

    return []


def fact_check_report(report_text: str, llm_client, max_claims: int = 8) -> Dict:
    """
    对完整报告进行事实核查
    返回：{{"claims": [...], "verified": [...], "summary": "核查摘要"}}
    """
    claims = extract_claims(report_text, max_claims=max_claims)
    if not claims:
        return {"claims": [], "verified": [], "summary": "未提取到可核查的声明"}

    verified = verify_claims(claims, llm_client)

    # 统计
    pass_count = sum(1 for v in verified if v.get("result") == "PASS")
    question_count = sum(1 for v in verified if v.get("result", "").startswith("QUESTION"))
    fail_count = sum(1 for v in verified if v.get("result", "").startswith("FAIL"))

    summary = f"核查 {len(claims)} 条声明：✅ {pass_count} 通过 / ⚠️ {question_count} 存疑 / ❌ {fail_count} 错误"

    return {
        "claims": claims,
        "verified": verified,
        "summary": summary,
    }


def format_fact_check(result: Dict) -> str:
    """格式化事实核查结果为 Markdown"""
    lines = ["\n---\n", "## 事实核查\n", f"{result.get('summary', '')}\n"]

    for v in result.get("verified", []):
        claim = v.get("claim", "")
        res = v.get("result", "PASS")
        reason = v.get("reason", "")

        if res == "PASS":
            icon = "✅"
        elif res.startswith("FAIL"):
            icon = "❌"
        else:
            icon = "⚠️"

        lines.append(f"{icon} **{claim}** — {res}")
        if reason:
            lines.append(f"   > {reason}")

    return "\n".join(lines)


if __name__ == "__main__":
    text = """
    今日宏观：PMI 50.3，制造业扩张。据国家统计局数据显示，
    4月CPI同比上涨2.1%。美联储将于2024年6月12日召开会议。
    市场预计加息25bps。腾讯股价下跌3.5%，至385港元。
    """
    claims = extract_claims(text, max_claims=8)
    print(f"提取到 {len(claims)} 条声明:")
    for c in claims:
        print(f"  [{c['type']}] {c['text']}")
