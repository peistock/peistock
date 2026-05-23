"""
core/news_fetcher.py
增量市场信息抓取层(akshare 免费源 + mock fallback)。

为 Bull/Bear 辩论注入「最近发生了什么」:
- fetch_stock_news(code, market): 个股新闻
- fetch_macro_news(): 宏观快讯 / 财联社
- summarize_for_prompt(): 压成 LLM prompt 友好的多行段

设计原则与 data_layer 一致 —— akshare 调用失败时返回 mock,流程不阻断。
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


def _safe_import_akshare():
    try:
        import akshare as ak  # type: ignore
        return ak
    except ImportError:
        logger.warning("[news] akshare not installed, fallback to mock")
        return None


def _normalize_news_em(df) -> List[Dict]:
    """ak.stock_news_em 返回的 DataFrame → List[Dict]。"""
    rows: List[Dict] = []
    for _, r in df.iterrows():
        rows.append({
            "title": str(r.get("新闻标题", "")).strip(),
            "content": str(r.get("新闻内容", "")).strip(),
            "time": str(r.get("发布时间", "")).strip(),
            "source": str(r.get("文章来源", "")).strip() or "eastmoney",
            "url": str(r.get("新闻链接", "")).strip(),
        })
    return rows


def _normalize_cls(df) -> List[Dict]:
    """ak.stock_info_global_cls 返回的 DataFrame → List[Dict]。"""
    rows: List[Dict] = []
    for _, r in df.iterrows():
        date = str(r.get("发布日期", "")).strip()
        tm = str(r.get("发布时间", "")).strip()
        rows.append({
            "title": str(r.get("标题", "")).strip(),
            "content": str(r.get("内容", "")).strip(),
            "time": (date + " " + tm).strip(),
            "source": "财联社",
            "url": "",
        })
    return rows


def _mock_stock_news(code: str, market: str) -> List[Dict]:
    today = datetime.now().strftime("%Y-%m-%d")
    return [
        {
            "title": f"[MOCK] {code} 最新公司动态(akshare 离线时占位)",
            "content": "akshare 抓取失败,使用 mock 新闻。建议检查本地代理对 eastmoney.com 是否直连。",
            "time": today + " 09:00:00",
            "source": "mock",
            "url": "",
        }
    ]


def _mock_macro_news() -> List[Dict]:
    today = datetime.now().strftime("%Y-%m-%d")
    return [
        {
            "title": f"[MOCK] 宏观快讯({today})",
            "content": "akshare 财联社抓取失败,使用 mock。建议检查本地代理或 NO_PROXY 设置。",
            "time": today + " 09:00:00",
            "source": "mock",
            "url": "",
        }
    ]


def fetch_stock_news(code: str, market: str = "a", limit: int = 10) -> List[Dict]:
    """
    抓取个股新闻(东方财富)。A 股 / HK 都用 stock_news_em。

    Args:
        code:     6 位(A)或 5 位(HK)代码
        market:   "a" / "hk"(目前只是元信息,akshare 接口共用)
        limit:    最多返回条数

    Returns:
        List[{title, content, time, source, url}],按时间 desc。失败返 mock。
    """
    ak = _safe_import_akshare()
    if ak is None:
        return _mock_stock_news(code, market)

    try:
        df = ak.stock_news_em(symbol=code)
        if df is None or len(df) == 0:
            logger.info("[news] empty for code=%s", code)
            return _mock_stock_news(code, market)
        rows = _normalize_news_em(df)
        rows.sort(key=lambda x: x["time"], reverse=True)
        return rows[:limit]
    except Exception as e:
        logger.warning("[news] stock_news_em failed for %s: %s", code, e)
        return _mock_stock_news(code, market)


def fetch_stock_notices(code: str, limit: int = 5) -> List[Dict]:
    """
    抓取个股公告(A 股)。优先 akshare，失败走巨潮资讯备用源，再失败返空 list。
    HK 暂不支持。

    Returns:
        List[{title, content, time, source, url}],失败返空 list(公告非必需)。
    """
    if not (len(code) == 6 and code.isdigit()):
        return []

    # 1. 优先 akshare
    ak = _safe_import_akshare()
    if ak is not None:
        try:
            df = ak.stock_individual_notice_report(security=code)
            if df is not None and len(df) > 0:
                rows: List[Dict] = []
                for _, r in df.iterrows():
                    rows.append({
                        "title": str(r.get("公告标题", "") or r.get("标题", "")).strip(),
                        "content": "",
                        "time": str(r.get("公告日期", "") or r.get("日期", "")).strip(),
                        "source": "公告",
                        "url": str(r.get("公告链接", "") or "").strip(),
                    })
                rows.sort(key=lambda x: x["time"], reverse=True)
                return rows[:limit]
        except Exception as e:
            logger.warning("[news] akshare notice failed for %s: %s", code, e)

    # 2. 巨潮资讯备用源
    try:
        from core.cninfo_api import fetch_cninfo_notices
        cninfo_rows = fetch_cninfo_notices(code, market="a", limit=limit)
        if cninfo_rows:
            return [
                {
                    "title": r["title"],
                    "content": "",
                    "time": r["time"],
                    "source": "巨潮资讯" + (f"·{r['type']}" if r.get("type") else ""),
                    "url": r.get("url", ""),
                }
                for r in cninfo_rows
            ]
    except Exception as e:
        logger.warning("[news] cninfo notice fallback failed for %s: %s", code, e)

    return []


def fetch_macro_news(limit: int = 15) -> List[Dict]:
    """
    抓取宏观快讯(财联社全球快讯)。

    Returns:
        List[{title, content, time, source, url}],按时间 desc。失败返 mock。
    """
    ak = _safe_import_akshare()
    if ak is None:
        return _mock_macro_news()

    try:
        df = ak.stock_info_global_cls(symbol="全部")
        if df is None or len(df) == 0:
            return _mock_macro_news()
        rows = _normalize_cls(df)
        rows.sort(key=lambda x: x["time"], reverse=True)
        return rows[:limit]
    except Exception as e:
        logger.warning("[news] stock_info_global_cls failed: %s", e)
        return _mock_macro_news()


def summarize_for_prompt(news: List[Dict],
                         max_items: int = 10,
                         max_chars_per_item: int = 200,
                         max_total_chars: int = 2000) -> str:
    """
    把新闻列表压成 LLM prompt 友好的多行段。

    格式:
        [2026-05-13 10:01] 标题: 内容摘要...(source)

    Returns:
        多行字符串。空 list → "(无相关新闻)"
    """
    if not news:
        return "(无相关新闻)"

    lines: List[str] = []
    used = 0
    for item in news[:max_items]:
        title = (item.get("title") or "").strip()
        content = (item.get("content") or "").strip()
        if content and len(content) > max_chars_per_item:
            content = content[:max_chars_per_item] + "..."
        tm = (item.get("time") or "").strip()
        src = (item.get("source") or "").strip()

        # 短标题就单行,长标题/有内容才两段
        if content and content != title and not title.endswith(content[:20]):
            line = f"- [{tm}] {title} — {content} ({src})"
        else:
            line = f"- [{tm}] {title} ({src})"

        if used + len(line) > max_total_chars:
            break
        lines.append(line)
        used += len(line)

    return "\n".join(lines) if lines else "(无相关新闻)"
