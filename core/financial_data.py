"""
core/financial_data.py
季度财报核心指标获取（A股），带 mock fallback

通过 akshare stock_yjbb_em 拉取业绩报表，提取最新季度关键数据，
直接注入 Analyst prompt，避免 LLM 基于趋势推演猜测财报数字。
"""
from datetime import datetime
from typing import Optional


def _latest_report_dates() -> list:
    """按优先级返回可能的最业绩报表日期（YYYYMMDD 季度末）"""
    now = datetime.now()
    year = now.year
    month = now.month

    # 业绩披露时间线：
 # 1-4月：上一年年报(1231) + 当年Q1(0331)陆续披露
    # 5-8月：Q1(0331) 已披露完毕，Q2(0631) 陆续披露
    # 9-10月：Q2(0630) 已披露完毕，Q3(0930) 陆续披露
    # 11-12月：Q3(0930) 已披露完毕
    if month <= 4:
        return [f"{year}0331", f"{year - 1}1231", f"{year - 1}0930"]
    if month <= 8:
        return [f"{year}0331", f"{year}0630", f"{year - 1}1231"]
    if month <= 10:
        return [f"{year}0630", f"{year}0331", f"{year - 1}1231"]
    return [f"{year}0930", f"{year}0630", f"{year}0331"]


def _mock_financial_summary(code: str) -> str:
    """mock fallback：返回占位提示，让 LLM 知道数据不可用"""
    return (
        f"【季度财报数据 · {code}】\n"
        "⚠️ 数据获取失败，无法提供最新季度财务指标。\n"
        "请基于预注入的其他数据源（研报、技术指标、新闻）进行分析。\n"
    )


def get_quarterly_financial_summary(code: str, market: str = "a") -> Optional[str]:
    """
    获取个股最新季度财报核心指标，返回 Markdown 格式化字符串。

    Args:
        code: 股票代码（A股6位，HK股5位）
        market: 'a' 或 'hk'，当前仅支持 A 股

    Returns:
        Markdown 格式化字符串，可直接注入 prompt；失败返回 None
    """
    if market != "a":
        # HK 暂不实现，返回 mock 占位
        return _mock_financial_summary(code)

    try:
        import akshare as ak
    except ImportError:
        return _mock_financial_summary(code)

    dates = _latest_report_dates()
    for date_str in dates:
        try:
            df = ak.stock_yjbb_em(date=date_str)
            row = df[df["股票代码"] == code]
            if len(row) == 0:
                continue

            r = row.iloc[0]
            # 提取核心字段（带安全兜底）
            eps = float(r.get("每股收益", 0) or 0)
            revenue = float(r.get("营业总收入-营业总收入", 0) or 0)
            revenue_yoy = float(r.get("营业总收入-同比增长", 0) or 0)
            revenue_qoq = float(r.get("营业总收入-季度环比增长", 0) or 0)
            net_profit = float(r.get("净利润-净利润", 0) or 0)
            profit_yoy = float(r.get("净利润-同比增长", 0) or 0)
            profit_qoq = float(r.get("净利润-季度环比增长", 0) or 0)
            bps = float(r.get("每股净资产", 0) or 0)
            roe = float(r.get("净资产收益率", 0) or 0)
            ocf_per_share = float(r.get("每股经营现金流量", 0) or 0)
            gross_margin = float(r.get("销售毛利率", 0) or 0)
            announce_date = str(r.get("最新公告日期", ""))
            industry = str(r.get("所处行业", ""))

            # 单位转换：元 → 亿元（保留2位小数）
            revenue_yi = round(revenue / 1e8, 2) if revenue else 0
            profit_yi = round(net_profit / 1e8, 2) if net_profit else 0

            # 季度中文描述
            q_map = {"0331": "Q1", "0630": "Q2", "0930": "Q3", "1231": "Q4/年报"}
            quarter_label = q_map.get(date_str[-4:], date_str)
            year_label = date_str[:4]

            lines = [
                f"【季度财报核心指标 · {code} · {year_label}{quarter_label}】",
                f"",
                f"| 指标 | 数值 | 同比 | 环比 |",
                f"|------|------|------|------|",
                f"| 营业总收入 | {revenue_yi:.2f} 亿元 | {revenue_yoy:+.2f}% | {revenue_qoq:+.2f}% |",
                f"| 净利润 | {profit_yi:.2f} 亿元 | {profit_yoy:+.2f}% | {profit_qoq:+.2f}% |",
                f"| 每股收益 | {eps:.2f} 元 | — | — |",
                f"| 每股净资产 | {bps:.2f} 元 | — | — |",
                f"| 净资产收益率(ROE) | {roe:.2f}% | — | — |",
                f"| 销售毛利率 | {gross_margin:.2f}% | — | — |",
                f"| 每股经营现金流 | {ocf_per_share:.4f} 元 | — | — |",
                f"",
                f"所处行业：{industry}",
                f"财报公告日：{announce_date}",
                f"",
            ]

            # 添加速判注释（帮助 LLM 快速理解）
            notes = []
            if profit_yoy > 30:
                notes.append(f"净利润同比高增 {profit_yoy:+.2f}%，盈利动能强劲。")
            elif profit_yoy < 0:
                notes.append(f"净利润同比负增长 {profit_yoy:.2f}%，盈利承压。")

            if revenue_yoy > 30:
                notes.append(f"营收同比高增 {revenue_yoy:+.2f}%，规模扩张迅速。")
            elif revenue_yoy < 0:
                notes.append(f"营收同比负增长 {revenue_yoy:.2f}%，收入萎缩。")

            if gross_margin > 40:
                notes.append(f"毛利率 {gross_margin:.2f}% 处于较高水平。")
            elif gross_margin < 15:
                notes.append(f"毛利率 {gross_margin:.2f}% 偏低，盈利空间薄。")

            if roe > 10:
                notes.append(f"ROE {roe:.2f}% 优秀，股东回报能力强。")
            elif roe < 3:
                notes.append(f"ROE {roe:.2f}% 偏低，资本效率不足。")

            if notes:
                lines.append("速判：")
                for note in notes:
                    lines.append(f"- {note}")
                lines.append("")

            lines.append("数据来源：[已发布财报] 东方财富业绩报表")
            return "\n".join(lines)

        except Exception:
            continue

    # 所有日期均失败
    return _mock_financial_summary(code)


def get_quarterly_financial_for_prompt(code: str, market: str = "a") -> str:
    """
    便捷封装：始终返回字符串（失败时返回 mock 占位，保证 prompt 不断裂）
    """
    result = get_quarterly_financial_summary(code, market)
    return result if result else _mock_financial_summary(code)
