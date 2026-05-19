"""
core/macro_industry_analyst.py
宏观-行业联动分析师。整合 akshare 宏观数据 + 板块强弱分析，
输出带评分的结构化报告供 Chair 裁决参考。

数据源：
- 宏观：akshare macro_china_*, macro_usa_*（生产环境已验证可用）
- 行业：本地映射表 + 腾讯 API 板块/ETF 行情
"""
import json
import logging
from typing import Dict, List, Optional, Tuple
from datetime import datetime

logger = logging.getLogger(__name__)

# 股票代码 → 行业映射（基于 peistock 默认股票池 + 常见港股）
# 不足部分运行时 fallback 到 "未知行业"
_STOCK_SECTOR_MAP: Dict[str, str] = {
    # 白酒
    "600519": "白酒", "000858": "白酒", "000568": "白酒", "002304": "白酒",
    "600809": "白酒", "600702": "白酒", "600779": "白酒", "000596": "白酒",
    # 券商/金融
    "600030": "券商信托", "300059": "券商信托", "600837": "券商信托",
    "601688": "券商信托", "600999": "券商信托", "601211": "券商信托",
    "00388": "券商信托", "02328": "券商信托",
    # 银行
    "600036": "银行", "601398": "银行", "601288": "银行", "601939": "银行",
    "601988": "银行", "000001": "银行",
    # 电力
    "600900": "电力", "600011": "电力", "600795": "电力", "601985": "电力",
    "003816": "电力", "00902": "电力", "00836": "电力",
    # 煤炭
    "601088": "煤炭", "601225": "煤炭", "600188": "煤炭", "601699": "煤炭",
    "600546": "煤炭", "01171": "煤炭",
    # 光伏/新能源
    "601012": "光伏", "300274": "光伏", "600438": "光伏", "002459": "光伏",
    "688599": "光伏", "600089": "光伏",
    # 半导体
    "688981": "半导体", "603501": "半导体", "002371": "半导体", "300782": "半导体",
    "688012": "半导体", "688008": "半导体", "00981": "半导体", "00700": "半导体",
    # 医药
    "600276": "医药", "000538": "医药", "600436": "医药", "300760": "医药",
    "603259": "医药", "300122": "医药", "02269": "医药",
    # 汽车
    "002594": "汽车", "601127": "汽车", "000625": "汽车", "601633": "汽车",
    "601238": "汽车", "09888": "汽车", "01211": "汽车",
    # 食品饮料
    "600887": "食品饮料", "603288": "食品饮料", "000895": "食品饮料",
    "300999": "食品饮料", "002507": "食品饮料",
    # 家电
    "000333": "家电", "000651": "家电", "600690": "家电",
    # 通信
    "600941": "通信", "000063": "通信", "600050": "通信", "00762": "通信",
    # 石油石化
    "601857": "石油石化", "600028": "石油石化", "00883": "石油石化",
    # 有色/贵金属
    "600547": "贵金属", "601899": "贵金属", "002155": "贵金属",
    "600489": "贵金属", "01787": "贵金属", "02899": "贵金属",
    # 地产
    "000002": "地产", "600048": "地产", "001979": "地产",
    # 互联网/科技（港股为主）
    "00700": "互联网", "09988": "互联网", "09618": "互联网", "03690": "互联网",
    "01024": "互联网", "02015": "互联网", "06690": "互联网",
    # 消费电子
    "002475": "消费电子", "300433": "消费电子", "601138": "消费电子",
    "01478": "消费电子",
    # 军工
    "600760": "军工", "600893": "军工", "000768": "军工",
}

# 行业 → 代表性 ETF/板块代码（腾讯 quote API 用）
# 格式：sh/sz + 6位代码（A股ETF）或 hk + 5位（港股ETF）
_SECTOR_BENCHMARKS: Dict[str, List[str]] = {
    "白酒": ["sh512690"],           # 酒ETF
    "券商信托": ["sh512000"],        # 券商ETF
    "银行": ["sh512800"],            # 银行ETF
    "电力": ["sh560580"],            # 电力ETF
    "煤炭": ["sh515220"],            # 煤炭ETF
    "光伏": ["sh515790"],            # 光伏ETF
    "半导体": ["sh512480"],          # 半导体ETF
    "医药": ["sh512010"],            # 医药ETF
    "汽车": ["sh516110"],            # 汽车ETF
    "食品饮料": ["sh515170"],        # 食品饮料ETF
    "家电": ["sh560880"],            # 家电ETF
    "通信": ["sh515880"],            # 通信ETF
    "石油石化": ["sh513350"],        # 油气ETF
    "贵金属": ["sh518880"],          # 黄金ETF
    "地产": ["sh512200"],            # 地产ETF
    "互联网": ["sh513050"],          # 中概互联ETF
    "消费电子": ["sh561100"],        # 消费电子ETF
    "军工": ["sh512660"],            # 军工ETF
}


