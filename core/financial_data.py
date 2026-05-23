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


def _get_hk_financial_summary(code: str) -> Optional[str]:
    """
    获取港股最新财报核心指标。
    合并两个数据源：
    1. stock_hk_financial_indicator_em: 最新滚动财务指标（实时更新，可能包含季报）
    2. stock_financial_hk_analysis_indicator_em: 历史完整报告（年报/半年报），有报告期和同比
    """
    try:
        import akshare as ak
    except ImportError:
        return None

    # 数据源1: 最新滚动指标（可能包含季报）
    latest = None
    try:
        df = ak.stock_hk_financial_indicator_em(symbol=code)
        if df is not None and not df.empty:
            latest = df.iloc[0]
    except Exception:
        pass

    # 数据源2: 历史完整报告（年报/半年报）
    hist = None
    try:
        df = ak.stock_financial_hk_analysis_indicator_em(symbol=code)
        if df is not None and not df.empty:
            df = df.sort_values("REPORT_DATE", ascending=False)
            hist = df.iloc[0]
    except Exception:
        pass

    if latest is None and hist is None:
        return None

    lines = [f"【财报核心指标 · {code} · 最新可用数据】", ""]

    # 优先展示最新滚动指标（让 AI 看到可能已经包含最新季报）
    if latest is not None:
        revenue = float(latest.get("营业总收入", 0) or 0)
        profit = float(latest.get("净利润", 0) or 0)
        revenue_yi = round(revenue / 1e8, 2) if revenue else 0
        profit_yi = round(profit / 1e8, 2) if profit else 0
        revenue_qoq = float(latest.get("营业总收入滚动环比增长(%)", 0) or 0)
        profit_qoq = float(latest.get("净利润滚动环比增长(%)", 0) or 0)
        eps = float(latest.get("基本每股收益(元)", 0) or 0)
        bps = float(latest.get("每股净资产(元)", 0) or 0)
        roe = float(latest.get("股东权益回报率(%)", 0) or 0)
        net_margin = float(latest.get("销售净利率(%)", 0) or 0)
        pe = float(latest.get("市盈率", 0) or 0)
        pb = float(latest.get("市净率", 0) or 0)

        lines.append("**最新滚动财务指标（可能已包含最新季报）：**")
        lines.append("")
        lines.append("| 指标 | 数值 | 环比 |")
        lines.append("|------|------|------|")
        lines.append(f"| 营业总收入 | {revenue_yi:.2f} 亿元 | {revenue_qoq:+.2f}% |")
        lines.append(f"| 净利润 | {profit_yi:.2f} 亿元 | {profit_qoq:+.2f}% |")
        lines.append(f"| 每股收益 | {eps:.2f} 元 | — |")
        lines.append(f"| 每股净资产 | {bps:.2f} 元 | — |")
        lines.append(f"| 净资产收益率(ROE) | {roe:.2f}% | — |")
        lines.append(f"| 销售净利率 | {net_margin:.2f}% | — |")
        if pe:
            lines.append(f"| 市盈率 | {pe:.2f} | — |")
        if pb:
            lines.append(f"| 市净率 | {pb:.2f} | — |")
        lines.append("")
        lines.append("> 注：以上数据来自东方财富港股实时财务指标，为滚动更新的最新值。")
        lines.append("")

    # 补充历史完整报告期数据（提供同比基准）
    if hist is not None:
        report_date = str(hist.get("REPORT_DATE", ""))[:10]
        fiscal_year = str(hist.get("FISCAL_YEAR", ""))
        eps = float(hist.get("BASIC_EPS", 0) or 0)
        bps = float(hist.get("BPS", 0) or 0)
        roe = float(hist.get("ROE_AVG", 0) or 0)
        roa = float(hist.get("ROA", 0) or 0)
        gross_margin = float(hist.get("GROSS_PROFIT_RATIO", 0) or 0)
        net_margin = float(hist.get("NET_PROFIT_RATIO", 0) or 0)
        revenue = float(hist.get("OPERATE_INCOME", 0) or 0)
        revenue_yoy = float(hist.get("OPERATE_INCOME_YOY", 0) or 0)
        profit = float(hist.get("HOLDER_PROFIT", 0) or 0)
        profit_yoy = float(hist.get("HOLDER_PROFIT_YOY", 0) or 0)
        revenue_yi = round(revenue / 1e8, 2) if revenue else 0
        profit_yi = round(profit / 1e8, 2) if profit else 0

        month_day = report_date[5:10]
        if month_day == "12-31":
            period_label = "年报"
        elif month_day == "06-30":
            period_label = "半年报"
        else:
            period_label = f"报告期({month_day})"

        lines.append(f"**最近完整财报（{fiscal_year}{period_label}，公告日 {report_date}）：**")
        lines.append("")
        lines.append("| 指标 | 数值 | 同比 |")
        lines.append("|------|------|------|")
        lines.append(f"| 营业总收入 | {revenue_yi:.2f} 亿元 | {revenue_yoy:+.2f}% |")
        lines.append(f"| 净利润 | {profit_yi:.2f} 亿元 | {profit_yoy:+.2f}% |")
        lines.append(f"| 每股收益 | {eps:.2f} 元 | — |")
        lines.append(f"| 每股净资产 | {bps:.2f} 元 | — |")
        lines.append(f"| 净资产收益率(ROE) | {roe:.2f}% | — |")
        lines.append(f"| 销售毛利率 | {gross_margin:.2f}% | — |")
        lines.append(f"| 销售净利率 | {net_margin:.2f}% | — |")
        lines.append(f"| 总资产回报率(ROA) | {roa:.2f}% | — |")
        lines.append("")

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

        if notes:
            lines.append("速判：")
            for note in notes:
                lines.append(f"- {note}")
            lines.append("")

        lines.append(f"增速摘要：营收同比增速 {revenue_yoy:+.2f}%，净利润同比增速 {profit_yoy:+.2f}%。")
        lines.append("")

    lines.append("数据来源：[已发布财报 + 实时滚动指标] 东方财富港股财务指标")
    return "\n".join(lines)


