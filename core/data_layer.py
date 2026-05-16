"""
core/data_layer.py
Real data sources: AKShare (A-share, HK) + yfinance (US)
With graceful fallback to mock data when sources fail
"""
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional

# HSI 主要科技龙头 (用于 HK leader dispersion / market breadth proxy)
HK_TECH_LEADERS = ["00700", "09988", "03690", "01810", "09618", "09888", "09999", "06618"]

# HK 流通股本兜底 (单位: 股) — akshare HK 个股的流通股不稳定时使用
# TODO: 后续可改用 yfinance Ticker.info.sharesOutstanding 补全
HK_CAPITAL_OVERRIDES = {
    "00700": 9_239_000_000,   # 腾讯
    "09988": 21_290_000_000,  # 阿里巴巴
    "03690": 6_125_000_000,   # 美团
    "01810": 13_546_000_000,  # 小米
    "09618": 3_242_000_000,   # 京东
    "09888": 269_000_000,     # 百度
    "09999": 327_000_000,     # 网易
    "06618": 1_310_000_000,   # 京东健康
    "00388": 1_267_000_000,   # 港交所
    "00939": 250_000_000_000, # 建设银行 (H股)
    "00883": 30_510_000_000,  # 中海油
    "00005": 18_650_000_000,  # 汇丰
    "02601": 2_775_300_000,   # 中国太保(H)
    "02328": 6_899_293_833,   # 中国财险
    "01339": 8_726_234_000,   # 中国人民保险集团
    "01508": 6_679_416_700,   # 中国再保险
    "02888": 2_213_187_803,   # 渣打集团
}


def _market_of(code: str) -> str:
    """A/HK 路由:5 位 → HK,6 位 → A。"""
    code = str(code).strip()
    if len(code) == 5 and code.isdigit():
        return "hk"
    if len(code) == 6 and code.isdigit():
        return "a"
    raise ValueError(f"unknown market for code={code!r}; expect 5-digit (HK) or 6-digit (A)")