def _get_stock_sector(stock_code: str) -> str:
    """获取股票所属行业。先查映射表，未命中尝试 akshare（仅A股）。"""
    sector = _STOCK_SECTOR_MAP.get(stock_code, "")
    if sector:
        return sector
    # A 股 6 位数字尝试 akshare
    if len(stock_code) == 6 and stock_code.isdigit():
        try:
            import akshare as ak
            info = ak.stock_individual_info_em(symbol=stock_code)
            sector = info.loc[info["item"] == "行业", "value"].values[0]
            if sector:
                return sector
        except Exception:
            pass
    return "未知行业"


def _fetch_tencent_quotes(codes: List[str]) -> Dict[str, Dict]:
    """通过腾讯 API 批量获取行情。codes 格式如 ['sh512000','sh512690']"""
    result: Dict[str, Dict] = {}
    if not codes:
        return result
    try:
        import requests
        url = f"http://qt.gtimg.cn/q={','.join(codes)}"
        resp = requests.get(url, timeout=15)
        resp.encoding = "gb2312"
        text = resp.text
        for line in text.split(";"):
            line = line.strip()
            if not line or "v_" not in line:
                continue
            # 格式: v_sh512000="1~券商ETF~..."
            prefix, _, data = line.partition("=\"")
            if not data:
                continue
            code_key = prefix.split("v_")[-1]  # sh512000
            parts = data.rstrip("\"").split("~")
            if len(parts) < 45:
                continue
            result[code_key] = {
                "name": parts[1],
                "price": float(parts[3]) if parts[3] else 0.0,
                "prev_close": float(parts[4]) if parts[4] else 0.0,
                "open": float(parts[5]) if parts[5] else 0.0,
                "high": float(parts[33]) if parts[33] else 0.0,
                "low": float(parts[34]) if parts[34] else 0.0,
                "change_pct": float(parts[32]) if parts[32] else 0.0,
                "volume": int(float(parts[36])) if parts[36] else 0,
            }
    except Exception as e:
        logger.warning(f"[macro_industry] 腾讯行情获取失败: {e}")
    return result


def _fetch_sector_momentum(sector: str) -> Optional[Dict]:
    """获取指定行业的板块强弱数据。返回 {rank, total, change_pct, strength} 或 None。"""
    benchmarks = _SECTOR_BENCHMARKS.get(sector)
    if not benchmarks:
        return None
    quotes = _fetch_tencent_quotes(benchmarks)
    if not quotes:
        return None
    # 取第一个 benchmark
    q = list(quotes.values())[0]
    change_pct = q.get("change_pct", 0.0)
    # 简单强度分级
    if change_pct >= 2.0:
        strength = "极强"
    elif change_pct >= 1.0:
        strength = "强势"
    elif change_pct >= 0.0:
        strength = "中性偏多"
    elif change_pct >= -1.0:
        strength = "中性偏空"
    elif change_pct >= -2.0:
        strength = "弱势"
    else:
        strength = "极弱"
    return {
        "sector": sector,
        "change_pct": change_pct,
        "strength": strength,
        "etf_name": q.get("name", ""),
        "price": q.get("price", 0.0),
    }


