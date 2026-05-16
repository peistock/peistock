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

额外检查（时间线一致性）：
- 若报告中同时出现"预计/即将/等待/下周/待发布/将发布"等未来时间标记，又出现具体的财务数据（如"营收同比+11%""净利润增长+20%"），必须标记为 QUESTION 或 FAIL
- 若日期声明与当前已知时间线明显矛盾（如 2026 年 5 月称"Q1 财报即将发布"但又有具体 Q1 营收数字），必须标记为 QUESTION
- 若财务数据未标注来源或来源标注与数据性质不符（如将市场预期标为已发布财报），必须标记为 QUESTION

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


def check_temporal_contradictions(text: str) -> List[Dict]:
    """规则层预扫描：检测明显的时间线矛盾"""
    contradictions = []

    # 步骤1: 找出所有"未来发布"标记的位置
    future_kw = re.compile(r'预计|即将|等待|下周|待发布|将发布|未发布|未披露')
    report_kw = re.compile(r'财报|业绩|季报|年报')
    future_positions = []
    for m in future_kw.finditer(text):
        future_positions.append(m.start())

    # 步骤2: 检查是否有"财报"关键词在"未来标记"附近（30字符内）
    has_future_report = False
    for m in report_kw.finditer(text):
        report_pos = m.start()
        for fp in future_positions:
            if abs(report_pos - fp) <= 30:
                has_future_report = True
                break
        if has_future_report:
            break

    # 步骤3: 找出具体的财务数据（带同比/环比的具体百分比，排除范围）
    fin_expr = re.compile(
        r'(?:Q[1-4]|季度)[^\n，。；]{0,30}(?:营收|收入|利润|净利润|EPS|毛利)[^\n，。；]{0,15}(?:同比|环比)[^\n，。；]{0,5}[+-]?\d+\.?\d*%(?!-|~|至)',
        re.IGNORECASE
    )
    fin_match = fin_expr.search(text)
    has_financial = bool(fin_match)

    # 步骤4: 若同时满足，且财务数据附近不含"预期"标记，则判定矛盾
    if has_future_report and has_financial:
        # 检查财务数据前面最多 20 个字符是否有"预期"类标记
        pre_ctx = text[max(0, fin_match.start()-20):fin_match.start()]
        is_expectation = bool(re.search(r'(?:预期|一致预期|市场共识|分析师预测)', pre_ctx))
        if not is_expectation:
            contradictions.append({
                "claim": "报告中同时出现'预计发布财报'和具体财务数据",
                "result": "QUESTION: 时间线矛盾 — 若财报尚未发布，不应引用具体营收/利润数字；若已有具体数字，则财报应已发布",
                "reason": "规则预扫描发现'未来发布'标记与具体财务数据并存"
            })

    # 模式2: 同一季度既被描述为"已披露"又被描述为"即将披露"
    quarter_patterns = re.compile(r'(?:Q[1-4]|第[一二三四]季度).{0,30}(?:202[5-6])')
    for m in quarter_patterns.finditer(text):
        ctx_start = max(0, m.start() - 50)
        ctx_end = min(len(text), m.end() + 50)
        ctx = text[ctx_start:ctx_end]
        if re.search(r'(?:预计|即将|等待|下周|待发布)', ctx) and re.search(r'(?:已披露|已发布|同比上涨|同比增长|环比下降)', ctx):
            contradictions.append({
                "claim": f"同一季度({m.group(0)})既被描述为即将发布又引用已发布数据",
                "result": "QUESTION: 时间线矛盾 — 同一事件不能同时处于'未发生'和'已发生'状态",
                "reason": "规则预扫描发现同一季度在上下文中时态矛盾"
            })
            break  # 只报告一次同类矛盾

    return contradictions


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

    # 规则层预扫描：时间线矛盾
    temporal_issues = check_temporal_contradictions(report_text)

    if not claims and not temporal_issues:
        return {"claims": [], "verified": [], "summary": "未提取到可核查的声明"}

    verified = verify_claims(claims, llm_client) if claims else []

    # 合并规则层预扫描结果
    if temporal_issues:
        verified = temporal_issues + verified

    # 统计
    pass_count = sum(1 for v in verified if v.get("result") == "PASS")
    question_count = sum(1 for v in verified if v.get("result", "").startswith("QUESTION"))
    fail_count = sum(1 for v in verified if v.get("result", "").startswith("FAIL"))

    summary = f"核查 {len(claims)} 条声明 + {len(temporal_issues)} 条规则扫描：✅ {pass_count} 通过 / ⚠️ {question_count} 存疑 / ❌ {fail_count} 错误"

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