def get_quarterly_financial_summary(code: str, market: str = "a") -> Optional[str]:
    """
    获取个股最新季度财报核心指标，返回 Markdown 格式化字符串。

    Args:
        code: 股票代码（A股6位，HK股5位）
        market: 'a' 或 'hk'

    Returns:
        Markdown 格式化字符串，可直接注入 prompt；失败返回 None
    """
    if market == "hk":
        return _get_hk_financial_summary(code)

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

            # 添加机器可解析的增速摘要（供 Preemption 公式评分提取）
            lines.append(f"增速摘要：营收同比增速 {revenue_yoy:+.2f}%，净利润同比增速 {profit_yoy:+.2f}%。")
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


# ── 预期基准数据（用于 Preemption 量化预期差）──────────────────────────────────

def _mock_expectation(code: str) -> str:
    return (
        f"【预期基准数据 · {code}】\n"
        "⚠️ 预期数据获取失败，无法提供市场一致预期或业绩预告。\n"
        "Preemption 将基于历史增速趋势做定性预期差判断。\n"
    )


def get_profit_forecast_summary(code: str) -> Optional[str]:
    """
    获取业绩预告数据（akshare stock_ygyc_em）。
    业绩预告是公司对未来业绩的预告，权威性强但覆盖率低。
    返回 Markdown 格式化字符串。
    """
    try:
        import akshare as ak
    except ImportError:
        return None

    try:
        # akshare 的业绩预告接口，返回全部 A 股业绩预告
        df = ak.stock_ygyc_em()
        row = df[df["股票代码"] == code]
        if len(row) == 0:
            return None

        r = row.iloc[0]
        forecast_type = str(r.get("预告类型", "") or "").strip()
        forecast_reason = str(r.get("预告内容", "") or "").strip()
        profit_change_lower = float(r.get("净利润变动幅度下限", 0) or 0)
        profit_change_upper = float(r.get("净利润变动幅度上限", 0) or 0)
        profit_lower = float(r.get("净利润下限", 0) or 0)
        profit_upper = float(r.get("净利润上限", 0) or 0)
        announce_date = str(r.get("公告日期", "") or "").strip()

        # 计算中值
        profit_change_mid = (profit_change_lower + profit_change_upper) / 2
        profit_mid = (profit_lower + profit_upper) / 2 / 1e8  # 元 -> 亿元

        lines = [
            f"【业绩预告 · {code} · 公告日 {announce_date}】",
            f"",
            f"预告类型：{forecast_type}",
            f"净利润变动幅度：{profit_change_lower:+.2f}% ~ {profit_change_upper:+.2f}%（中值 {profit_change_mid:+.2f}%）",
        ]
        if profit_mid > 0:
            lines.append(f"净利润区间：{profit_lower/1e8:.2f} ~ {profit_upper/1e8:.2f} 亿元（中值 {profit_mid:.2f} 亿元）")
        if forecast_reason:
            lines.append(f"变动原因：{forecast_reason[:200]}")
        lines.append("")
        lines.append("数据来源：[业绩预告] 东方财富")
        lines.append("置信度：高（公司官方预告）")
        return "\n".join(lines)

    except Exception:
        return None