def _fetch_macro_data() -> Dict:
    """获取最新宏观数据。失败返回空 dict，不阻断流程。"""
    data: Dict = {}
    try:
        import akshare as ak
        # 中国 PMI（数据按时间倒序，iloc[0]为最新）
        try:
            df = ak.macro_china_pmi()
            if not df.empty:
                latest = df.iloc[0]
                data["china_pmi"] = {
                    "date": str(latest.get("月份", "")),
                    "pmi": float(latest.get("制造业-指数", 0) or 0),
                    "yoy": float(latest.get("制造业-同比增长", 0) or 0),
                }
        except Exception as e:
            logger.warning(f"[macro] PMI fetch failed: {e}")

        # 中国 CPI（月度同比数据，iloc[0]为最新）
        try:
            df = ak.macro_china_cpi()
            if not df.empty:
                latest = df.iloc[0]
                data["china_cpi"] = {
                    "date": str(latest.get("月份", "")),
                    "cpi_yoy": float(latest.get("全国-同比增长", 0) or 0),
                }
        except Exception as e:
            logger.warning(f"[macro] CPI fetch failed: {e}")

        # 中国货币供应 M2（iloc[0]为最新）
        try:
            df = ak.macro_china_money_supply()
            if not df.empty:
                latest = df.iloc[0]
                data["china_m2"] = {
                    "date": str(latest.get("月份", "")),
                    "m2_yoy": float(latest.get("货币和准货币(M2)-同比增长", 0) or 0),
                }
        except Exception as e:
            logger.warning(f"[macro] M2 fetch failed: {e}")

        # 美国核心 CPI（事件日历格式，取最新非NaN的今值）
        try:
            df = ak.macro_usa_core_cpi_monthly()
            if not df.empty:
                df_valid = df.dropna(subset=["今值"])
                if not df_valid.empty:
                    latest = df_valid.iloc[-1]  # 事件日历按时间正序，最后一条最新
                    data["usa_cpi"] = {
                        "date": str(latest.get("日期", "")),
                        "core_cpi": float(latest.get("今值", 0) or 0),
                    }
        except Exception as e:
            logger.warning(f"[macro] USA CPI fetch failed: {e}")

        # 中国 LPR 利率（iloc[-1]为最新，按日期正序）
        try:
            df = ak.macro_china_lpr()
            if not df.empty:
                latest = df.iloc[-1]
                data["china_rate"] = {
                    "date": str(latest.get("TRADE_DATE", "")),
                    "rate": float(latest.get("LPR1Y", 0) or 0),
                }
        except Exception as e:
            logger.warning(f"[macro] LPR fetch failed: {e}")

    except ImportError:
        logger.warning("[macro] akshare not installed")
    return data


def _score_macro(data: Dict) -> Tuple[float, str]:
    """
    对宏观环境打分，范围 -30 ~ +30。
    返回 (score, reasoning)
    """
    score = 0.0
    reasons: List[str] = []

    # PMI
    pmi = data.get("china_pmi", {})
    pmi_val = pmi.get("pmi", 0)
    if pmi_val >= 50.5:
        score += 8
        reasons.append(f"中国制造业PMI {pmi_val}，扩张强劲")
    elif pmi_val >= 50.0:
        score += 3
        reasons.append(f"中国制造业PMI {pmi_val}，温和扩张")
    elif pmi_val >= 49.0:
        score -= 3
        reasons.append(f"中国制造业PMI {pmi_val}，临近收缩")
    else:
        score -= 8
        reasons.append(f"中国制造业PMI {pmi_val}，明显收缩")

    # CPI
    cpi = data.get("china_cpi", {})
    cpi_yoy = cpi.get("cpi_yoy", 0)
    if cpi_yoy >= 2.5:
        score -= 5
        reasons.append(f"中国CPI同比 {cpi_yoy}%，通胀偏高，货币政策受限")
    elif cpi_yoy >= 1.0:
        score += 2
        reasons.append(f"中国CPI同比 {cpi_yoy}%，温和通胀，环境舒适")
    else:
        score -= 2
        reasons.append(f"中国CPI同比 {cpi_yoy}%，低通胀，需求偏弱")

    # M2
    m2 = data.get("china_m2", {})
    m2_yoy = m2.get("m2_yoy", 0)
    if m2_yoy >= 12:
        score += 5
        reasons.append(f"M2同比 {m2_yoy}%，流动性充裕")
    elif m2_yoy >= 8:
        score += 2
        reasons.append(f"M2同比 {m2_yoy}%，流动性适中")
    else:
        score -= 3
        reasons.append(f"M2同比 {m2_yoy}%，流动性偏紧")

    # 美国核心 CPI
    us_cpi = data.get("usa_cpi", {})
    us_cpi_val = us_cpi.get("core_cpi", 0)
    if us_cpi_val >= 3.5:
        score -= 8
        reasons.append(f"美国核心CPI {us_cpi_val}%，美联储维持高压")
    elif us_cpi_val >= 2.5:
        score -= 4
        reasons.append(f"美国核心CPI {us_cpi_val}%，降息预期延后")
    else:
        score += 4
        reasons.append(f"美国核心CPI {us_cpi_val}%，降息空间打开")

    # 利率
    rate = data.get("china_rate", {})
    rate_val = rate.get("rate", 0)
    if rate_val >= 3.0:
        score -= 3
        reasons.append(f"银行间利率 {rate_val}%，资金成本高")
    elif rate_val <= 1.5:
        score += 3
        reasons.append(f"银行间利率 {rate_val}%，资金成本低")

    score = max(-30, min(30, score))
    return score, "；".join(reasons)


