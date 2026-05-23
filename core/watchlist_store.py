"""
core/watchlist_store.py
简单 JSON 文件存储每个账号的股票池。
"""
import json
from pathlib import Path
from typing import Dict, List, Any

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
WATCHLIST_FILE = DATA_DIR / "watchlists.json"


def _load() -> Dict[str, Any]:
    if WATCHLIST_FILE.exists():
        try:
            return json.loads(WATCHLIST_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save(data: Dict[str, Any]):
    WATCHLIST_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _default_watchlist() -> List[Dict]:
    """读取默认股票池配置。"""
    default_file = DATA_DIR / "default_watchlist.json"
    if default_file.exists():
        try:
            return json.loads(default_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    return []


def get_watchlist(account: str) -> Dict[str, Any]:
    """获取某账号的股票池。新账号自动继承默认配置。返回 {stocks: [], categories: []}。"""
    data = _load()
    raw = data.get(account, {})
    stocks = raw.get("stocks", [])
    categories = raw.get("categories", ["自选股", "关注", "持仓"])
    # 新账号（无数据）继承默认股票池
    if not stocks and not raw:
        stocks = _default_watchlist()
    return {
        "stocks": stocks,
        "categories": categories,
    }


def set_watchlist(account: str, stocks: List[Dict], categories: List[str]):
    """保存某账号的股票池。"""
    data = _load()
    data[account] = {"stocks": stocks, "categories": categories}
    _save(data)