class DataLayer:
    """Unified data entry with fallback"""

    def __init__(self):
        self._ak = None
        self._yf = None
        self._cache = {}
        self._mock_sources: set = set()

    def clear_mock_sources(self):
        self._mock_sources.clear()

    def get_mock_sources(self) -> List[str]:
        return sorted(self._mock_sources)

    def has_mock(self) -> bool:
        return len(self._mock_sources) > 0

    def _init_akshare(self):
        if self._ak is None:
            try:
                import akshare as ak
                self._ak = ak
            except ImportError:
                self._ak = False

    def _init_yfinance(self):
        if self._yf is None:
            try:
                import yfinance as yf
                self._yf = yf
            except ImportError:
                self._yf = False

    def get_a_spot(self) -> List[Dict]:
        self._init_akshare()
        if not self._ak:
            self._mock_sources.add("a_spot")
            return self._mock_a_spot()
        try:
            df = self._ak.stock_zh_a_spot_em()
            cols = ["代码", "名称", "最新价", "涨跌幅", "成交额"]
            df = df[[c for c in cols if c in df.columns]].head(20)
            return df.to_dict("records")
        except Exception:
            self._mock_sources.add("a_spot")
            return self._mock_a_spot()

    def get_us_tickers(self, symbols: List[str]) -> Dict[str, Dict]:
        self._init_yfinance()
        if not self._yf:
            self._mock_sources.add("us_tickers:all_mock")
            return {s: self._mock_us_ticker(s) for s in symbols}
        result = {}
        for sym in symbols:
            try:
                t = self._yf.Ticker(sym)
                info = t.info
                hist = t.history(period="5d")
                if len(hist) >= 2:
                    ret = (hist["Close"].iloc[-1] / hist["Close"].iloc[-2] - 1) * 100
                else:
                    ret = 0
                result[sym] = {
                    "name": info.get("shortName", sym),
                    "price": info.get("currentPrice", 0),
                    "daily_return": round(ret, 2),
                    "market_cap": info.get("marketCap", 0),
                }
            except Exception:
                self._mock_sources.add(f"us_tickers:{sym}")
                result[sym] = self._mock_us_ticker(sym)
        return result

    def get_pmi(self) -> Dict:
        self._init_akshare()
        if not self._ak:
            self._mock_sources.add("pmi")
            return self._mock_pmi()
        try:
            df = self._ak.macro_china_pmi()
            latest = df.iloc[0] if len(df) > 0 else {}
            return {
                "manufacturing": float(latest.get("制造业PMI", 50.3)),
                "non_manufacturing": float(latest.get("非制造业PMI", 49.4)),
                "date": str(latest.get("月份", datetime.now().strftime("%Y-%m"))),
            }
        except Exception:
            self._mock_sources.add("pmi")
            return self._mock_pmi()

    def get_vix(self) -> float:
        self._init_yfinance()
        if not self._yf:
            self._mock_sources.add("vix")
            return self._mock_vix()
        try:
            vix = self._yf.Ticker("^VIX")
            hist = vix.history(period="2d")
            if len(hist) >= 1:
                return round(float(hist["Close"].iloc[-1]), 2)
        except Exception:
            pass
        self._mock_sources.add("vix")
        return self._mock_vix()

    def get_margin_concentration(self) -> float:
        # AKShare margin detail
        self._init_akshare()
        if not self._ak:
            self._mock_sources.add("margin_concentration")
            return self._mock_margin()
        try:
            df = self._ak.stock_margin_detail()
            if "融资余额" in df.columns and len(df) > 10:
                top10 = df.nlargest(10, "融资余额")
                total = df["融资余额"].sum()
                if total > 0:
                    return round(float(top10["融资余额"].sum() / total), 4)
        except Exception:
            pass
        self._mock_sources.add("margin_concentration")
        return self._mock_margin()

    def get_mag7_dispersion(self) -> float:
        mag7 = ["GOOGL", "META", "MSFT", "AMZN", "NVDA", "AAPL"]
        data = self.get_us_tickers(mag7)
        returns = [d["daily_return"] for d in data.values() if "daily_return" in d]
        if len(returns) < 2:
            return 0.0
        import numpy as np
        # daily_return is in percent (see get_us_tickers); convert to fraction
        # so the value is comparable to dispersion_threshold (0.35 in config)
        return round(float(np.std(returns)) / 100.0, 4)

    # --- A/HK 个股 K 线 ---
    def get_a_stock_history(self, code: str, days: int = 300):
        """A 股日 K (前复权)。返回 DataFrame[date, open, high, low, close, volume, amount] 或 None。"""
        self._init_akshare()
        if not self._ak:
            self._mock_sources.add(f"a_stock_history:{code}")
            return self._mock_stock_history(code, days)
        end = datetime.now()
        start = end - timedelta(days=int(days * 1.6) + 30)  # 跳过非交易日,留余量
        try:
            df = self._ak.stock_zh_a_hist(
                symbol=str(code),
                period="daily",
                start_date=start.strftime("%Y%m%d"),
                end_date=end.strftime("%Y%m%d"),
                adjust="qfq",
            )
            if df is None or len(df) == 0:
                self._mock_sources.add(f"a_stock_history:{code}")
                return self._mock_stock_history(code, days)
            return self._normalize_hist_df(df)
        except Exception:
            self._mock_sources.add(f"a_stock_history:{code}")
            return self._mock_stock_history(code, days)

    def get_hk_stock_history(self, code: str, days: int = 300):
        """HK 日 K (前复权)。"""
        self._init_akshare()
        if not self._ak:
            self._mock_sources.add(f"hk_stock_history:{code}")
            return self._mock_stock_history(code, days)
        end = datetime.now()
        start = end - timedelta(days=int(days * 1.6) + 30)
        try:
            df = self._ak.stock_hk_hist(
                symbol=str(code).zfill(5),
                period="daily",
                start_date=start.strftime("%Y%m%d"),
                end_date=end.strftime("%Y%m%d"),
                adjust="qfq",
            )
            if df is None or len(df) == 0:
                self._mock_sources.add(f"hk_stock_history:{code}")
                return self._mock_stock_history(code, days)
            return self._normalize_hist_df(df)
        except Exception:
            self._mock_sources.add(f"hk_stock_history:{code}")
            return self._mock_stock_history(code, days)

    def get_stock_history(self, code: str, days: int = 300):
        """自动按市场 dispatch。"""
        market = _market_of(code)
        if market == "hk":
            return self.get_hk_stock_history(code, days)
        return self.get_a_stock_history(code, days)

    def _normalize_hist_df(self, df):
        """akshare 中文列名 → 标准英文列名。"""
        rename_map = {
            "日期": "date",
            "开盘": "open",
            "收盘": "close",
            "最高": "high",
            "最低": "low",
            "成交量": "volume",
            "成交额": "amount",
        }
        df = df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns})
        keep = [c for c in ["date", "open", "high", "low", "close", "volume", "amount"] if c in df.columns]
        df = df[keep].copy()
        # date 转字符串方便后续 pd.Timestamp 处理
        if "date" in df.columns:
            df["date"] = df["date"].astype(str)
        for col in ["open", "high", "low", "close", "volume", "amount"]:
            if col in df.columns:
                df[col] = df[col].astype(float)
        df = df.reset_index(drop=True)
        return df

    def get_stock_quote(self, code: str) -> Dict:
        """实时行情快照(akshare spot 表延迟约 3-15 分钟)。"""
        self._init_akshare()
        code = str(code)
        market = _market_of(code)
        if not self._ak:
            self._mock_sources.add(f"stock_quote:{code}")
            return self._mock_stock_quote(code)
        try:
            if market == "a":
                df = self._ak.stock_zh_a_spot_em()
                row = df[df["代码"] == code]
            else:
                df = self._ak.stock_hk_spot_em()
                code_5 = code.zfill(5)
                row = df[df["代码"] == code_5]
            if row is None or len(row) == 0:
                self._mock_sources.add(f"stock_quote:{code}")
                return self._mock_stock_quote(code)
            r = row.iloc[0]
            return {
                "code": code,
                "name": str(r.get("名称", "")),
                "price": float(r.get("最新价", 0) or 0),
                "change_pct": float(r.get("涨跌幅", 0) or 0),
                "market": market,
            }
        except Exception:
            self._mock_sources.add(f"stock_quote:{code}")
            return self._mock_stock_quote(code)

    def get_stock_capital(self, code: str) -> float:
        """流通股本(单位:股)。A 走 stock_individual_info_em,HK 走 hardcoded 表。"""
        self._init_akshare()
        code = str(code)
        market = _market_of(code)
        if market == "hk":
            cap = HK_CAPITAL_OVERRIDES.get(code.zfill(5))
            if cap:
                return float(cap)
            # 兜底:用 5e9 作为大盘股近似,小盘股会过低,但好过崩溃
            self._mock_sources.add(f"stock_capital:{code}")
            return 5_000_000_000.0
        if not self._ak:
            self._mock_sources.add(f"stock_capital:{code}")
            return 1_000_000_000.0
        try:
            df = self._ak.stock_individual_info_em(symbol=code)
            # 列名: item, value
            cols = df.columns.tolist()
            if "item" in cols and "value" in cols:
                m = df[df["item"] == "流通股"]
                if len(m) == 0:
                    m = df[df["item"] == "流通A股"]
                if len(m) > 0:
                    val = m.iloc[0]["value"]
                    return float(val)
        except Exception:
            pass
        self._mock_sources.add(f"stock_capital:{code}")
        return 1_000_000_000.0

    # --- A/HK 市场级 dispersion / breadth ---
    def get_a_leader_dispersion(self) -> float:
        """沪深 300 权重前 10 当日涨跌幅 std (分数,与 mag7_dispersion 同口径)。"""
        self._init_akshare()
        if not self._ak:
            self._mock_sources.add("a_dispersion")
            return self._mock_a_dispersion()
        try:
            # 沪深 300 成分股(取权重前 10)
            weights = None
            try:
                weights = self._ak.index_stock_cons_weight_csindex(symbol="000300")
            except Exception:
                weights = None
            top10_codes = []
            if weights is not None and len(weights) > 0:
                wcol = "权重" if "权重" in weights.columns else weights.columns[-1]
                codecol = "成分券代码" if "成分券代码" in weights.columns else (
                    "证券代码" if "证券代码" in weights.columns else "代码"
                )
                if codecol in weights.columns:
                    top10 = weights.sort_values(wcol, ascending=False).head(10)
                    top10_codes = top10[codecol].astype(str).tolist()
            if not top10_codes:
                # 兜底:硬编码沪深 300 权重前 10
                top10_codes = ["600519", "300750", "601318", "600036", "000858",
                                "300059", "601166", "600276", "601012", "002594"]
            spot = self._ak.stock_zh_a_spot_em()
            mask = spot["代码"].astype(str).isin(top10_codes)
            picks = spot[mask]
            if len(picks) < 2:
                self._mock_sources.add("a_dispersion")
                return self._mock_a_dispersion()
            import numpy as np
            chg = picks["涨跌幅"].astype(float).tolist()
            return round(float(np.std(chg)) / 100.0, 4)
        except Exception:
            self._mock_sources.add("a_dispersion")
            return self._mock_a_dispersion()

    def get_hk_leader_dispersion(self) -> float:
        """HK 科技龙头当日涨跌幅 std (分数)。"""
        self._init_akshare()
        if not self._ak:
            self._mock_sources.add("hk_dispersion")
            return self._mock_hk_dispersion()
        try:
            spot = self._ak.stock_hk_spot_em()
            codes_5 = [c.zfill(5) for c in HK_TECH_LEADERS]
            mask = spot["代码"].astype(str).isin(codes_5)
            picks = spot[mask]
            if len(picks) < 2:
                self._mock_sources.add("hk_dispersion")
                return self._mock_hk_dispersion()
            import numpy as np
            chg = picks["涨跌幅"].astype(float).tolist()
            return round(float(np.std(chg)) / 100.0, 4)
        except Exception:
            self._mock_sources.add("hk_dispersion")
            return self._mock_hk_dispersion()

    def get_a_market_breadth(self) -> Dict:
        """A 股市场广度:涨跌家数 + 涨停 / 跌停股池数。"""
        self._init_akshare()
        if not self._ak:
            self._mock_sources.add("a_breadth")
            return self._mock_a_breadth()
        try:
            spot = self._ak.stock_zh_a_spot_em()
            chg = spot["涨跌幅"].astype(float)
            advance = int((chg > 0).sum())
            decline = int((chg < 0).sum())
            total = advance + decline
            advance_ratio = round(advance / total, 4) if total > 0 else 0.5

            today = datetime.now().strftime("%Y%m%d")
            zt_count = 0
            dt_count = 0
            try:
                zt = self._ak.stock_zt_pool_em(date=today)
                zt_count = int(len(zt)) if zt is not None else 0
            except Exception:
                pass
            try:
                dt = self._ak.stock_zt_pool_dtgc_em(date=today)
                dt_count = int(len(dt)) if dt is not None else 0
            except Exception:
                pass

            return {
                "advance": advance,
                "decline": decline,
                "advance_ratio": advance_ratio,
                "zt_count": zt_count,
                "dt_count": dt_count,
            }
        except Exception:
            self._mock_sources.add("a_breadth")
            return self._mock_a_breadth()

    # --- Mock fallbacks ---
    def _mock_a_spot(self) -> List[Dict]:
        return [
            {"代码": "000001", "名称": "平安银行", "最新价": 12.5, "涨跌幅": 1.2, "成交额": 890000000},
            {"代码": "688256", "名称": "寒武纪", "最新价": 245.8, "涨跌幅": 20.0, "成交额": 3407000000},
        ]

    def _mock_us_ticker(self, sym: str) -> Dict:
        mocks = {
            "GOOGL": {"name": "Alphabet", "price": 180.0, "daily_return": 11.99, "market_cap": 2000000000000},
            "META": {"name": "Meta", "price": 520.0, "daily_return": -9.82, "market_cap": 1300000000000},
            "MSFT": {"name": "Microsoft", "price": 420.0, "daily_return": 0.5, "market_cap": 3100000000000},
            "AMZN": {"name": "Amazon", "price": 195.0, "daily_return": 1.2, "market_cap": 2000000000000},
            "NVDA": {"name": "NVIDIA", "price": 135.0, "daily_return": -2.5, "market_cap": 3300000000000},
            "AAPL": {"name": "Apple", "price": 225.0, "daily_return": 0.8, "market_cap": 3400000000000},
        }
        return mocks.get(sym, {"name": sym, "price": 100.0, "daily_return": 0.0, "market_cap": 0})

    def _mock_pmi(self) -> Dict:
        return {"manufacturing": 50.3, "non_manufacturing": 49.4, "date": "2026-04"}

    def _mock_vix(self) -> float:
        return 16.89

    def _mock_margin(self) -> float:
        return 0.72

    def _mock_stock_history(self, code: str, days: int):
        """构造长度 300 的合成日 K,用于网络不通时不阻断主流程。"""
        import pandas as pd
        import numpy as np
        random.seed(int(str(code)[-3:]) if str(code)[-3:].isdigit() else 42)
        dates = [
            (datetime.now() - timedelta(days=days - i)).strftime("%Y-%m-%d")
            for i in range(days)
        ]
        price = 30.0
        rows = []
        for d in dates:
            o = price * (1 + random.uniform(-0.01, 0.01))
            c = o * (1 + random.uniform(-0.03, 0.03))
            h = max(o, c) * (1 + random.uniform(0, 0.015))
            l = min(o, c) * (1 - random.uniform(0, 0.015))
            v = random.uniform(2e7, 8e7)
            rows.append({
                "date": d, "open": o, "high": h, "low": l, "close": c,
                "volume": v, "amount": v * c,
            })
            price = c
        return pd.DataFrame(rows)

    def _mock_stock_quote(self, code: str) -> Dict:
        return {
            "code": code,
            "name": f"MOCK-{code}",
            "price": 30.0,
            "change_pct": 0.0,
            "market": _market_of(code),
        }

    def _mock_a_dispersion(self) -> float:
        return 0.01

    def _mock_hk_dispersion(self) -> float:
        return 0.012

    def _mock_a_breadth(self) -> Dict:
        return {
            "advance": 2500, "decline": 2500,
            "advance_ratio": 0.5,
            "zt_count": 30, "dt_count": 10,
        }

    # --- 融资融券 / 北向资金 / 龙虎榜（Sentiment 角色用） ---

    def get_stock_margin(self, code: str) -> Optional[Dict]:
        """个股融资融券数据。返回 {融资余额, 融资买入额, 融券余量, 融资融券余额} 或 None。"""
        self._init_akshare()
        code = str(code).strip()
        if not self._ak:
            self._mock_sources.add(f"stock_margin:{code}")
            return None
        try:
            # 深市
            if code.startswith(("0", "3")):
                df = self._ak.stock_margin_detail_szse()
                col = "证券代码"
            # 沪市
            elif code.startswith(("6", "9")):
                df = self._ak.stock_margin_detail_sse()
                col = "标的证券代码"
            else:
                return None
            row = df[df[col] == code]
            if len(row) == 0:
                return None
            r = row.iloc[0]
            if code.startswith(("0", "3")):
                return {
                    "融资余额": float(r.get("融资余额", 0)),
                    "融资买入额": float(r.get("融资买入额", 0)),
                    "融券余量": float(r.get("融券余量", 0)),
                    "融资融券余额": float(r.get("融资融券余额", 0)),
                }
            else:
                return {
                    "融资余额": float(r.get("融资余额", 0)),
                    "融资买入额": float(r.get("融资买入额", 0)),
                    "融券余量": float(r.get("融券余量", 0)),
                }
        except Exception:
            pass
        return None

    def get_stock_northbound(self, code: str, days: int = 5) -> Optional[List[Dict]]:
        """个股北向资金持股变化。返回最近 N 天列表或 None。"""
        self._init_akshare()
        code = str(code).strip()
        if not self._ak:
            self._mock_sources.add(f"stock_northbound:{code}")
            return None
        try:
            df = self._ak.stock_hsgt_individual_em(symbol=code)
            if df is None or len(df) == 0:
                return None
            # 取最近 days 条（数据按时间正序排列，旧的在前面，取尾部最新数据）
            df = df.tail(days)
            records = []
            for _, r in df.iterrows():
                records.append({
                    "日期": str(r.get("持股日期", "")),
                    "持股数量": float(r.get("持股数量", 0)) if r.get("持股数量") is not None and str(r.get("持股数量")) != "nan" else None,
                    "持股市值": float(r.get("持股市值", 0)) if r.get("持股市值") is not None and str(r.get("持股市值")) != "nan" else None,
                    "占A股百分比": float(r.get("持股数量占A股百分比", 0)) if r.get("持股数量占A股百分比") is not None and str(r.get("持股数量占A股百分比")) != "nan" else None,
                    "增持股数": float(r.get("今日增持股数", 0)) if r.get("今日增持股数") is not None and str(r.get("今日增持股数")) != "nan" else None,
                    "增持资金": float(r.get("今日增持资金", 0)) if r.get("今日增持资金") is not None and str(r.get("今日增持资金")) != "nan" else None,
                })
            return records
        except Exception:
            pass
        return None

    def get_stock_lhb(self, code: str, days: int = 3) -> Optional[List[Dict]]:
        """个股龙虎榜数据。返回最近 N 个交易日内上榜记录或 None。"""
        self._init_akshare()
        code = str(code).strip()
        if not self._ak:
            self._mock_sources.add(f"stock_lhb:{code}")
            return None
        try:
            from datetime import datetime, timedelta
            end = datetime.now()
            start = end - timedelta(days=days + 7)  # 留余量跳过周末
            df = self._ak.stock_lhb_detail_em(
                start_date=start.strftime("%Y%m%d"),
                end_date=end.strftime("%Y%m%d"),
            )
            if df is None or len(df) == 0:
                return None
            df = df[df["代码"] == code]
            if len(df) == 0:
                return None
            records = []
            for _, r in df.iterrows():
                records.append({
                    "上榜日": str(r.get("上榜日", "")),
                    "解读": str(r.get("解读", "")),
                    "净买额": float(r.get("龙虎榜净买额", 0)),
                    "买入额": float(r.get("龙虎榜买入额", 0)),
                    "卖出额": float(r.get("龙虎榜卖出额", 0)),
                    "上榜原因": str(r.get("上榜原因", "")),
                })
            return records
        except Exception:
            pass
        return None

    def get_full_snapshot(self) -> Dict:
        return {
            "timestamp": datetime.now().isoformat(),
            "a_spot": self.get_a_spot(),
            "mag7": self.get_us_tickers(["GOOGL", "META", "MSFT", "AMZN", "NVDA", "AAPL"]),
            "pmi": self.get_pmi(),
            "vix": self.get_vix(),
            "margin_concentration": self.get_margin_concentration(),
            "mag7_dispersion": self.get_mag7_dispersion(),
            "a_dispersion": self.get_a_leader_dispersion(),
            "hk_dispersion": self.get_hk_leader_dispersion(),
            "a_breadth": self.get_a_market_breadth(),
        }
