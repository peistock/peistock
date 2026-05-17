"""
core/signal_backtest.py
信号级回测：逐日检测 B/S 信号，计算每个信号的持有期统计（最大收益、最大回撤、至今收益），
以及基于当前指标条件匹配历史最接近日期做对比回测。
"""
import re
import urllib.request
import json
from typing import Dict, List, Optional, Tuple

from core.indicators import calculate_all_indicators
from core.signal_detector import detect_signals


def _fetch_tencent_klines(code: str) -> Tuple[List[Dict], float]:
    """
    直连腾讯 API 获取 K 线数据。
    返回 (records, current_price)。
    """
    clean = re.sub(r'[^0-9]', '', code)
    if len(clean) == 5:
        tencent_symbol = f"hk{clean}"
    elif clean.startswith('6') or clean.startswith('5'):
        tencent_symbol = f"sh{clean}"
    else:
        tencent_symbol = f"sz{clean}"

    # K 线（前复权，500天）
    kline_url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={tencent_symbol},day,,,500,qfq"
    req = urllib.request.Request(kline_url, headers={
        "Accept": "application/json",
        "Referer": "https://stock.qq.com",
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        kline_data = json.loads(resp.read().decode("utf-8"))

    if kline_data.get("code") != 0 or not kline_data.get("data"):
        raise ValueError("腾讯 K 线 API 返回异常")

    stock_data = kline_data["data"][tencent_symbol]
    klines = stock_data.get("qfqday") or stock_data.get("day") or []
    if not klines:
        raise ValueError("无 K 线数据")

    is_hk = tencent_symbol.startswith("hk")
    is_keb = clean.startswith("688")

    records = []
    for item in klines:
        vol = int(float(item[5])) if is_hk or is_keb else int(float(item[5])) * 100
        records.append({
            "date": str(item[0]),
            "open": float(item[1]) if item[1] else 0,
            "close": float(item[2]) if item[2] else 0,
            "low": float(item[3]) if item[3] else 0,
            "high": float(item[4]) if item[4] else 0,
            "volume": vol,
            "amount": 0.0,
        })

    if len(records) < 60:
        raise ValueError(f"K 线数据不足: {len(records)} 条")

    # 当前价格
    quote_url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={tencent_symbol},day,,,1,qfq"
    req2 = urllib.request.Request(quote_url, headers={
        "Accept": "application/json",
        "Referer": "https://stock.qq.com",
    })
    with urllib.request.urlopen(req2, timeout=10) as resp2:
        quote_data = json.loads(resp2.read().decode("utf-8"))

    qt = quote_data["data"][tencent_symbol]["qt"][tencent_symbol]
    current_price = float(qt[3]) if qt[3] else 0

    return records, current_price


def _detect_signals_for_day(indicators: List[Dict], idx: int) -> Dict:
    """对第 idx 天检测 B/S 信号，使用前后一天数据判断 DI 拐点。

    与前端的 K 线标记对齐：
    - 底背离(B)：只在连续底背离段的**最后一天**标记
    - 顶背离(S)：只在连续顶背离段的**第一天**标记
    - 恐慌/贪婪：只在 DI 拐点标记，本来就不会连续多天触发
    """
    ind = indicators[idx]
    prev = indicators[idx - 1] if idx > 0 else {}
    next_day = indicators[idx + 1] if idx < len(indicators) - 1 else {}

    lookback = 5
    start = max(0, idx - lookback + 1)
    recent = indicators[start:idx + 1]

    data = {
        "cost_deviation_percentile": ind.get("cost_deviation_percentile"),
        "bias225_percentile": ind.get("bias225_percentile"),
        "cri": ind.get("cri"),
        "greedy_percentile": ind.get("greedy_percentile"),
        "recent_divergences": [r.get("pvt_divergence") for r in recent],
        "recent_cri": [r.get("cri") for r in recent],
        "recent_cost_dev": [r.get("cost_deviation_percentile") for r in recent],
        "plus_di": ind.get("plus_di"),
        "minus_di": ind.get("minus_di"),
        "prev_plus_di": prev.get("plus_di"),
        "prev_minus_di": prev.get("minus_di"),
        "next_plus_di": next_day.get("plus_di"),
        "next_minus_di": next_day.get("minus_di"),
    }
    sig = detect_signals(data)

    # 底背离：只在连续段的最后一天标记（下一天不再是底背离）
    if sig.get("signal_type") == "B":
        signals = sig.get("signals", [])
        has_bottom_div = any("底背离" in s for s in signals)
        if has_bottom_div:
            # 如果下一天也是底背离，则今天不是最后一天，清除底背离标记
            if idx < len(indicators) - 1 and indicators[idx + 1].get("pvt_divergence") == "bottom":
                signals = [s for s in signals if "底背离" not in s]
                if not signals:
                    sig = {"signals": [], "signal_type": None}
                else:
                    sig["signals"] = signals

    # 顶背离：只在连续段的第一天标记（前一天不再是顶背离）
    if sig.get("signal_type") == "S":
        signals = sig.get("signals", [])
        has_top_div = any("顶背离" in s for s in signals)
        if has_top_div:
            # 如果前一天也是顶背离，则今天不是第一天，清除顶背离标记
            if idx > 0 and indicators[idx - 1].get("pvt_divergence") == "top":
                signals = [s for s in signals if "顶背离" not in s]
                if not signals:
                    sig = {"signals": [], "signal_type": None}
                else:
                    sig["signals"] = signals

    return sig


def _find_similar_day(indicators: List[Dict]) -> Optional[Tuple[int, float]]:
    """
    用最新日的 CRI 分位 + 成本偏离分位，找历史上最接近的日期。
    返回 (index, distance)，未找到返回 None。
    """
    if len(indicators) < 2:
        return None

    latest = indicators[-1]
    latest_cri = latest.get("cri_percentile")
    latest_cost = latest.get("cost_deviation_percentile")

    if latest_cri is None or latest_cost is None:
        return None

    best_idx = None
    best_dist = float("inf")

    # 遍历历史（排除最新一日）
    for i in range(len(indicators) - 1):
        ind = indicators[i]
        cri = ind.get("cri_percentile")
        cost = ind.get("cost_deviation_percentile")
        if cri is None or cost is None:
            continue
        dist = ((cri - latest_cri) ** 2 + (cost - latest_cost) ** 2) ** 0.5
        if dist < best_dist:
            best_dist = dist
            best_idx = i

    if best_idx is None:
        return None
    return best_idx, best_dist


def _calc_hold_stats(prices: List[float], entry_idx: int, is_short: bool = False) -> Dict:
    """
    计算从 entry_idx 持有到最后的统计。
    prices: 收盘价列表
    is_short: True 表示做空（S 信号），价格下跌为正收益
    """
    entry_price = prices[entry_idx]
    if entry_price <= 0:
        return {"max_gain": 0, "max_drawdown": 0, "total_return": 0}

    if is_short:
        # 做空逻辑：价格下跌为正收益，上涨为负收益
        max_gain = 0.0      # 最大做空盈利
        max_drawdown = 0.0  # 最大回撤（从最佳盈利点跌下来的亏损）
        best_gain = 0.0     # 当前最佳盈利

        for i in range(entry_idx, len(prices)):
            p = prices[i]
            short_return = (entry_price / p - 1) * 100

            if short_return > best_gain:
                best_gain = short_return
            if short_return > max_gain:
                max_gain = short_return

            # 从最佳盈利点跌下来的回撤
            if best_gain > 0:
                dd = short_return - best_gain
                if dd < max_drawdown:
                    max_drawdown = dd

        total_return = (entry_price / prices[-1] - 1) * 100
    else:
        # 做多逻辑
        max_price = entry_price
        max_gain = 0.0
        max_drawdown = 0.0

        for i in range(entry_idx, len(prices)):
            p = prices[i]
            gain = (p / entry_price - 1) * 100
            if gain > max_gain:
                max_gain = gain

            if p > max_price:
                max_price = p
            dd = (p / max_price - 1) * 100 if max_price > 0 else 0
            if dd < max_drawdown:
                max_drawdown = dd

        total_return = (prices[-1] / entry_price - 1) * 100

    return {
        "max_gain": round(max_gain, 2),
        "max_drawdown": round(max_drawdown, 2),
        "total_return": round(total_return, 2),
    }


def run_signal_backtest(code: str) -> Optional[Dict]:
    """
    运行信号级回测。

    Returns:
        {
            "code": str,
            "current_price": float,
            "latest_date": str,
            "latest_cri_pct": float,
            "latest_cost_dev_pct": float,
            "signals": [
                {
                    "date": str,
                    "price": float,
                    "signal_type": "B" | "S",
                    "signal_label": str,
                    "max_gain": float,
                    "max_drawdown": float,
                    "total_return": float,
                }
            ],
            "current_match": {
                "date": str,
                "price": float,
                "cri_pct": float,
                "cost_dev_pct": float,
                "distance": float,
                "max_gain": float,
                "max_drawdown": float,
                "total_return": float,
            } | None
        }
    """
    records, current_price = _fetch_tencent_klines(code)

    # 获取流通股本（简化：尝试用 DataLayer，失败则用常见默认值）
    capital = 0
    try:
        from core.data_layer import DataLayer
        capital = DataLayer().get_stock_capital(code)
    except Exception:
        pass
    if capital <= 0:
        # 兜底：A 股常见 50 亿股，港股 100 亿股
        clean = re.sub(r'[^0-9]', '', code)
        capital = 5_000_000_000 if len(clean) == 6 else 10_000_000_000

    indicators = calculate_all_indicators(records, capital, capital_unit="shares")
    if not indicators:
        raise ValueError("指标计算失败")

    prices = [ind["close"] for ind in indicators]

    # 逐日检测信号（带间隔过滤，与前端 K 线图对齐）
    # 规则1: B信号后，5日内跌幅<5%不出现第二个B；6-10日内跌幅<10%不出现B
    # 规则2: S信号后，5日内涨幅<5%不出现第二个S；6-10日内涨幅<10%不出现S
    # 规则3: S信号后，5日内跌幅<5%不出现B；6-10日内跌幅<10%不出现B
    signals_list = []
    for i in range(len(indicators)):
        sig = _detect_signals_for_day(indicators, i)
        sig_type = sig.get("signal_type")
        if sig_type not in ("B", "S"):
            continue

        price = prices[i]
        can_add = True

        for prev in signals_list:
            # 找到前一个信号在 indicators 中的索引（通过日期匹配）
            prev_date = prev["date"]
            prev_idx = next((j for j, ind in enumerate(indicators) if str(ind["date"]) == prev_date), -1)
            if prev_idx < 0:
                continue
            days_diff = i - prev_idx
            if days_diff <= 0:
                continue

            if sig_type == "B":
                if prev["signal_type"] == "B":
                    # 规则1: B之后检查B
                    drop_pct = (prev["price"] - price) / prev["price"] * 100
                    if days_diff <= 5 and drop_pct < 5:
                        can_add = False
                        break
                    elif days_diff <= 10 and drop_pct < 10:
                        can_add = False
                        break
                elif prev["signal_type"] == "S":
                    # 规则3: S之后检查B
                    drop_pct = (prev["price"] - price) / prev["price"] * 100
                    if days_diff <= 5 and drop_pct < 5:
                        can_add = False
                        break
                    elif days_diff <= 10 and drop_pct < 10:
                        can_add = False
                        break
            elif sig_type == "S":
                if prev["signal_type"] == "S":
                    # 规则2: S之后检查S
                    rise_pct = (price - prev["price"]) / prev["price"] * 100
                    if days_diff <= 5 and rise_pct < 5:
                        can_add = False
                        break
                    elif days_diff <= 10 and rise_pct < 10:
                        can_add = False
                        break

        if not can_add:
            continue

        stats = _calc_hold_stats(prices, i, is_short=(sig_type == "S"))
        signals_list.append({
            "date": str(indicators[i]["date"]),
            "price": round(price, 2),
            "signal_type": sig_type,
            "signal_label": " / ".join(sig["signals"]),
            **stats,
        })

    # 找当前最相似的历史日期
    current_match = None
    similar = _find_similar_day(indicators)
    if similar:
        sim_idx, sim_dist = similar
        sim_ind = indicators[sim_idx]
        sim_stats = _calc_hold_stats(prices, sim_idx)
        current_match = {
            "date": str(sim_ind["date"]),
            "price": round(sim_ind["close"], 2),
            "cri_pct": round(sim_ind.get("cri_percentile") or 0, 1),
            "cost_dev_pct": round(sim_ind.get("cost_deviation_percentile") or 0, 1),
            "distance": round(sim_dist, 2),
            **sim_stats,
        }

    latest = indicators[-1]
    return {
        "code": code,
        "current_price": round(current_price, 2),
        "latest_date": str(latest["date"]),
        "latest_cri_pct": round(latest.get("cri_percentile") or 0, 1),
        "latest_cost_dev_pct": round(latest.get("cost_deviation_percentile") or 0, 1),
        "signals": list(reversed(signals_list)),
        "current_match": current_match,
    }
