"""
core/indicators.py

Port of peistock src/utils/indicators.ts to Python. 函数命名与 TS 保持一致(snake_case)。
All percentile / state logic mirrors the TS reference; key constants:
- Yang-Zhang k=0.34, annualized x sqrt(252), capped at 200
- BIAS = (close - MA) / MA * 100 (NOT / close)
- Percentile rank = (lessThan + equalTo/2) / N * 100, requires >=30 data points
- CRI = max(basis*0.95, jump*0.9, curve*(0.85 if below MA20 else 0.4)) + trendAdjustedPct*0.1
- GSI = 5-factor weighted: posBasis 0.30 + upGap 0.20 + greedVol 0.15 + biasExtreme 0.20 + volumeSurge 0.15
- PVT[i] = PVT[i-1] + volume[i] * (close[i] - close[i-1]) / close[i-1]
- pvtGapRatioTop > 0.02 is the hard divergence threshold
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional


Number = Optional[float]


# -----------------------------------------------------------------------------
# 基础工具:百分位 / SMA / BIAS
# -----------------------------------------------------------------------------

def _percentile(data: List[float], p: float) -> float:
    """对应 TS calculatePercentile(data, p)。返回 data 第 p 百分位值(0-100)。"""
    if not data:
        return 0.0
    s = sorted(data)
    idx = math.ceil((p / 100.0) * len(s)) - 1
    return float(s[max(0, idx)])


def _percentile_rank(current: float, history: List[float]) -> float:
    """对应 TS calculatePercentileRank(current, history)。空 → 50,未命中 → 100。"""
    if not history:
        return 50.0
    s = sorted(history)
    rank = -1
    for i, v in enumerate(s):
        if v >= current:
            rank = i
            break
    if rank == -1:
        return 100.0
    return rank / len(s) * 100.0


def _percentile_rank_strict(current: float, history: List[float]) -> float:
    """对应 TS calculateAllIndicators 内部使用的 (lessThan + equalTo/2)/N*100,history>=30 才有效。"""
    if not history:
        return 50.0
    less_than = sum(1 for v in history if v < current)
    equal_to = sum(1 for v in history if v == current)
    rank = less_than + equal_to / 2.0
    return rank / len(history) * 100.0


def calculate_sma(data: List[float], period: int) -> List[Number]:
    n = len(data)
    out: List[Number] = [None] * n
    for i in range(n):
        if i < period - 1:
            continue
        out[i] = sum(data[i - period + 1: i + 1]) / period
    return out


def calculate_ma(closes: List[float], period: int) -> List[Number]:
    return calculate_sma(closes, period)


def calculate_bias(closes: List[float], ma: List[Number]) -> List[Number]:
    out: List[Number] = [None] * len(closes)
    for i, c in enumerate(closes):
        m = ma[i]
        if m is None or m == 0:
            continue
        out[i] = (c - m) / m * 100.0
    return out


# -----------------------------------------------------------------------------
# 换手系列:DD / MAHS / EMAHS
# -----------------------------------------------------------------------------

def calculate_dd(volumes: List[float], capital: float) -> List[int]:
    """换手天数:从 i 往前累计成交量,直到 >= 流通股本。"""
    n = len(volumes)
    out = [0] * n
    for i in range(n):
        cum = 0.0
        count = 0
        for j in range(i, -1, -1):
            cum += volumes[j]
            count += 1
            if cum >= capital:
                break
        out[i] = count
    return out


def calculate_mahs(closes: List[float], dd: List[int]) -> List[Number]:
    n = len(closes)
    out: List[Number] = [None] * n
    for i in range(n):
        period = dd[i]
        actual = min(period, i + 1)
        if actual <= 0:
            continue
        out[i] = sum(closes[i - actual + 1: i + 1]) / actual
    return out


def calculate_emahs(closes: List[float], dd: List[int]) -> List[Number]:
    n = len(closes)
    out: List[Number] = [None] * n
    for i in range(n):
        period = dd[i]
        if i == 0:
            out[0] = closes[0]
        else:
            prev = out[i - 1]
            mult = 2.0 / (period + 1)
            out[i] = (closes[i] - prev) * mult + prev
    return out


# -----------------------------------------------------------------------------
# Yang-Zhang 波动率
# -----------------------------------------------------------------------------

def calculate_yz_vol(
    opens: List[float], highs: List[float], lows: List[float],
    closes: List[float], period: int = 20
) -> List[Number]:
    """Yang-Zhang historical vol。k=0.34,annualized x sqrt(252),capped at 200。"""
    n = len(closes)
    out: List[Number] = [None] * n
    if n < period + 1:
        return out
    k = 0.34

    overnight = [0.0]
    intraday = [0.0]
    rs = [0.0]
    for i in range(1, n):
        prev_c = closes[i - 1]
        o, h, l, c = opens[i], highs[i], lows[i], closes[i]
        if prev_c > 0 and o > 0:
            on_ret = math.log(o / prev_c)
        else:
            on_ret = 0.0
        overnight.append(on_ret * on_ret)
        if o > 0 and c > 0:
            in_ret = math.log(c / o)
        else:
            in_ret = 0.0
        intraday.append(in_ret * in_ret)
        if min(h, l, c, o) > 0:
            log_hc = math.log(h / c)
            log_ho = math.log(h / o)
            log_lc = math.log(l / c)
            log_lo = math.log(l / o)
            rs.append(log_hc * log_ho + log_lc * log_lo)
        else:
            rs.append(0.0)

    for i in range(period, n):
        win = slice(i - period + 1, i + 1)
        so = sum(overnight[win]) / period
        si = sum(intraday[win]) / period
        sr = sum(rs[win]) / period
        yz_var = so + k * si + (1 - k) * sr
        yz = math.sqrt(max(yz_var, 0.0)) * math.sqrt(252) * 100
        out[i] = min(yz, 200.0)
    return out


# -----------------------------------------------------------------------------
# CRI - 恐慌专用
# -----------------------------------------------------------------------------

def calculate_cri(
    stock_data: List[Dict],
    mahs: List[Number],
) -> Dict:
    n = len(stock_data)
    cri: List[Number] = [None] * n
    basis_scores: List[Number] = [None] * n
    jump_scores: List[Number] = [None] * n
    curve_scores: List[Number] = [None] * n
    percentile_scores: List[Number] = [None] * n
    cri_state: List[Optional[str]] = [None] * n
    volume_state: List[Optional[str]] = [None] * n
    vr: List[Number] = [None] * n
    cri_percentile: List[Number] = [None] * n

    if n < 60:
        return {
            "cri": cri, "cri_percentile": cri_percentile,
            "components": {"basis": basis_scores, "jump": jump_scores,
                           "curve": curve_scores, "percentile": percentile_scores},
            "cri_state": cri_state, "volume_state": volume_state, "vr": vr,
        }

    opens = [d["open"] for d in stock_data]
    highs = [d["high"] for d in stock_data]
    lows = [d["low"] for d in stock_data]
    closes = [d["close"] for d in stock_data]
    volumes = [d["volume"] for d in stock_data]

    yz5 = calculate_yz_vol(opens, highs, lows, closes, 5)
    yz20 = calculate_yz_vol(opens, highs, lows, closes, 20)
    yz60 = calculate_yz_vol(opens, highs, lows, closes, 60)

    # 向下跳空(只关注低开)
    down_gaps = [0.0]
    for i in range(1, n):
        if opens[i] > 0 and closes[i - 1] > 0:
            down_gaps.append(max(0.0, math.log(closes[i - 1] / opens[i])))
        else:
            down_gaps.append(0.0)

    avg_down_gap20: List[Number] = [None] * n
    std_down_gap20: List[Number] = [None] * n
    for i in range(20, n):
        win = down_gaps[i - 19: i + 1]
        avg = sum(win) / 20.0
        avg_down_gap20[i] = avg
        sq = sum((x - avg) ** 2 for x in win)
        std_down_gap20[i] = math.sqrt(sq / 20.0)

    # MA20
    ma20: List[Number] = [None] * n
    for i in range(19, n):
        ma20[i] = sum(closes[i - 19: i + 1]) / 20.0

    # 20 日均量
    vol_ma20: List[Number] = [None] * n
    for i in range(19, n):
        vol_ma20[i] = sum(volumes[i - 19: i + 1]) / 20.0

    for i in range(60, n):
        vol_short = yz5[i]
        vol_mid = yz20[i]
        vol_long = yz60[i]
        mahs_val = mahs[i]
        close = closes[i]
        ma20_val = ma20[i]

        if any(v is None for v in [vol_short, vol_mid, vol_long, mahs_val, ma20_val]):
            continue

        price_trend = (close - mahs_val) / mahs_val
        is_below_mahs = price_trend < 0
        is_below_ma20 = close < ma20_val

        # 1. 成本偏离
        basis_score = 0.0
        if is_below_mahs:
            neg_basis_raw = abs(price_trend) * 100
            neg_history: List[float] = []
            for j in range(i - 119, i + 1):
                if j < 0:
                    continue
                if mahs[j] is not None and closes[j] < mahs[j]:
                    neg_history.append(abs((closes[j] - mahs[j]) / mahs[j] * 100))
            if len(neg_history) >= 30:
                t60 = _percentile(neg_history, 60)
                t90 = _percentile(neg_history, 90)
                if neg_basis_raw <= t60:
                    basis_score = 0.0
                elif neg_basis_raw >= t90:
                    basis_score = 100.0
                else:
                    if t90 - t60 > 0:
                        norm = (neg_basis_raw - t60) / (t90 - t60)
                        basis_score = (norm ** 0.8) * 100.0
                    else:
                        basis_score = 50.0
            else:
                basis_score = min(neg_basis_raw * 3, 100)
        basis_scores[i] = min(max(basis_score, 0.0), 100.0)

        # 2. 跳跃风险
        jump_score = 0.0
        avg_g = avg_down_gap20[i]
        std_g = std_down_gap20[i]
        if avg_g is not None and std_g is not None and std_g > 0:
            jump_z = (down_gaps[i] - avg_g) / std_g
            if jump_z > 0:
                jump_score = min(jump_z * 30, 100)
        jump_scores[i] = jump_score

        # 3. 波动曲线
        vol_long_history = [v for v in yz60[max(0, i - 59): i + 1] if v is not None]
        vol_long_mean = sum(vol_long_history) / len(vol_long_history) if vol_long_history else 10.0
        safe_vol_long = max(vol_long, vol_long_mean * 0.2, 0.5)
        curve_slope = (vol_short - vol_long) / safe_vol_long
        if is_below_ma20 and curve_slope > 0:
            curve_score = min(curve_slope * 60, 100)
        elif (not is_below_ma20) and curve_slope > 0:
            curve_score = min(curve_slope * 20, 40)
        elif curve_slope < -0.2:
            curve_score = max(curve_slope * 10 + 20, 0)
        else:
            curve_score = 20 + curve_slope * 30
        curve_scores[i] = curve_score

        # 4. 波动率百分位
        vol_pct_score = 50.0
        if i >= 120:
            hist_vols = [v for v in yz20[i - 119: i + 1] if v is not None]
            if hist_vols:
                sorted_v = sorted(hist_vols)
                rank = -1
                for k_idx, v in enumerate(sorted_v):
                    if v >= vol_mid:
                        rank = k_idx
                        break
                vol_pct_score = (rank / len(sorted_v) * 100) if rank >= 0 else 100.0
        trend_adjusted_pct = vol_pct_score if is_below_ma20 else vol_pct_score * 0.5
        percentile_scores[i] = trend_adjusted_pct

        # 5. 合成
        cri_raw = max(
            basis_score * 0.95,
            jump_score * 0.9,
            curve_score * 0.85 if is_below_ma20 else curve_score * 0.4,
        ) + trend_adjusted_pct * 0.1
        cri[i] = min(max(cri_raw, 0.0), 100.0)

        # VR / volume state
        cur_vol = volumes[i]
        cur_vol_ma = vol_ma20[i]
        if cur_vol_ma is not None and cur_vol_ma > 0:
            cur_vr = cur_vol / cur_vol_ma
            vr[i] = cur_vr
            if cur_vr < 0.5:
                volume_state[i] = "extreme-shrink"
            elif cur_vr < 0.8:
                volume_state[i] = "shrink"
            elif cur_vr <= 1.2:
                volume_state[i] = "normal"
            elif cur_vr <= 2.0:
                volume_state[i] = "expand"
            else:
                volume_state[i] = "extreme-expand"

    # CRI 历史分位
    first_valid = next((i for i, v in enumerate(cri) if v is not None), -1)
    if first_valid >= 0:
        for i in range(first_valid + 60, n):
            cur = cri[i]
            if cur is None:
                continue
            hist = [v for v in cri[first_valid: i] if v is not None]
            if len(hist) >= 60:
                cri_percentile[i] = _percentile_rank_strict(cur, hist)
            else:
                cri_percentile[i] = 50.0

    # CRI 状态
    if first_valid >= 0:
        for i in range(first_valid + 60, n):
            cur = cri[i]
            pct = cri_percentile[i]
            mahs_val = mahs[i]
            if cur is None or pct is None or mahs_val is None:
                cri_state[i] = None
                continue
            is_below_mahs = closes[i] < mahs_val
            if pct >= 80 and is_below_mahs:
                cri_state[i] = "panic"
            elif pct >= 60 and is_below_mahs:
                cri_state[i] = "normal"
            elif pct <= 20 and (not is_below_mahs):
                cri_state[i] = "complacent"
            else:
                cri_state[i] = "normal"

    return {
        "cri": cri,
        "cri_percentile": cri_percentile,
        "components": {
            "basis": basis_scores, "jump": jump_scores,
            "curve": curve_scores, "percentile": percentile_scores,
        },
        "cri_state": cri_state,
        "volume_state": volume_state,
        "vr": vr,
    }


# -----------------------------------------------------------------------------
# GSI 贪婪
# -----------------------------------------------------------------------------

def calculate_greedy_score(
    stock_data: List[Dict],
    mahs: List[Number],
    ma20: List[Number],
    bias225: List[Number],
) -> Dict:
    n = len(stock_data)
    greedy: List[Number] = [None] * n
    pos_basis_scores: List[Number] = [None] * n
    up_gap_scores: List[Number] = [None] * n
    greed_vol_scores: List[Number] = [None] * n
    bias_extreme_scores: List[Number] = [None] * n
    volume_surge_scores: List[Number] = [None] * n
    greedy_state: List[Optional[str]] = [None] * n

    if n < 120:
        return {
            "greedy": greedy,
            "components": {
                "pos_basis": pos_basis_scores, "up_gap": up_gap_scores,
                "greed_vol": greed_vol_scores, "bias_extreme": bias_extreme_scores,
                "volume_surge": volume_surge_scores,
            },
            "greedy_state": greedy_state,
        }

    opens = [d["open"] for d in stock_data]
    highs = [d["high"] for d in stock_data]
    lows = [d["low"] for d in stock_data]
    closes = [d["close"] for d in stock_data]
    volumes = [d["volume"] for d in stock_data]

    yz5 = calculate_yz_vol(opens, highs, lows, closes, 5)
    yz60 = calculate_yz_vol(opens, highs, lows, closes, 60)

    up_gaps = [0.0]
    for i in range(1, n):
        if opens[i] > 0 and closes[i - 1] > 0:
            up_gaps.append(max(0.0, math.log(opens[i] / closes[i - 1])))
        else:
            up_gaps.append(0.0)

    avg_up_gap20: List[Number] = [None] * n
    std_up_gap20: List[Number] = [None] * n
    for i in range(20, n):
        win = up_gaps[i - 19: i + 1]
        avg = sum(win) / 20.0
        avg_up_gap20[i] = avg
        sq = sum((x - avg) ** 2 for x in win)
        std_up_gap20[i] = math.sqrt(sq / 20.0)

    vol_ma20: List[Number] = [None] * n
    for i in range(19, n):
        vol_ma20[i] = sum(volumes[i - 19: i + 1]) / 20.0

    for i in range(120, n):
        close = closes[i]
        mahs_val = mahs[i]
        ma20_val = ma20[i]
        bias225_val = bias225[i]
        vol_short = yz5[i]
        vol_long = yz60[i]
        volume = volumes[i]
        vol_ma20_val = vol_ma20[i]
        if any(v is None for v in [mahs_val, ma20_val, bias225_val, vol_short, vol_long, vol_ma20_val]):
            continue

        is_up_trend = close > ma20_val
        is_above_mahs = close > mahs_val

        # 因子 1:正向成本偏离
        pos_basis_raw = max(0.0, (close - mahs_val) / mahs_val * 100)
        pos_history: List[float] = []
        for j in range(i - 119, i + 1):
            if j < 0:
                continue
            if mahs[j] is not None:
                pos_history.append(max(0.0, (closes[j] - mahs[j]) / mahs[j] * 100))
        pos_thr = _percentile(pos_history, 80)
        pos_extreme = _percentile(pos_history, 95)
        if pos_basis_raw <= pos_thr:
            score1 = 0.0
        elif pos_basis_raw >= pos_extreme:
            score1 = 100.0
        else:
            if pos_extreme - pos_thr > 0:
                score1 = (pos_basis_raw - pos_thr) / (pos_extreme - pos_thr) * 100
            else:
                score1 = 50.0
        pos_basis_scores[i] = min(max(score1, 0.0), 100.0)

        # 因子 2:向上跳空
        cur_up_gap = up_gaps[i]
        avg_g = avg_up_gap20[i]
        std_g = std_up_gap20[i]
        score2 = 0.0
        if avg_g is not None and std_g is not None:
            safe_std = max(std_g, 0.0001)
            z_up = (cur_up_gap - avg_g) / safe_std
            score2 = min(max(z_up * 15 + 50, 0.0), 100.0)
        up_gap_scores[i] = score2

        # 因子 3:贪婪型波动
        score3 = 0.0
        if is_up_trend:
            vol_long_history = [v for v in yz60[max(0, i - 59): i + 1] if v is not None]
            vol_long_mean = sum(vol_long_history) / len(vol_long_history) if vol_long_history else 10.0
            safe_vol_long = max(vol_long, vol_long_mean * 0.2, 0.5)
            curve_slope = (vol_short - vol_long) / safe_vol_long
            score3 = min(max(curve_slope * 40, 0.0), 100.0)
        greed_vol_scores[i] = score3

        # 因子 4:乖离率极端高位(BIAS225 历史百分位)
        bias_history: List[float] = []
        for j in range(i - 119, i + 1):
            if j < 0:
                continue
            if bias225[j] is not None:
                bias_history.append(bias225[j])
        pct_bias225 = _percentile_rank(bias225_val, bias_history)
        if pct_bias225 > 80:
            score4 = (pct_bias225 - 80) / (95 - 80) * 100
        else:
            score4 = 0.0
        bias_extreme_scores[i] = min(max(score4, 0.0), 100.0)

        # 因子 5:成交量激增
        vol_ratio = volume / vol_ma20_val
        vol_ratio_history: List[float] = []
        for j in range(i - 119, i + 1):
            if j < 0:
                continue
            if vol_ma20[j] is not None and vol_ma20[j] > 0:
                vol_ratio_history.append(volumes[j] / vol_ma20[j])
        vol_thr = _percentile(vol_ratio_history, 90)
        if vol_ratio <= 1.2:
            score5 = 0.0
        elif vol_ratio >= vol_thr:
            score5 = 100.0
        else:
            if vol_thr - 1.2 > 0:
                score5 = (vol_ratio - 1.2) / (vol_thr - 1.2) * 100
            else:
                score5 = 50.0
        volume_surge_scores[i] = min(max(score5, 0.0), 100.0)

        # 合成
        greedy_raw = (
            score1 * 0.30 + score2 * 0.20 + score3 * 0.15
            + score4 * 0.20 + score5 * 0.15
        )
        greedy[i] = min(max(greedy_raw, 0.0), 100.0)
        if greedy[i] >= 70 and is_above_mahs:
            greedy_state[i] = "greedy"
        else:
            greedy_state[i] = "normal"

    return {
        "greedy": greedy,
        "components": {
            "pos_basis": pos_basis_scores, "up_gap": up_gap_scores,
            "greed_vol": greed_vol_scores, "bias_extreme": bias_extreme_scores,
            "volume_surge": volume_surge_scores,
        },
        "greedy_state": greedy_state,
    }


# -----------------------------------------------------------------------------
# MA 斜率压力 / 趋势强度
# -----------------------------------------------------------------------------

def calculate_ma_slope(closes: List[float], ma_period: int, future_days: int = 5) -> List[Number]:
    n = len(closes)
    out: List[Number] = [None] * n
    ma = calculate_sma(closes, ma_period)
    start = ma_period + future_days - 1
    for i in range(start, n):
        cur_ma = ma[i]
        if cur_ma is None or cur_ma == 0:
            continue
        cur_close = closes[i]
        sum_remove = 0.0
        for j in range(future_days):
            rm_idx = i - (ma_period - 1) - j
            if rm_idx >= 0:
                sum_remove += closes[rm_idx]
        future_ma = (cur_ma * ma_period - sum_remove + future_days * cur_close) / ma_period
        total_change = future_ma - cur_ma
        daily_pct = (total_change / future_days) / cur_ma * 100
        out[i] = daily_pct
    return out


def calculate_slope_percentile(slopes: List[Number], lookback: int = 120) -> List[Number]:
    n = len(slopes)
    out: List[Number] = [None] * n
    for i in range(lookback, n):
        cur = slopes[i]
        if cur is None:
            continue
        history: List[float] = []
        for j in range(i - lookback, i):
            s = slopes[j]
            if s is not None and s < 0:
                history.append(abs(s))
        if len(history) < 10:
            continue
        history.sort()
        if cur <= 0.05:
            abs_cur = abs(cur)
            rank = sum(1 for s in history if abs_cur >= s)
            out[i] = rank / len(history) * 100
        else:
            out[i] = 0.0
    return out


def calculate_slope_pressure(
    slope20: List[Number], slope60: List[Number], slope225: List[Number]
) -> Dict:
    n = len(slope20)
    pressure: List[Number] = [None] * n
    level: List[Optional[int]] = [None] * n
    for i in range(n):
        s20, s60, s225 = slope20[i], slope60[i], slope225[i]
        if s20 is None or s60 is None or s225 is None:
            continue
        score = s20 * 0.3 + s60 * 0.3 + s225 * 0.4
        pressure[i] = min(round(score), 100)
        if score >= 70:
            level[i] = 3
        elif score >= 50:
            level[i] = 2
        elif score >= 30:
            level[i] = 1
        else:
            level[i] = 0
    return {"pressure": pressure, "level": level}


def calculate_trend_strength(
    ma5: List[Number], ma20: List[Number], ma60: List[Number], ma225: List[Number],
    slope20: List[Number], slope60: List[Number], slope225: List[Number]
) -> Dict:
    n = len(ma5)
    trend_strength: List[Optional[str]] = [None] * n
    trend_score: List[Number] = [None] * n
    for i in range(n):
        m5, m20, m60, m225 = ma5[i], ma20[i], ma60[i], ma225[i]
        if any(v is None for v in [m5, m20, m60, m225]):
            continue
        s20, s60, s225 = slope20[i], slope60[i], slope225[i]
        is_bull = m5 > m20 > m60
        is_strong_bull = is_bull and m60 > m225
        is_bear = m5 < m20 < m60
        is_strong_bear = is_bear and m60 < m225

        score = 0
        if is_strong_bull:
            score += 40
        elif is_bull:
            score += 25
        elif is_strong_bear:
            score -= 40
        elif is_bear:
            score -= 25
        if s20 is not None:
            score += 20 if s20 > 0 else (-20 if s20 < 0 else 0)
        if s60 is not None:
            score += 20 if s60 > 0 else (-20 if s60 < 0 else 0)
        if s225 is not None:
            score += 20 if s225 > 0 else (-20 if s225 < 0 else 0)
        score = max(-100, min(100, score))
        trend_score[i] = score
        if score >= 70:
            trend_strength[i] = "strong_bull"
        elif score >= 40:
            trend_strength[i] = "bull"
        elif score <= -70:
            trend_strength[i] = "strong_bear"
        elif score <= -40:
            trend_strength[i] = "bear"
        else:
            trend_strength[i] = "neutral"
    return {"trend_strength": trend_strength, "trend_score": trend_score}


# -----------------------------------------------------------------------------
# ADX / +DI / -DI (Wilder)
# -----------------------------------------------------------------------------

def _wilder_smooth(data: List[float], period: int) -> List[float]:
    if len(data) < period:
        return []
    out: List[float] = [sum(data[:period]) / period]
    for i in range(period, len(data)):
        prev = out[-1]
        out.append((prev * (period - 1) + data[i]) / period)
    return out


def calculate_adx(stock_data: List[Dict], period: int = 14) -> Dict:
    n = len(stock_data)
    adx: List[Number] = [None] * n
    plus_di: List[Number] = [None] * n
    minus_di: List[Number] = [None] * n
    adx_state: List[Optional[str]] = [None] * n
    adx_exhaustion: List[Optional[str]] = [None] * n

    if n < period + 1:
        return {"adx": adx, "plus_di": plus_di, "minus_di": minus_di,
                "adx_state": adx_state, "adx_exhaustion": adx_exhaustion}

    plus_dm: List[float] = []
    minus_dm: List[float] = []
    tr: List[float] = []
    for i in range(1, n):
        cur = stock_data[i]
        prev = stock_data[i - 1]
        up_move = cur["high"] - prev["high"]
        down_move = prev["low"] - cur["low"]
        plus_dm.append(up_move if (up_move > down_move and up_move > 0) else 0.0)
        minus_dm.append(down_move if (down_move > up_move and down_move > 0) else 0.0)
        tr1 = cur["high"] - cur["low"]
        tr2 = abs(cur["high"] - prev["close"])
        tr3 = abs(cur["low"] - prev["close"])
        tr.append(max(tr1, tr2, tr3))

    sm_plus = _wilder_smooth(plus_dm, period)
    sm_minus = _wilder_smooth(minus_dm, period)
    sm_tr = _wilder_smooth(tr, period)

    for i in range(period, n):
        idx = i - period
        if idx >= len(sm_tr) or sm_tr[idx] <= 0:
            continue
        plus_di[i] = 100 * sm_plus[idx] / sm_tr[idx]
        minus_di[i] = 100 * sm_minus[idx] / sm_tr[idx]
        di_diff = abs(plus_di[i] - minus_di[i])
        di_sum = plus_di[i] + minus_di[i]
        if di_sum > 0:
            dx = 100 * di_diff / di_sum
            if i == period:
                adx[i] = dx
            else:
                prev_adx = adx[i - 1] if adx[i - 1] is not None else dx
                adx[i] = (prev_adx * (period - 1) + dx) / period
            # ADX 状态(与 3 天前比)
            if i >= period + 3:
                cur_adx = adx[i]
                a3 = adx[i - 3]
                if cur_adx is not None and a3 is not None:
                    diff = cur_adx - a3
                    if diff > 1:
                        adx_state[i] = "rising"
                    elif diff < -1:
                        adx_state[i] = "falling"
                    else:
                        adx_state[i] = "flat"

    # 衰竭信号
    lookback = 10
    for i in range(period + lookback + 3, n):
        cur_state = adx_state[i]
        cur_adx = adx[i]
        if cur_state is None or cur_adx is None:
            continue
        if cur_state not in ("falling", "flat"):
            continue
        local_high = 0.0
        local_high_idx = -1
        for j in range(i - lookback, i):
            v = adx[j]
            if v is not None and v > local_high:
                local_high = v
                local_high_idx = j
        if local_high <= 0:
            continue
        has_declined = cur_adx < local_high * 0.9
        was_rising = local_high_idx >= 0 and adx_state[local_high_idx] == "rising"
        if has_declined and was_rising:
            pd_v = plus_di[i]
            md_v = minus_di[i]
            if pd_v is not None and md_v is not None:
                if md_v > pd_v:
                    adx_exhaustion[i] = "bottom"
                elif pd_v > md_v:
                    adx_exhaustion[i] = "top"
    return {"adx": adx, "plus_di": plus_di, "minus_di": minus_di,
            "adx_state": adx_state, "adx_exhaustion": adx_exhaustion}


# -----------------------------------------------------------------------------
# PVT (价量趋势) + 背离
# -----------------------------------------------------------------------------

def calculate_pvt(closes: List[float], volumes: List[float]) -> List[Number]:
    n = len(closes)
    out: List[Number] = [0.0] + [None] * (n - 1)
    if n < 2:
        return out
    for i in range(1, n):
        prev_c = closes[i - 1]
        if prev_c == 0:
            out[i] = out[i - 1]
            continue
        price_change = (closes[i] - prev_c) / prev_c
        out[i] = (out[i - 1] or 0.0) + volumes[i] * price_change
    return out


def calculate_pvt_divergence(
    stock_data: List[Dict],
    bias225: List[Number],
    cost_diff: List[Number],
    lookback: int = 20,
) -> Dict:
    n = len(stock_data)
    pvt = calculate_pvt([d["close"] for d in stock_data],
                        [d["volume"] for d in stock_data])
    pvt_divergence: List[Optional[str]] = [None] * n
    pvt_trend: List[Optional[str]] = [None] * n

    if n < 2:
        return {"pvt": pvt, "pvt_divergence": pvt_divergence, "pvt_trend": pvt_trend}

    for i in range(5, n):
        diff = (pvt[i] or 0.0) - (pvt[i - 5] or 0.0)
        if diff > 0:
            pvt_trend[i] = "rising"
        elif diff < 0:
            pvt_trend[i] = "falling"
        else:
            pvt_trend[i] = "flat"

    for i in range(lookback, n):
        recent_price = [d["close"] for d in stock_data[i - lookback: i + 1]]
        recent_pvt_raw = pvt[i - lookback: i + 1]
        recent_pvt = [v for v in recent_pvt_raw if v is not None]
        if len(recent_pvt) < lookback:
            continue

        price_high_idx = recent_price.index(max(recent_price))
        pvt_high_idx = recent_pvt.index(max(recent_pvt))
        price_low_idx = recent_price.index(min(recent_price))
        pvt_low_idx = recent_pvt.index(min(recent_pvt))

        cur_price = stock_data[i]["close"]
        cur_pvt = pvt[i] or 0.0
        prev_price_5 = stock_data[i - 5]["close"] if i - 5 >= 0 else cur_price

        cur_bias = bias225[i]
        cur_cost = cost_diff[i]
        is_price_high = cur_bias is not None and cur_bias > 80
        is_cost_diff_low = cur_cost is not None and cur_cost < 0

        is_price_higher = cur_price > prev_price_5 * 1.01
        is_price_lower = cur_price < prev_price_5 * 0.99
        price_high_later = price_high_idx >= pvt_high_idx
        price_low_later = price_low_idx >= pvt_low_idx

        pvt_high_value = recent_pvt[pvt_high_idx]
        pvt_low_value = recent_pvt[pvt_low_idx]
        pvt_gap_top = (pvt_high_value - cur_pvt) / (abs(pvt_high_value) + 1e-10)
        pvt_gap_bottom = (cur_pvt - pvt_low_value) / (abs(pvt_low_value) + 1e-10)
        is_pvt_not_higher = pvt_gap_top > 0.02
        is_pvt_not_lower = pvt_gap_bottom > 0.02

        if is_price_high and price_high_later and is_price_higher and is_pvt_not_higher:
            pvt_divergence[i] = "top"
        elif is_cost_diff_low and price_low_later and is_price_lower and is_pvt_not_lower:
            pvt_divergence[i] = "bottom"
        else:
            pvt_divergence[i] = "none"

    return {"pvt": pvt, "pvt_divergence": pvt_divergence, "pvt_trend": pvt_trend}


# -----------------------------------------------------------------------------
# 统一入口
# -----------------------------------------------------------------------------

def calculate_all_indicators(
    stock_data,
    capital: float,
    capital_unit: str = "shares",
) -> List[Dict]:
    """
    输入:
      stock_data: pd.DataFrame with columns [date, open, high, low, close, volume]
                  或 list of dicts with same keys
      capital: 流通股本(默认单位 shares 股;peistock 默认 ten_thousand_shares 万股)
      capital_unit: 'shares' | 'ten_thousand_shares'
    返回:每行一个 dict,包含全部指标。
    """
    # 兼容 DataFrame / List[Dict] 两种输入
    try:
        import pandas as pd
        if isinstance(stock_data, pd.DataFrame):
            records = stock_data.to_dict("records")
        else:
            records = list(stock_data)
    except ImportError:
        records = list(stock_data)

    if not records:
        return []

    closes = [float(r["close"]) for r in records]
    volumes = [float(r["volume"]) for r in records]
    n = len(records)
    capital_shares = capital * 10000 if capital_unit == "ten_thousand_shares" else capital

    dd = calculate_dd(volumes, capital_shares)
    mahs = calculate_mahs(closes, dd)
    emahs = calculate_emahs(closes, dd)
    cost_diff = [None if (mahs[i] is None or emahs[i] is None) else (emahs[i] - mahs[i]) for i in range(n)]
    cost_deviation = [None if mahs[i] is None else (closes[i] - mahs[i]) for i in range(n)]

    ma5 = calculate_sma(closes, 5)
    ma20 = calculate_sma(closes, 20)
    ma60 = calculate_sma(closes, 60)
    ma99 = calculate_sma(closes, 99)
    ma128 = calculate_sma(closes, 128)
    ma225 = calculate_sma(closes, 225)

    bias5 = calculate_bias(closes, ma5)
    bias20 = calculate_bias(closes, ma20)
    bias99 = calculate_bias(closes, ma99)
    bias128 = calculate_bias(closes, ma128)
    bias225 = calculate_bias(closes, ma225)

    cri_result = calculate_cri(records, mahs)
    greedy_result = calculate_greedy_score(records, mahs, ma20, bias225)

    sentiment: List[Number] = [None] * n
    for i in range(n):
        cv = cri_result["cri"][i]
        gv = greedy_result["greedy"][i]
        if cv is not None and gv is not None:
            sentiment[i] = min(max(gv - cv, -100), 100)

    slope20_raw = calculate_ma_slope(closes, 20, 5)
    slope60_raw = calculate_ma_slope(closes, 60, 5)
    slope225_raw = calculate_ma_slope(closes, 225, 5)
    slope20_pct = calculate_slope_percentile(slope20_raw, 120)
    slope60_pct = calculate_slope_percentile(slope60_raw, 120)
    slope225_pct = calculate_slope_percentile(slope225_raw, 120)
    slope_pressure_result = calculate_slope_pressure(slope20_pct, slope60_pct, slope225_pct)

    trend = calculate_trend_strength(ma5, ma20, ma60, ma225, slope20_raw, slope60_raw, slope225_raw)

    # BIAS225 历史分位
    bias225_pct: List[Number] = [None] * n
    for i in range(225, n):
        cur = bias225[i]
        if cur is None:
            continue
        history = [v for v in bias225[225: i] if v is not None]
        if len(history) >= 30:
            bias225_pct[i] = _percentile_rank_strict(cur, history)
        else:
            bias225_pct[i] = 50.0

    # 成本偏离历史分位
    cost_dev_pct: List[Number] = [None] * n
    first_valid_dev = next((i for i, v in enumerate(cost_deviation) if v is not None), -1)
    if first_valid_dev >= 0:
        for i in range(first_valid_dev + 30, n):
            cur = cost_deviation[i]
            if cur is None:
                continue
            history = [v for v in cost_deviation[first_valid_dev: i] if v is not None]
            if len(history) >= 30:
                cost_dev_pct[i] = _percentile_rank_strict(cur, history)
            else:
                cost_dev_pct[i] = 50.0

    # 贪婪历史分位
    greedy_pct: List[Number] = [None] * n
    greedy_arr = greedy_result["greedy"]
    first_valid_g = next((i for i, v in enumerate(greedy_arr) if v is not None), -1)
    if first_valid_g >= 0:
        for i in range(first_valid_g + 30, n):
            cur = greedy_arr[i]
            if cur is None:
                continue
            history = [v for v in greedy_arr[first_valid_g: i] if v is not None]
            if len(history) >= 30:
                greedy_pct[i] = _percentile_rank_strict(cur, history)
            else:
                greedy_pct[i] = 50.0

    adx_result = calculate_adx(records, 14)
    pvt_result = calculate_pvt_divergence(records, bias225, cost_diff, 20)

    out: List[Dict] = []
    for i, r in enumerate(records):
        out.append({
            "date": r.get("date", ""),
            "close": closes[i],
            "dd": dd[i],
            "mahs": mahs[i],
            "emahs": emahs[i],
            "cost_diff": cost_diff[i],
            "cost_deviation": cost_deviation[i],
            "cri": cri_result["cri"][i],
            "cri_percentile": cri_result["cri_percentile"][i],
            "cri_state": cri_result["cri_state"][i],
            "volume_state": cri_result["volume_state"][i],
            "vr": cri_result["vr"][i],
            "greedy": greedy_result["greedy"][i],
            "greedy_percentile": greedy_pct[i],
            "greedy_state": greedy_result["greedy_state"][i],
            "sentiment": sentiment[i],
            "ma5": ma5[i], "ma20": ma20[i], "ma60": ma60[i],
            "ma99": ma99[i], "ma128": ma128[i], "ma225": ma225[i],
            "bias5": bias5[i], "bias20": bias20[i],
            "bias99": bias99[i], "bias128": bias128[i],
            "bias225": bias225[i],
            "bias225_percentile": bias225_pct[i],
            "cost_deviation_percentile": cost_dev_pct[i],
            "slope_pressure": slope_pressure_result["pressure"][i],
            "slope_level": slope_pressure_result["level"][i],
            "slope20": slope20_raw[i],
            "slope60": slope60_raw[i],
            "slope225": slope225_raw[i],
            "trend_strength": trend["trend_strength"][i],
            "trend_score": trend["trend_score"][i],
            "adx": adx_result["adx"][i],
            "adx_state": adx_result["adx_state"][i],
            "adx_exhaustion": adx_result["adx_exhaustion"][i],
            "plus_di": adx_result["plus_di"][i],
            "minus_di": adx_result["minus_di"][i],
            "pvt": pvt_result["pvt"][i],
            "pvt_divergence": pvt_result["pvt_divergence"][i],
            "pvt_trend": pvt_result["pvt_trend"][i],
        })
    return out