def get_historical_growth_trend(code: str, quarters: int = 4) -> Optional[str]:
    """
    计算最近 N 个季度的营收/净利润同比增速均值，作为"历史隐含预期"基准。
    返回 Markdown 格式化字符串。
    """
    try:
        import akshare as ak
    except ImportError:
        return None

    try:
        dates = _latest_report_dates()
        revenue_yoy_list = []
        profit_yoy_list = []

        for date_str in dates[:quarters]:
            try:
                df = ak.stock_yjbb_em(date=date_str)
                row = df[df["股票代码"] == code]
                if len(row) == 0:
                    continue
                r = row.iloc[0]
                rev_yoy = float(r.get("营业总收入-同比增长", 0) or 0)
                profit_yoy = float(r.get("净利润-同比增长", 0) or 0)
                if rev_yoy != 0:
                    revenue_yoy_list.append(rev_yoy)
                if profit_yoy != 0:
                    profit_yoy_list.append(profit_yoy)
            except Exception:
                continue

        if len(revenue_yoy_list) < 2:
            return None

        avg_rev_yoy = sum(revenue_yoy_list) / len(revenue_yoy_list)
        avg_profit_yoy = sum(profit_yoy_list) / len(profit_yoy_list) if profit_yoy_list else 0

        lines = [
            f"【历史增速趋势 · {code} · 最近 {len(revenue_yoy_list)} 个季度均值】",
            f"",
            f"| 指标 | 均值 | 各季度数值 |",
            f"|------|------|-----------|",
            f"| 营收同比增速 | {avg_rev_yoy:+.2f}% | {', '.join(f'{v:+.1f}%' for v in revenue_yoy_list)} |",
        ]
        if profit_yoy_list:
            lines.append(f"| 净利润同比增速 | {avg_profit_yoy:+.2f}% | {', '.join(f'{v:+.1f}%' for v in profit_yoy_list)} |")

        lines.append("")
        # 趋势判断
        if avg_rev_yoy > 20 and avg_profit_yoy > 20:
            lines.append(f"趋势判断：高双位数增长，市场隐含预期偏乐观（营收+{avg_rev_yoy:.1f}%，净利润+{avg_profit_yoy:.1f}%）。")
        elif avg_rev_yoy > 0 and avg_profit_yoy > 0:
            lines.append(f"趋势判断：正增长，市场隐含预期温和（营收+{avg_rev_yoy:.1f}%，净利润+{avg_profit_yoy:.1f}%）。")
        elif avg_rev_yoy < 0 or avg_profit_yoy < 0:
            lines.append(f"趋势判断：增速下行，市场隐含预期偏保守（营收{avg_rev_yoy:+.1f}%，净利润{avg_profit_yoy:+.1f}%）。")
        else:
            lines.append(f"趋势判断：增速趋零，市场隐含预期中性（营收{avg_rev_yoy:+.1f}%，净利润{avg_profit_yoy:+.1f}%）。")

        lines.append("")
        lines.append("数据来源：[历史财报] 东方财富业绩报表")
        lines.append("置信度：中（基于历史外推，非机构一致预期）")
        return "\n".join(lines)

    except Exception:
        return None


def extract_announce_date(fin_md: str) -> Optional[str]:
    """
    从财报 Markdown 中提取最新财报公告日期。
    返回 YYYY-MM-DD 格式字符串，未找到返回 None。
    """
    import re
    m = re.search(r"财报公告日[：:]\s*(\d{4}-\d{2}-\d{2})", fin_md)
    if m:
        return m.group(1)
    return None