def _score_industry(sector_momentum: Optional[Dict]) -> Tuple[float, str]:
    """
    对行业板块打分，范围 -20 ~ +20。
    返回 (score, reasoning)
    """
    if not sector_momentum:
        return 0.0, "行业板块数据暂不可用"

    change_pct = sector_momentum.get("change_pct", 0)
    sector = sector_momentum.get("sector", "")
    strength = sector_momentum.get("strength", "")

    score = 0.0
    if change_pct >= 3.0:
        score = 15
    elif change_pct >= 2.0:
        score = 12
    elif change_pct >= 1.0:
        score = 8
    elif change_pct >= 0.5:
        score = 4
    elif change_pct >= 0:
        score = 1
    elif change_pct >= -0.5:
        score = -1
    elif change_pct >= -1.0:
        score = -4
    elif change_pct >= -2.0:
        score = -8
    else:
        score = -12

    reasoning = f"{sector}板块今日涨跌 {change_pct:+.2f}%，强度{strength}"
    return score, reasoning


def generate_macro_industry_report(stock_code: str) -> str:
    """
    生成宏观-行业联动分析报告。
    返回 Markdown 字符串，可直接注入 Chair / Bull / Bear prompt。
    """
    sector = _get_stock_sector(stock_code)
    macro_data = _fetch_macro_data()
    sector_momentum = _fetch_sector_momentum(sector) if sector != "未知行业" else None

    macro_score, macro_reason = _score_macro(macro_data)
    industry_score, industry_reason = _score_industry(sector_momentum)

    total_score = macro_score + industry_score
    total_score = max(-50, min(50, total_score))

    # 置信度：数据越多越可信
    data_points = sum(1 for v in macro_data.values() if v)
    conviction = min(85, 40 + data_points * 8)
    if sector == "未知行业":
        conviction = int(conviction * 0.7)

    # 方向判断
    if total_score >= 15:
        direction = "偏多"
    elif total_score >= 5:
        direction = "轻度偏多"
    elif total_score >= -5:
        direction = "中性"
    elif total_score >= -15:
        direction = "轻度偏空"
    else:
        direction = "偏空"

    lines = [
        f"## 宏观-行业联动分析（{datetime.now().strftime('%Y-%m-%d')}）",
        "",
        f"### 综合评分：{total_score:+.0f}（{direction}）",
        f"- 宏观环境得分：{macro_score:+.0f}",
        f"- 行业板块得分：{industry_score:+.0f}",
        f"- 置信度：{conviction}/100",
        "",
        "### 宏观环境",
    ]

    if macro_data:
        for key, val in macro_data.items():
            if not val:
                continue
            date_str = val.get("date", "")
            if key == "china_pmi":
                lines.append(f"- 中国制造业PMI：{val.get('pmi', 'N/A')}（{date_str}）")
            elif key == "china_cpi":
                lines.append(f"- 中国CPI同比：{val.get('cpi_yoy', 'N/A')}%（{date_str}）")
            elif key == "china_m2":
                lines.append(f"- M2同比：{val.get('m2_yoy', 'N/A')}%（{date_str}）")
            elif key == "usa_cpi":
                lines.append(f"- 美国核心CPI同比：{val.get('core_cpi', 'N/A')}%（{date_str}）")
            elif key == "china_rate":
                lines.append(f"- 银行间利率：{val.get('rate', 'N/A')}%（{date_str}）")
    else:
        lines.append("- 宏观数据暂不可用")

    lines.extend([
        "",
        "### 行业板块",
    ])

    if sector_momentum:
        lines.extend([
            f"- 所属板块：{sector_momentum.get('sector', '')}",
            f"- 板块ETF：{sector_momentum.get('etf_name', '')}（{sector_momentum.get('price', 0):.3f}）",
            f"- 今日涨跌：{sector_momentum.get('change_pct', 0):+.2f}%",
            f"- 强度评级：{sector_momentum.get('strength', '')}",
        ])
    else:
        lines.append(f"- 所属板块：{sector}（板块行情数据暂不可用）")

    lines.extend([
        "",
        "### 评分逻辑",
        f"- {macro_reason}",
        f"- {industry_reason}",
        "",
        "### 对 Chair 的明确建议",
    ])

    if total_score >= 10:
        lines.append(f"**{direction}**。宏观或行业至少有一端提供正向支撑，建议维持/看多方向，关注宏观拐点风险。")
    elif total_score <= -10:
        lines.append(f"**{direction}**。宏观或行业存在明显压制，建议降低仓位或缩短持有期，等待环境改善。")
    else:
        lines.append(f"**{direction}**。宏观与行业信号不强烈，建议以技术面和个股基本面为主，宏观因素不主导决策。")

    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    # 本地快速测试
    print(generate_macro_industry_report("600519"))
    print("\n" + "=" * 60 + "\n")
    print(generate_macro_industry_report("00388"))
