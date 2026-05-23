"""
core/sector_context.py
个股所属行业板块的当日相对强弱背景（第一版简化实现）。

数据源：akshare
- stock_individual_info_em：个股所属行业
- stock_board_industry_name_em：全市场行业板块当日涨跌幅排名

目前仅支持 A 股。港股暂因 akshare 行业映射覆盖不全，返回空字符串。
"""
import logging

logger = logging.getLogger(__name__)


def get_sector_context(stock_code: str) -> str:
    """
    获取个股所属行业的当日相对强弱背景。
    返回 Markdown 字符串，可直接注入 prompt。失败返回空字符串。
    """
    # 仅支持 A 股 6 位代码
    if not (len(stock_code) == 6 and stock_code.isdigit()):
        return ""

    try:
        import akshare as ak
    except ImportError:
        logger.warning("[sector] akshare not installed")
        return ""

    # 1. 获取个股所属行业
    try:
        info = ak.stock_individual_info_em(symbol=stock_code)
        sector = info.loc[info["item"] == "行业", "value"].values[0]
    except Exception as e:
        logger.warning(f"[sector] 获取个股 {stock_code} 行业失败: {e}")
        return ""

    # 2. 获取全板块当日排名
    try:
        df = ak.stock_board_industry_name_em()
        df = df.sort_values("涨跌幅", ascending=False).reset_index(drop=True)
        df["rank"] = df.index + 1

        # 3. 定位该板块
        row = df[df["板块名称"] == sector]
        if row.empty:
            logger.warning(f"[sector] 未在板块列表中找到 {sector}")
            return ""

        rank = int(row["rank"].values[0])
        total = len(df)
        pct = float(row["涨跌幅"].values[0])
        percentile = round((1 - rank / total) * 100, 1)

        strength = "强势" if percentile >= 70 else "弱势" if percentile < 30 else "中性"
        flag = ""
        if percentile >= 70:
            flag = "  板块处于市场主线，个股有板块动能支撑"
        elif percentile < 30:
            flag = "  ⚠️ 板块处于市场尾部，行业内个股普遍承压"

        return (
            f"【板块背景】{sector} | 今日排名 {rank}/{total} (前{percentile:.0f}%) | "
            f"板块涨跌 {pct:+.2f}% | 相对强度: {strength}{flag}"
        )
    except Exception as e:
        logger.warning(f"[sector] 获取板块排名失败: {e}")
        return ""