def _get_hk_historical_growth_trend(code: str) -> Optional[str]:
    """
    基于 akshare 港股财务指标计算最近 N 个报告期的营收/净利润同比增速均值。
    """
    try:
        import akshare as ak
    except ImportError:
        return None

    try:
        df = ak.stock_financial_hk_analysis_indicator_em(symbol=code)
        if df is None or df.empty:
            return None

        df = df.sort_values("REPORT_DATE", ascending=False)
        revenue_yoy_list = []
        profit_yoy_list = []

        for _, r in df.head(4).iterrows():
            rev_yoy = float(r.get("OPERATE_INCOME_YOY", 0) or 0)
            profit_yoy = float(r.get("HOLDER_PROFIT_YOY", 0) or 0)
            if rev_yoy != 0:
                revenue_yoy_list.append(rev_yoy)
            if profit_yoy != 0:
                profit_yoy_list.append(profit_yoy)

        if len(revenue_yoy_list) < 2:
            return None

        avg_rev_yoy = sum(revenue_yoy_list) / len(revenue_yoy_list)
        avg_profit_yoy = sum(profit_yoy_list) / len(profit_yoy_list) if profit_yoy_list else 0

        lines = [
            f"【港股历史增速趋势 · {code} · 最近 {len(revenue_yoy_list)} 个报告期均值】",
            f"",
            f"| 指标 | 均值 | 各期数值 |",
            f"|------|------|-----------|",
            f"| 营收同比增速 | {avg_rev_yoy:+.2f}% | {', '.join(f'{v:+.1f}%' for v in revenue_yoy_list)} |",
        ]
        if profit_yoy_list:
            lines.append(f"| 净利润同比增速 | {avg_profit_yoy:+.2f}% | {', '.join(f'{v:+.1f}%' for v in profit_yoy_list)} |")

        lines.append("")
        if avg_rev_yoy > 20 and avg_profit_yoy > 20:
            lines.append(f"趋势判断：高双位数增长，市场隐含预期偏乐观（营收+{avg_rev_yoy:.1f}%，净利润+{avg_profit_yoy:.1f}%）。")
        elif avg_rev_yoy > 0 and avg_profit_yoy > 0:
            lines.append(f"趋势判断：正增长，市场隐含预期温和（营收+{avg_rev_yoy:.1f}%，净利润+{avg_profit_yoy:.1f}%）。")
        elif avg_rev_yoy < 0 or avg_profit_yoy < 0:
            lines.append(f"趋势判断：增速下行，市场隐含预期偏保守（营收{avg_rev_yoy:+.1f}%，净利润{avg_profit_yoy:+.1f}%）。")
        else:
            lines.append(f"趋势判断：增速趋零，市场隐含预期中性（营收{avg_rev_yoy:+.1f}%，净利润{avg_profit_yoy:+.1f}%）。")

        lines.append("")
        lines.append("数据来源：[历史财报] 东方财富港股财务指标")
        lines.append("置信度：中（基于历史外推，非机构一致预期）")
        return "\n".join(lines)

    except Exception:
        return None


def get_expectation_for_stock(code: str, market: str = "a") -> str:
    """
    获取个股预期基准数据，用于 Preemption 量化预期差。

    优先级：
    1. 业绩预告（公司官方预告，权威性最高，但覆盖率低）
    2. 历史增速均值（基于最近4个季度/报告期财报计算，always available）

    返回 Markdown 格式化字符串，可直接注入 prompt。
    """
    sections = []

    # 1. 尝试获取业绩预告（仅 A 股）
    if market == "a":
        forecast = get_profit_forecast_summary(code)
        if forecast:
            sections.append(forecast)

    # 2. 历史增速均值（兜底，always try）
    if market == "a":
        historical = get_historical_growth_trend(code)
    else:
        historical = _get_hk_historical_growth_trend(code)
    if historical:
        sections.append(historical)

    if not sections:
        return _mock_expectation(code)

    header = f"【市场一致预期 / 业绩预告 / 历史隐含预期 · {code}】\n\n"
    header += '以下数据用于量化"预期差"：实际财报数据 vs 市场预期基准。\n'
    header += "Preemption 分析师应基于这些数据计算偏离度，而非主观猜测。\n\n"
    header += "---\n\n"
    return header + "\n\n---\n\n".join(sections)
