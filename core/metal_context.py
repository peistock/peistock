"""
core/metal_context.py
贵金属/有色金属股的宏观关联视角（简化版）。

核心逻辑：金属股的定价由三部分驱动——
1. 金属期货价格（供需）
2. 美元指数 DXY（计价货币）
3. 美债收益率（实际利率/持有成本）

当金属期货涨 + DXY 跌/美债收益率跌 → 宏观环境支持金属股上涨
当金属期货涨 + DXY 涨/美债收益率涨 → 宏观压制，金属股可能滞涨

只获取 20 日变化率，不做复杂打分，让 LLM 自己判断。
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# 行业 → 金属期货 symbol 映射（新浪期货格式）
METAL_MAP = {
    "铜": ("CU0", "沪铜连续"),
    "黄金": ("AU0", "沪金连续"),
    "铝": ("AL0", "沪铝连续"),
    "白银": ("AG0", "沪银连续"),
    "锌": ("ZN0", "沪锌连续"),
    "镍": ("NI0", "沪镍连续"),
    "锡": ("SN0", "沪锡连续"),
    "铅": ("PB0", "沪铅连续"),
}


def _is_metal_stock(industry: str) -> bool:
    """判断行业是否属于贵金属/有色金属。"""
    if not industry:
        return False
    keywords = ("有色", "黄金", "铜", "铝", "白银", "锌", "镍", "锡", "铅", "贵金属", "稀有金属")
    return any(k in industry for k in keywords)


def _detect_metal(industry: str) -> tuple:
    """从行业名称中识别对应的金属期货 symbol。"""
    if not industry:
        return None, None
    for metal, (symbol, name) in METAL_MAP.items():
        if metal in industry:
            return symbol, name
    # 默认：如果行业含"有色"但不含具体金属，默认用铜（有色龙头）
    if "有色" in industry:
        return "CU0", "沪铜连续"
    return None, None


def _get_yfinance_change(ticker: str, days: int = 20) -> Optional[float]:
    """用 yfinance 获取某 ticker 的 N 日涨跌幅（%）。失败返回 None。"""
    try:
        import yfinance as yf
        data = yf.download(ticker, period="3mo", progress=False, auto_adjust=True)
        if data is None or len(data) < days + 1:
            return None
        close = data["Close"].dropna()
        if len(close) < days + 1:
            return None
        old = float(close.iloc[-days - 1])
        new = float(close.iloc[-1])
        if old <= 0:
            return None
        return round((new - old) / old * 100, 2)
    except Exception as e:
        logger.debug("[metal] yfinance %s failed: %s", ticker, e)
        return None


def _get_akshare_future_change(symbol: str, days: int = 20) -> Optional[float]:
    """用 akshare 获取某期货主力合约的 N 日涨跌幅（%）。失败返回 None。"""
    try:
        import akshare as ak
        df = ak.futures_main_sina(symbol=symbol)
        if df is None or len(df) < days + 1:
            return None
        # 列名可能为 日期/开盘价/最高价/最低价/收盘价/成交量/持仓量
        # 或 date/open/high/low/close/volume/position
        close_col = None
        for c in ("收盘价", "close", "Close", "收盘"):
            if c in df.columns:
                close_col = c
                break
        if close_col is None:
            return None
        close = df[close_col].dropna()
        if len(close) < days + 1:
            return None
        old = float(close.iloc[-days - 1])
        new = float(close.iloc[-1])
        if old <= 0:
            return None
        return round((new - old) / old * 100, 2)
    except Exception as e:
        logger.debug("[metal] akshare futures %s failed: %s", symbol, e)
        return None


def _get_dxy_change(days: int = 20) -> Optional[float]:
    """美元指数 DXY 的 N 日变化。优先 yfinance，失败返回 None。"""
    # DX-Y.NYB 是 yfinance 的 DXY 代码；DX=F 是 ICE 期货代码
    for ticker in ("DX-Y.NYB", "DX=F"):
        result = _get_yfinance_change(ticker, days)
        if result is not None:
            return result
    return None


def _get_us10y_change(days: int = 20) -> Optional[float]:
    """美国 10 年期国债收益率的 N 日变化（百分点）。优先 yfinance，失败返回 None。"""
    try:
        import yfinance as yf
        data = yf.download("^TNX", period="3mo", progress=False, auto_adjust=True)
        if data is None or len(data) < days + 1:
            return None
        close = data["Close"].dropna()
        if len(close) < days + 1:
            return None
        old = float(close.iloc[-days - 1])
        new = float(close.iloc[-1])
        # 返回百分点变化（如从 4.2% 到 4.5% = +0.30）
        return round(new - old, 2)
    except Exception as e:
        logger.debug("[metal] yfinance ^TNX failed: %s", e)
        return None


def get_metal_context(stock_code: str, industry: str = "", stock_change_20d: Optional[float] = None) -> str:
    """
    针对贵金属/有色金属股，获取宏观关联视角的 Markdown 字符串。
    可直接注入 Bull/Bear/Chair prompt。非金属股返回空字符串。
    如果 industry 为空，会自动尝试通过 akshare 获取个股所属行业。
    """
    # 如果 industry 为空，尝试自动获取
    if not industry:
        try:
            import akshare as ak
            info = ak.stock_individual_info_em(symbol=stock_code)
            industry = info.loc[info["item"] == "行业", "value"].values[0]
        except Exception:
            pass

    if not _is_metal_stock(industry):
        return ""

    symbol, metal_name = _detect_metal(industry)
    if not symbol:
        return ""

    # 获取三个宏观数据点
    dxy_chg = _get_dxy_change(days=20)
    bond_chg = _get_us10y_change(days=20)
    metal_chg = _get_akshare_future_change(symbol, days=20)

    # 如果 akshare 期货失败，尝试 yfinance 的 COMEX/LME 对应品
    if metal_chg is None:
        yf_map = {"CU0": "HG=F", "AU0": "GC=F", "AL0": "ALI=F", "AG0": "SI=F",
                  "ZN0": "ZN=F", "NI0": "NI=F", "SN0": "SN=F", "PB0": "PB=F"}
        yf_ticker = yf_map.get(symbol)
        if yf_ticker:
            metal_chg = _get_yfinance_change(yf_ticker, days=20)

    # 如果所有数据都拿不到，返回空（不阻断流程）
    if dxy_chg is None and bond_chg is None and metal_chg is None:
        return ""

    lines = [f"【宏观关联视角】（{metal_name}股专用）", ""]

    def _fmt(v):
        return f"{v:+.2f}%" if v is not None else "N/A"

    lines.append(f"- 美元指数(DXY) 20日变化: {_fmt(dxy_chg)}")
    lines.append(f"- 10年期美债收益率 20日变化: {bond_chg:+.2f}个基点" if bond_chg is not None else "- 10年期美债收益率 20日变化: N/A")
    lines.append(f"- {metal_name}期货 20日涨跌: {_fmt(metal_chg)}")
    if stock_change_20d is not None:
        lines.append(f"- 该股 20日涨跌: {stock_change_20d:+.2f}%")
        if metal_chg is not None:
            divergence = round(stock_change_20d - metal_chg, 2)
            lines.append(f"- 股期偏离（股票-期货）: {divergence:+.2f}%")
            if divergence > 5:
                lines.append("  → 股票涨幅显著领先期货，可能意味着资金在预判金属涨价")
            elif divergence < -5:
                lines.append("  → 期货涨而股票滞涨，可能意味着预期已兑现或宏观压制")

    lines.append("")
    lines.append("提示：金属股的定价逻辑是'预期金属价格'而非'跟踪金属价格'。")
    lines.append("若美元走弱且美债收益率下行，即使金属价格未大涨，宏观环境也支持金属股；")
    lines.append("若美元走强且美债收益率上行，即使金属价格坚挺，金属股也可能受压。")
    return "\n".join(lines)
