"""core/cninfo_api.py — 巨潮资讯公告 API 封装

作为 akshare stock_individual_notice_report 的备用源。
"""
import json
import urllib.request
from typing import Dict, List, Optional

CNINFO_QUERY_URL = "http://www.cninfo.com.cn/new/hisAnnouncement/query"


def _code_to_cninfo_stock(code: str) -> str:
    """A股代码补全为巨潮格式：60/68/88/89 开头补 .SH，其余补 .SZ。"""
    code = str(code).strip()
    if code.startswith(("60", "68", "88", "89")):
        return f"{code}.SH"
    return f"{code}.SZ"


def _column_for_code(code: str) -> str:
    """巨潮 column 参数：沪市 sse，深市 szse。"""
    if code.startswith(("60", "68", "88", "89")):
        return "sse"
    return "szse"


def fetch_cninfo_notices(code: str, market: str = "a", limit: int = 10) -> List[Dict]:
    """从巨潮资讯抓取个股公告。

    Args:
        code: A股 6 位代码
        market: "a" 或 "hk"（hk 不支持，直接抛异常）
        limit: 返回条数上限

    Returns:
        List[{"title": str, "time": str, "url": str, "type": str}]

    Raises:
        Exception: 网络错误或接口返回异常时抛出，由调用方处理 fallback。
    """
    if market != "a" or not (len(code) == 6 and code.isdigit()):
        raise ValueError(f"cninfo 仅支持 A 股 6 位代码，收到: {code}")

    stock = _code_to_cninfo_stock(code)
    column = _column_for_code(code)

    payload = {
        "stock": stock,
        "tabName": "fulltext",
        "pageSize": limit,
        "pageNum": 1,
        "column": column,
    }

    data = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(
        CNINFO_QUERY_URL,
        data=data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Referer": "http://www.cninfo.com.cn",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=15) as resp:
        resp_data = json.loads(resp.read().decode("utf-8"))

    if resp_data.get("classifiedAnnouncements"):
        # 新接口格式：按类别分组
        items = []
        for group in resp_data["classifiedAnnouncements"]:
            items.extend(group)
    elif resp_data.get("announcements"):
        items = resp_data["announcements"]
    else:
        items = []

    results = []
    for item in items[:limit]:
        title = item.get("announcementTitle", "").strip()
        time_str = item.get("announcementTime", "").strip()
        # 拼接完整 URL
        adjunct = item.get("adjunctUrl", "").strip()
        url = f"http://static.cninfo.com.cn/{adjunct}" if adjunct else ""
        # 公告类型
        notice_type = item.get("announcementTypeName", "").strip() or item.get("column_name", "").strip()

        results.append({
            "title": title,
            "time": time_str,
            "url": url,
            "type": notice_type,
        })

    return results
