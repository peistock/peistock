#!/usr/bin/env python3
"""
panel.py — RebelResearchOS 反共识研究面板(人类视角版)

主导航:今日观察 / 分析个股 / 历史决策。
开发者视图(衰减记忆 / 市场快照 / 回测)收到「系统状态(高级)」抽屉。
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Tuple

import gradio as gr

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

DECISION_FILE = DATA / "decision.json"
BACKTEST_FILE = DATA / "backtest_report.json"
MEMORY_DB = DATA / "memory.db"
SNAPSHOT_CACHE = DATA / "market_snapshot.json"
STOCK_DECISIONS_DIR = DATA / "stock_decisions"
WINRATE_CACHE = DATA / "winrate_cache.json"
SNAPSHOT_TTL_SEC = 300

# ── Research Institute 编排器(懒加载,避免启动时耗时) ──
_institute = None

def _get_institute():
    global _institute
    if _institute is None:
        from institute.orchestrator import ResearchInstitute
        _institute = ResearchInstitute()
    return _institute


# ════════════════════════════════════════════════════════════════════
# 通用渲染 helper
# ════════════════════════════════════════════════════════════════════

DECISION_LABEL = {
    "long": ("🔼", "做多 LONG", "#10b981"),
    "short": ("🔽", "做空 SHORT", "#ef4444"),
    "neutral": ("➖", "观望 NEUTRAL", "#6b7280"),
}


def _color_box(bg: str, text: str) -> str:
    """Markdown 内嵌 HTML 色块。"""
    return (
        f'<div style="background:{bg};padding:14px 18px;border-radius:10px;'
        f'color:white;font-size:16px;line-height:1.6;">{text}</div>'
    )


def _market_temperature(card: dict) -> Tuple[str, str, str]:
    """读市场卡的 anomaly_triggers 决定体温色块。返回 (color, emoji, text)。"""
    triggers = (card or {}).get("anomaly_triggers", [])
    n = len(triggers)
    if n == 0:
        return "#10b981", "🟢", "**平静** — 7 类异常信号均未触发,系统暂无市场级判断"
    if n <= 2:
        return "#f59e0b", "🟡", f"**警惕** — {n} 类异常信号触发"
    return "#ef4444", "🔴", f"**警报** — {n} 类异常信号触发,Bull/Bear 已辩论"


def _render_temperature_box(card: dict) -> str:
    color, emoji, text = _market_temperature(card)
    return _color_box(color, f"{emoji} 市场体温\n\n{text}")


def _render_mock_alert(sources: str = "") -> str:
    detail = f"\n\n受影响数据源: {sources}" if sources else ""
    return _color_box("red", "🚫 Mock 数据拦截\n\n以下数据源使用了假数据,拒绝生成决策卡。" + detail + "\n\n请检查网络连接或代理设置(如 NO_PROXY=\"*\")。")


def _render_market_card_v2(card: dict) -> str:
    """市场级决策卡 v2(大字 + 关键字段)。"""
    if not card:
        return "*尚无市场级决策。点击下方「检查今日大盘」生成。*"
    decision = (card.get("decision") or "neutral").lower()
    emoji, label, _ = DECISION_LABEL.get(decision, DECISION_LABEL["neutral"])
    conviction = card.get("conviction", 0)
    thesis = card.get("thesis") or "(无)"
    catalyst = card.get("catalyst") or "N/A"
    kill = card.get("kill_switch") or "N/A"
    hold = card.get("holding_period") or "N/A"
    risk = card.get("risk_if_wrong") or "N/A"
    bull_c = card.get("bull_confidence", 0)
    bear_c = card.get("bear_confidence", 0)
    triggers = card.get("anomaly_triggers") or []
    trig_md = "\n".join(f"- {t}" for t in triggers) or "- (无)"
    ts = card.get("timestamp", "")

    return f"""# {emoji} {label}

### {conviction}% 信心  ·  Bull {bull_c} vs Bear {bear_c}

> {thesis}

| 字段 | 值 |
|---|---|
| 🎯 催化剂 | {catalyst} |
| 🛑 止损条件 | {kill} |
| ⏱  持有期 | {hold} |
| ⚠️ 如果错了 | {risk} |

**触发的异常信号**
{trig_md}

<sub>生成于 {ts}</sub>
"""


def _render_stock_header(card: dict) -> str:
    """个股头部:代码 / 名 / 现价 / 涨跌幅。"""
    code = card.get("code", "")
    name = card.get("name") or ""
    market = (card.get("market") or "").upper()
    price = card.get("price", "")
    chg = card.get("change_pct", 0) or 0
    market_label = "A 股" if market == "A" else ("HK 港股" if market == "HK" else market)
    chg_color = "#10b981" if (isinstance(chg, (int, float)) and chg >= 0) else "#ef4444"
    return _color_box(
        "#1f2937",
        f"<b>{name}</b> · {code} · {market_label}<br/>"
        f"现价 <b>{price}</b>  "
        f'<span style="color:{chg_color};">{"+" if chg and chg >= 0 else ""}{chg}%</span>'
        f'  <span style="opacity:0.6;font-size:13px;">●数据延迟约 3-15 分钟</span>',
    )


def _render_stock_decision_v2(card: dict) -> str:
    """个股决策大字 + 操作字段。"""
    decision = (card.get("decision") or "neutral").lower()
    emoji, label, _ = DECISION_LABEL.get(decision, DECISION_LABEL["neutral"])
    conviction = card.get("conviction", 0)
    thesis = card.get("thesis") or "(无)"
    catalyst = card.get("catalyst") or "N/A"
    kill = card.get("kill_switch") or "N/A"
    hold = card.get("holding_period") or "N/A"
    risk = card.get("risk_if_wrong") or "N/A"
    bull_c = card.get("bull_confidence", 0)
    bear_c = card.get("bear_confidence", 0)
    return f"""# {emoji} {label}

### {conviction}% 信心  ·  Bull {bull_c} vs Bear {bear_c}

> {thesis}

| 字段 | 值 |
|---|---|
| ⏱  持有期 | {hold} |
| 🛑 止损条件 | {kill} |
| 🎯 催化剂 | {catalyst} |
| ⚠️ 如果错了 | {risk} |
"""


def _render_debate(card: dict) -> Tuple[str, str]:
    """Bull / Bear 双栏内容,返回 (bull_md, bear_md)。"""
    bull_c = card.get("bull_confidence", 0)
    bear_c = card.get("bear_confidence", 0)
    bull_thesis = card.get("bull_thesis") or "(旧版本卡,无 Bull 论点)"
    bull_catalyst = card.get("bull_catalyst") or "(未提供)"
    bull_upside = card.get("bull_max_upside") or "(未估算)"
    bear_thesis = card.get("bear_thesis") or "(旧版本卡,无 Bear 论点)"
    bear_trigger = card.get("bear_trigger_condition") or "(未提供)"
    bear_loss = card.get("bear_max_loss") or "(未估算)"

    bull_md = f"""### 🐂 Bull · {bull_c} 分

> 📝 {bull_thesis}

**🎯 催化剂**
{bull_catalyst}

**📈 最大上行**
{bull_upside}
"""
    bear_md = f"""### 🐻 Bear · {bear_c} 分

> 📝 {bear_thesis}

**🚨 触发条件**
{bear_trigger}

**📉 最大损失**
{bear_loss}
"""
    return bull_md, bear_md


def _translate_indicators(ki: dict, peistock_signal_type: Optional[str]) -> list:
    """17 个 key_indicators → 人话规则,返回 [(emoji, label, detail), ...]"""
    if not ki:
        return [("➖", "无指标数据", "")]

    items = []

    def num(k):
        v = ki.get(k)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    bias_pct = num("bias225_percentile")
    cri_pct = num("cri_percentile")
    greed_pct = num("greedy_percentile")
    adx = num("adx")
    plus_di = num("plus_di")
    minus_di = num("minus_di")
    pvt = ki.get("pvt_divergence")
    cost_pct = num("cost_deviation_percentile")

    if bias_pct is not None:
        if bias_pct < 15:
            items.append(("⚠️", "超跌信号", f"BIAS225 处于历史 {bias_pct:.0f}% 分位(前 15%)"))
        elif bias_pct > 85:
            items.append(("⚠️", "超买信号", f"BIAS225 处于历史 {bias_pct:.0f}% 分位(后 15%)"))
    if cri_pct is not None and cri_pct > 85:
        items.append(("✅", "买点信号", f"CRI 处于历史 {cri_pct:.0f}% 分位"))
    if greed_pct is not None and greed_pct > 85:
        items.append(("⚠️", "贪婪信号", f"GSI 处于历史 {greed_pct:.0f}% 分位"))
    if cost_pct is not None:
        if cost_pct > 95:
            items.append(("⚠️", "成本偏离极端(高位)", f"分位 {cost_pct:.0f}%"))
        elif cost_pct < 5:
            items.append(("✅", "成本偏离极端(低位)", f"分位 {cost_pct:.0f}%"))
    if adx is not None and adx > 25 and plus_di is not None and minus_di is not None:
        if plus_di > minus_di:
            items.append(("✅", "上升趋势确认", f"ADX {adx:.0f}, +DI {plus_di:.0f} > -DI {minus_di:.0f}"))
        elif minus_di > plus_di:
            items.append(("⚠️", "下降趋势确认", f"ADX {adx:.0f}, -DI {minus_di:.0f} > +DI {plus_di:.0f}"))
    if pvt == "top":
        items.append(("⚠️", "顶背离", "PVT 与价格顶背离,警告"))
    elif pvt == "bottom":
        items.append(("✅", "底背离", "PVT 与价格底背离,机会"))
    if peistock_signal_type == "B":
        items.append(("✅", "雪球大V 买点", "严格 B 信号触发"))
    elif peistock_signal_type == "S":
        items.append(("⚠️", "雪球大V 卖点", "严格 S 信号触发"))

    if not items:
        items.append(("➖", "无显著信号", "所有指标处于中性区间"))
    return items


def _render_indicator_summary(card: dict) -> str:
    """关键指标(人话解读)区块。"""
    ki = card.get("key_indicators") or {}
    sig_type = card.get("peistock_signal_type")
    items = _translate_indicators(ki, sig_type)
    lines = ["| | 信号 | 解读 |", "|---|---|---|"]
    for emoji, label, detail in items:
        lines.append(f"| {emoji} | **{label}** | {detail} |")
    return "\n".join(lines)


def _render_indicator_full_table(ki: dict) -> str:
    """全部 17 个指标的精确数值表(折叠区)。"""
    if not ki:
        return "*无指标数据*"

    def f(v, nd=2):
        if v is None:
            return "N/A"
        try:
            return str(round(float(v), nd))
        except (TypeError, ValueError):
            return str(v)

    rows = [
        ("收盘", f(ki.get("close"))),
        ("MAHS", f(ki.get("mahs"))),
        ("MA20 / MA60 / MA225", f"{f(ki.get('ma20'))} / {f(ki.get('ma60'))} / {f(ki.get('ma225'))}"),
        ("BIAS225 / 分位", f"{f(ki.get('bias225'))} / {f(ki.get('bias225_percentile'), 1)}%"),
        ("CRI / 分位", f"{f(ki.get('cri'), 1)} / {f(ki.get('cri_percentile'), 1)}%"),
        ("GSI 分位", f"{f(ki.get('greedy_percentile'), 1)}%"),
        ("Cost dev / 分位", f"{f(ki.get('cost_deviation'))} / {f(ki.get('cost_deviation_percentile'), 1)}%"),
        ("ADX / +DI / -DI", f"{f(ki.get('adx'), 1)} / {f(ki.get('plus_di'), 1)} / {f(ki.get('minus_di'), 1)}"),
        ("PVT 背离", str(ki.get("pvt_divergence") or "none")),
        ("趋势强度", str(ki.get("trend_strength") or "unknown")),
    ]
    md = "| 指标 | 值 |\n|---|---|\n"
    md += "\n".join(f"| {k} | {v} |" for k, v in rows)
    return md


# ════════════════════════════════════════════════════════════════════
# 数据扫描 & 胜率计算
# ════════════════════════════════════════════════════════════════════

def _load_recent_decisions(days: int = 7) -> list:
    """扫 data/stock_decisions/<code>_<YYYYMMDD>.json,按 timestamp desc。"""
    if not STOCK_DECISIONS_DIR.exists():
        return []
    cutoff = datetime.now() - timedelta(days=days)
    out = []
    for path in STOCK_DECISIONS_DIR.glob("*.json"):
        try:
            card = json.loads(path.read_text(encoding="utf-8"))
            ts = card.get("timestamp")
            if ts:
                dt = datetime.fromisoformat(ts)
                if dt < cutoff:
                    continue
                card["_dt"] = dt
                card["_path"] = str(path)
                out.append(card)
        except Exception:
            continue
    out.sort(key=lambda c: c.get("_dt"), reverse=True)
    return out


def _load_all_decisions() -> list:
    """扫 data/stock_decisions/ 全部卡,按 timestamp desc。"""
    if not STOCK_DECISIONS_DIR.exists():
        return []
    out = []
    for path in STOCK_DECISIONS_DIR.glob("*.json"):
        try:
            card = json.loads(path.read_text(encoding="utf-8"))
            ts = card.get("timestamp")
            if ts:
                card["_dt"] = datetime.fromisoformat(ts)
                card["_path"] = str(path)
                out.append(card)
        except Exception:
            continue
    out.sort(key=lambda c: c.get("_dt"), reverse=True)
    return out


def _parse_holding_period(s: str) -> Optional[int]:
    """'T+5' / 'T+3' / '5-15 天' / 'N/A' → max days(int)。"""
    if not s or s == "N/A":
        return None
    m = re.search(r"T\+?(\d+)", s)
    if m:
        return int(m.group(1))
    m = re.search(r"(\d+)\s*[-~到]\s*(\d+)", s)
    if m:
        return int(m.group(2))
    m = re.search(r"(\d+)", s)
    if m:
        return int(m.group(1))
    return None


def _winrate_cache_load() -> dict:
    if not WINRATE_CACHE.exists():
        return {}
    try:
        return json.loads(WINRATE_CACHE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _winrate_cache_save(cache: dict):
    try:
        WINRATE_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def _compute_max_pnl(card: dict) -> dict:
    """
    返回 {max_pct: float|None, status: str, note: str}
    status: "win" | "loss" | "skip" | "no_data"
    """
    decision = (card.get("decision") or "").lower()
    if decision not in ("long", "short"):
        return {"max_pct": None, "status": "skip", "note": "(NEUTRAL 不计胜率)"}

    code = card.get("code")
    entry_price = card.get("price")
    hp_str = card.get("holding_period") or ""
    n_days = _parse_holding_period(hp_str)
    ts = card.get("timestamp")
    if not (code and entry_price and n_days and ts):
        return {"max_pct": None, "status": "no_data", "note": "(字段缺失)"}

    try:
        entry_dt = datetime.fromisoformat(ts)
    except Exception:
        return {"max_pct": None, "status": "no_data", "note": "(timestamp 解析失败)"}

    # 距今不足持有期 → 仍在持有
    elapsed = (datetime.now() - entry_dt).days
    in_progress = elapsed < n_days

    cache = _winrate_cache_load()
    cache_key = f"{code}_{entry_dt.strftime('%Y%m%d')}_{n_days}"
    if not in_progress and cache_key in cache:
        c = cache[cache_key]
        return c

    # 调 DataLayer
    try:
        sys.path.insert(0, str(ROOT))
        from core.data_layer import DataLayer
        dl = DataLayer()
        hist = dl.get_stock_history(code, days=n_days + 10)
        if hist is None or len(hist) == 0:
            return {"max_pct": None, "status": "no_data", "note": "(无历史数据)"}
        if hasattr(hist, "to_dict"):
            rows = hist.to_dict("records")
        else:
            rows = list(hist)

        post = [r for r in rows if _row_date(r) > entry_dt.date()]
        post = post[:n_days]
        if not post:
            return {"max_pct": None, "status": "no_data", "note": "(无 entry 之后的数据)"}

        ep = float(entry_price)
        if decision == "long":
            hi = max(float(r.get("high", r.get("close", 0))) for r in post)
            max_pct = (hi - ep) / ep * 100
        else:
            lo = min(float(r.get("low", r.get("close", 0))) for r in post)
            max_pct = (ep - lo) / ep * 100

        result = {
            "max_pct": round(max_pct, 2),
            "status": "win" if max_pct > 0 else "loss",
            "note": f"({'仍持有' if in_progress else '已结束'} · 数据点 {len(post)})",
        }
        if not in_progress:
            cache[cache_key] = result
            _winrate_cache_save(cache)
        return result
    except Exception as e:
        return {"max_pct": None, "status": "no_data", "note": f"(数据失败: {type(e).__name__})"}


def _row_date(row):
    d = row.get("date") or row.get("Date")
    if isinstance(d, str):
        return datetime.fromisoformat(d.split(" ")[0]).date()
    if hasattr(d, "date"):
        return d.date()
    return d


# ════════════════════════════════════════════════════════════════════
# 列表渲染:首页最近 & 历史决策表
# ════════════════════════════════════════════════════════════════════

def _pnl_badge(pnl: dict) -> str:
    status = pnl.get("status")
    pct = pnl.get("max_pct")
    if status == "win":
        return f"✅ +{pct}%"
    if status == "loss":
        return f"❌ {pct}%"
    if status == "skip":
        return "—"
    return "❓"


def _render_recent_list(cards: list, include_neutral: bool = False) -> str:
    if not cards:
        return "*近 7 天暂无个股决策。点击「分析个股」生成。*"
    filtered = [c for c in cards if include_neutral or (c.get("decision") or "").lower() in ("long", "short")]
    if not filtered:
        return "*近 7 天仅有 NEUTRAL 决策(暂无方向性观点)。*"
    rows = []
    for c in filtered[:10]:
        decision = (c.get("decision") or "neutral").lower()
        emoji, label, _ = DECISION_LABEL.get(decision, DECISION_LABEL["neutral"])
        code = c.get("code", "")
        name = (c.get("name") or "")[:8]
        conv = c.get("conviction", 0)
        dt = c.get("_dt")
        ago = ""
        if isinstance(dt, datetime):
            days = (datetime.now() - dt).days
            ago = f"{days} 天前" if days >= 1 else "今天"
        pnl = _compute_max_pnl(c)
        badge = _pnl_badge(pnl)
        rows.append(f"| {emoji} | **{label.split()[0]}** | `{code}` {name} | {conv}% | {ago} | {badge} |")
    md = "| | 决策 | 代码 | 信心 | 时间 | 持有期最大盈亏 |\n|---|---|---|---|---|---|\n" + "\n".join(rows)
    return md


def _render_history_table(cards: list, filter_decision: str = "all") -> Tuple[str, list]:
    """返回 (summary_md, dataframe_rows)。"""
    if filter_decision != "all":
        cards = [c for c in cards if (c.get("decision") or "").lower() == filter_decision]

    long_total = 0
    long_win = 0
    short_total = 0
    short_win = 0
    rows = []
    for c in cards:
        decision = (c.get("decision") or "neutral").lower()
        emoji, label, _ = DECISION_LABEL.get(decision, DECISION_LABEL["neutral"])
        code = c.get("code", "")
        name = (c.get("name") or "")[:10]
        conv = c.get("conviction", 0)
        dt = c.get("_dt")
        date_str = dt.strftime("%Y-%m-%d") if isinstance(dt, datetime) else ""
        pnl = _compute_max_pnl(c)
        badge = _pnl_badge(pnl)
        if decision == "long":
            long_total += 1
            if pnl["status"] == "win":
                long_win += 1
        elif decision == "short":
            short_total += 1
            if pnl["status"] == "win":
                short_win += 1
        rows.append([date_str, f"{emoji} {label.split()[0]}", code, name, f"{conv}%", badge])

    def pct(w, t):
        return f"{round(w/t*100, 1)}%" if t else "—"

    summary = (
        f"**累计 {len(cards)} 次决策**  ·  "
        f"LONG 胜率 {pct(long_win, long_total)} ({long_win}/{long_total})  ·  "
        f"SHORT 胜率 {pct(short_win, short_total)} ({short_win}/{short_total})"
    )
    return summary, rows


# ════════════════════════════════════════════════════════════════════
# 触发动作(调 LLM / akshare)
# ════════════════════════════════════════════════════════════════════

def _run_subprocess(args: list, timeout: int) -> str:
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, cwd=str(ROOT), timeout=timeout
        )
        log = result.stdout
        if result.stderr:
            log += "\n[STDERR]\n" + result.stderr
        if result.returncode != 0:
            log += f"\n[EXIT CODE {result.returncode}]"
        return log
    except subprocess.TimeoutExpired:
        return f"[ERROR] {args[1]} 超时 {timeout}s 未返回"
    except Exception as e:
        return f"[ERROR] {e}"


def _stream_subprocess(args: list, timeout: int, label: str = "运行中"):
    """Generator:Popen + 行缓冲 readline,每 0.3s 最多 yield 一次 rolling tail。

    为什么:`subprocess.run + capture_output` 阻塞收 pipe,长任务期间 Gradio SSE 通道空闲会被
    浏览器或中间代理断开,前端就一直转圈。改用 Popen + generator + yield 让 Gradio 持续
    把片段推送给前端,既给浏览器心跳也实时显示 [X/6] 进度。

    最后一次 yield 是完整 log(不带运行中提示)。
    """
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"  # 让子进程实时 flush stdout,否则行缓冲会被块缓冲覆盖

    try:
        proc = subprocess.Popen(
            args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, cwd=str(ROOT), env=env,
        )
    except Exception as e:
        yield f"[ERROR] 启动子进程失败:{e}"
        return

    lines: list = []
    start = time.time()
    last_emit = 0.0
    timed_out = False

    try:
        for raw in proc.stdout:
            # tqdm 进度条用 \r 覆盖,只取最后一段
            clean = raw.rstrip("\r\n")
            if "\r" in clean:
                clean = clean.split("\r")[-1]
            if clean:
                lines.append(clean)

            now = time.time()
            if now - start > timeout:
                proc.kill()
                lines.append(f"[ERROR] 超时 {timeout}s,已终止")
                timed_out = True
                break

            if now - last_emit > 0.3:
                elapsed = int(now - start)
                tail = "\n".join(lines[-30:])
                yield f"{tail}\n\n[{label} {elapsed}s ...]"
                last_emit = now
    finally:
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()

    if not timed_out and proc.returncode not in (0, None):
        if proc.returncode == 10:
            lines.append("[BLOCKED] Mock 数据拒绝生成决策卡")
        else:
            lines.append(f"[EXIT CODE {proc.returncode}]")

    yield "\n".join(lines)


def _is_mock_blocked(log: str) -> bool:
    return "[BLOCKED]" in log or "MOCK DATA DETECTED" in log


def run_market_analysis():
    """Generator:跑 main.py,边读边 yield (log, temperature_md, market_card_md)。"""
    holding_log = ""
    for partial_log in _stream_subprocess(
        [sys.executable, "-u", str(ROOT / "main.py")],
        timeout=180, label="市场分析中",
    ):
        holding_log = partial_log
        if _is_mock_blocked(holding_log):
            yield holding_log, _render_mock_alert(), "*Mock 数据拦截 — 决策未生成*"
        else:
            yield holding_log, _render_temperature_box({}), "*市场分析进行中,请等待...*"

    if _is_mock_blocked(holding_log):
        yield holding_log, _render_mock_alert(), "*Mock 数据拦截 — 决策未生成*"
        return

    card = load_decision()
    yield holding_log, _render_temperature_box(card), _render_market_card_v2(card)


def run_stock_analysis(code: str):
    """Generator:跑 main_stock.py,yield 7-tuple 对应
    (stock_log, header, decision, bull, bear, summary, full_table)。
    """
    code = (code or "").strip()
    if not code:
        yield ("[ERROR] 未输入股票代码", "", "*请先输入代码*", "", "", "", "")
        return

    holding_log = ""
    holding_decision = f"*正在分析 `{code}`,通常 60-90 秒,看下方日志查看实时进度...*"

    for partial_log in _stream_subprocess(
        [sys.executable, "-u", str(ROOT / "main_stock.py"), code],
        timeout=240, label=f"分析 {code} 中",
    ):
        holding_log = partial_log
        if _is_mock_blocked(holding_log):
            yield (
                holding_log, "", "*Mock 数据拦截 — 决策未生成*",
                _render_mock_alert(), "", "", "",
            )
        else:
            yield (holding_log, "", holding_decision, "", "", "", "")

    if _is_mock_blocked(holding_log):
        yield (
            holding_log, "", "*Mock 数据拦截 — 决策未生成*",
            _render_mock_alert(), "", "", "",
        )
        return

    card = _load_latest_stock_card(code)
    if not card:
        yield (holding_log, "", f"*尚无 `{code}` 的决策卡(看日志查看失败原因)*", "", "", "", "")
        return

    bull_md, bear_md = _render_debate(card)
    full_table = _render_indicator_full_table((card or {}).get("key_indicators", {}))
    yield (
        holding_log,
        _render_stock_header(card),
        _render_stock_decision_v2(card),
        bull_md,
        bear_md,
        _render_indicator_summary(card),
        full_table,
    )


def run_backtest_mock() -> Tuple[str, str, list]:
    log = _run_subprocess(
        [sys.executable, str(ROOT / "main_backtest.py"), "--mock"], timeout=300
    )
    summary, rows = load_backtest()
    return log, summary, rows


def fetch_snapshot_now() -> str:
    sys.path.insert(0, str(ROOT))
    try:
        from core.data_layer import DataLayer
        snap = DataLayer().get_full_snapshot()
        slim = {
            "timestamp": snap.get("timestamp"),
            "mag7_dispersion": snap.get("mag7_dispersion"),
            "margin_concentration": snap.get("margin_concentration"),
            "vix": snap.get("vix"),
            "pmi": snap.get("pmi"),
            "a_dispersion": snap.get("a_dispersion"),
            "hk_dispersion": snap.get("hk_dispersion"),
            "a_breadth": snap.get("a_breadth"),
        }
        SNAPSHOT_CACHE.write_text(json.dumps(slim, ensure_ascii=False, indent=2), encoding="utf-8")
        return _render_snapshot(slim, 0)
    except Exception as e:
        return f"抓取失败: {e}"


# ════════════════════════════════════════════════════════════════════
# 加载与渲染 — 开发者抽屉用
# ════════════════════════════════════════════════════════════════════

def load_decision() -> dict:
    if not DECISION_FILE.exists():
        return {}
    try:
        return json.loads(DECISION_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _load_latest_stock_card(code: str) -> Optional[dict]:
    if not STOCK_DECISIONS_DIR.exists():
        return None
    matches = sorted(STOCK_DECISIONS_DIR.glob(f"{code}_*.json"))
    if not matches:
        return None
    try:
        return json.loads(matches[-1].read_text(encoding="utf-8"))
    except Exception:
        return None


def load_memory_rows() -> list:
    if not MEMORY_DB.exists():
        return []
    try:
        conn = sqlite3.connect(str(MEMORY_DB))
        rows = conn.execute(
            """
            SELECT claim_id, content, claim_type,
                   current_confidence, original_confidence,
                   created_at, last_decayed, is_tombstoned, tombstone_reason
            FROM claims
            ORDER BY is_tombstoned ASC, current_confidence DESC, created_at DESC
            """
        ).fetchall()
        conn.close()
    except Exception as e:
        return [[f"读取失败: {e}", "", "", 0, 0, "", "", 0, ""]]
    out = []
    for r in rows:
        cid, content, ctype, cur, orig, created, decayed, tomb, reason = r
        out.append([
            cid,
            (content or "")[:100],
            ctype or "",
            round(float(cur or 0), 1),
            round(float(orig or 0), 1),
            created or "",
            decayed or "",
            "✓" if tomb else "",
            reason or "",
        ])
    return out


def memory_stats_md() -> str:
    rows = load_memory_rows()
    total = len(rows)
    tombs = sum(1 for r in rows if r[7] == "✓")
    return f"**记忆库**:共 {total} 条 · 活跃 {total - tombs} · 已 tombstone {tombs}"


def load_backtest() -> Tuple[str, list]:
    if not BACKTEST_FILE.exists():
        return "*尚无回测报告。*", []
    try:
        data = json.loads(BACKTEST_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        return f"读取失败: {e}", []
    stats = data.get("stats", {})

    def fmt(d):
        if not d:
            return "(无)"
        return (
            f"count={d.get('count',0)}, "
            f"win={d.get('win_rate',0)}%, "
            f"avg={d.get('avg_pnl',0)}%, "
            f"total={d.get('total_pnl',0)}%, "
            f"ks={d.get('kill_switch_rate',0)}%"
        )

    summary = f"""**Period:** {stats.get('period','')}  ·  **总交易数:** {stats.get('total_trades',0)}

- Combined: {fmt(stats.get('combined', {}))}
- Longs:    {fmt(stats.get('longs', {}))}
- Shorts:   {fmt(stats.get('shorts', {}))}
"""
    trades = data.get("trades", [])
    rows = [
        [
            t.get("entry_date", ""),
            t.get("decision", ""),
            t.get("ticker", ""),
            t.get("entry_price", 0),
            t.get("exit_price", 0),
            t.get("pnl_pct", 0),
            "✓" if t.get("hit_kill_switch") else "",
            t.get("kill_switch_reason", ""),
            t.get("holding_period", 0),
        ]
        for t in trades
    ]
    return summary, rows


def _render_snapshot(snap: dict, age_sec: Optional[float]) -> str:
    if not snap:
        return "*无缓存,点「立即抓取」(akshare+yfinance ~25-40 秒)*"
    fresh = "新鲜" if age_sec is not None and age_sec < SNAPSHOT_TTL_SEC else (
        f"已过期({int(age_sec/60)} 分钟前)" if age_sec is not None else ""
    )
    pmi = snap.get("pmi", {})
    pmi_val = pmi.get("manufacturing") if isinstance(pmi, dict) else pmi
    a_breadth = snap.get("a_breadth", {}) or {}
    return f"""### 市场快照 ({fresh})

| 指标 | 值 |
|---|---|
| Timestamp | {snap.get('timestamp','')} |
| Mag7 dispersion | {snap.get('mag7_dispersion')} |
| 融资集中度 | {snap.get('margin_concentration')} |
| VIX | {snap.get('vix')} |
| Manufacturing PMI | {pmi_val} |
| A 股龙头离散度 | {snap.get('a_dispersion')} |
| HK 龙头离散度 | {snap.get('hk_dispersion')} |
| A 股涨/跌停 | {a_breadth.get('zt_count', 'N/A')} / {a_breadth.get('dt_count', 'N/A')} |
| A 股涨家占比 | {a_breadth.get('advance_ratio', 'N/A')} |
"""


def load_snapshot_md() -> str:
    if not SNAPSHOT_CACHE.exists():
        return _render_snapshot({}, None)
    try:
        snap = json.loads(SNAPSHOT_CACHE.read_text(encoding="utf-8"))
        age = time.time() - SNAPSHOT_CACHE.stat().st_mtime
        return _render_snapshot(snap, age)
    except Exception as e:
        return f"读取快照失败: {e}"


# ════════════════════════════════════════════════════════════════════
# 角色编排 helper (Research Institute)
# ════════════════════════════════════════════════════════════════════

def _institute_status() -> str:
    """系统概览：角色列表、今日报告数、历史报告总数"""
    try:
        inst = _get_institute()
        roles = list(inst.roles.values())
        today = datetime.now().strftime("%Y%m%d")
        from institute.orchestrator import ARCHIVE_DIR
        reports = list(ARCHIVE_DIR.glob(f"{today}_*.md"))
        total_reports = len(list(ARCHIVE_DIR.glob("*.md")))

        lines = [
            f"**角色数**: {len(roles)}  ·  **今日报告**: {len(reports)} 份  ·  **历史报告总数**: {total_reports} 份",
            "",
            "### 已加载角色",
        ]
        for role in roles:
            dep_info = f" (依赖: {', '.join(role.dependencies)})" if role.dependencies else ""
            schedule_info = f" `{role.schedule}`" if role.schedule else " (事件驱动)"
            lines.append(f"- **{role.name}** (`{role.slug}`){schedule_info}{dep_info}")
        return "\n".join(lines)
    except Exception as e:
        return f"加载失败: {e}"


def _institute_run_role(slug: str) -> str:
    """执行单个角色，返回结果"""
    if not slug:
        return "请选择角色"
    try:
        inst = _get_institute()
        path = inst.run_analyst(slug)
        if path and path.exists():
            content = path.read_text(encoding="utf-8")
            return f"✅ 执行成功: {path.name}\n\n---\n\n{content[:3000]}"
        return "执行完成，但报告未生成"
    except Exception as e:
        return f"❌ 执行失败: {e}"


def _institute_run_briefing() -> str:
    """执行完整简报流程"""
    try:
        inst = _get_institute()
        path = inst.run_briefing("daily")
        if path and path.exists():
            content = path.read_text(encoding="utf-8")
            return f"✅ 简报生成成功: {path.name}\n\n---\n\n{content[:5000]}"
        return "简报生成完成，但文件未找到"
    except Exception as e:
        return f"❌ 简报生成失败: {e}"


def _institute_list_reports() -> str:
    """列出所有报告"""
    try:
        from institute.orchestrator import ARCHIVE_DIR
        reports = sorted(ARCHIVE_DIR.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not reports:
            return "暂无报告"
        lines = ["## 报告列表\n"]
        for r in reports[:50]:
            size = r.stat().st_size
            mtime = datetime.fromtimestamp(r.stat().st_mtime).strftime("%m-%d %H:%M")
            lines.append(f"- `{r.name}` — {size} 字节 — {mtime}")
        return "\n".join(lines)
    except Exception as e:
        return f"列表加载失败: {e}"


def _institute_read_report(report_name: str) -> str:
    """读取指定报告内容"""
    if not report_name:
        return "请选择报告"
    try:
        from institute.orchestrator import ARCHIVE_DIR
        path = ARCHIVE_DIR / report_name
        if not path.exists():
            return f"报告不存在: {report_name}"
        return path.read_text(encoding="utf-8")
    except Exception as e:
        return f"读取失败: {e}"


def _institute_report_choices() -> list:
    """返回报告下拉选项"""
    try:
        from institute.orchestrator import ARCHIVE_DIR
        reports = sorted(ARCHIVE_DIR.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
        return [p.name for p in reports]
    except Exception:
        return []


def _institute_role_choices() -> list:
    """返回角色下拉选项"""
    try:
        inst = _get_institute()
        return [(r.name, r.slug) for r in inst.roles.values()]
    except Exception:
        return []


# ════════════════════════════════════════════════════════════════════
# UI
# ════════════════════════════════════════════════════════════════════

MEMORY_HEADERS = [
    "claim_id", "content (前100字)", "type",
    "current_conf", "original_conf",
    "created_at", "last_decayed", "tomb", "tomb_reason",
]
BACKTEST_HEADERS = [
    "entry_date", "decision", "ticker",
    "entry$", "exit$", "pnl%",
    "ks_hit", "ks_reason", "days",
]


def _today_label() -> str:
    weekday = ["一", "二", "三", "四", "五", "六", "日"][datetime.now().weekday()]
    return datetime.now().strftime("%Y-%m-%d") + f" 周{weekday}"


def build_ui() -> gr.Blocks:
    with gr.Blocks(title="RebelResearchOS") as app:
        gr.Markdown("# RebelResearchOS\n*反共识研究面板 · Bull/Bear 强制对抗 · 没异常就闭嘴*")

        # ─────────────────────────── Tab 1: 今日观察 ───────────────────────────
        with gr.Tab("今日观察"):
            gr.Markdown(f"### 今天 {_today_label()}")

            init_card = load_decision()
            temperature_md = gr.Markdown(_render_temperature_box(init_card))

            with gr.Row():
                check_market_btn = gr.Button("检查今日大盘(调 LLM,~60 秒)", variant="primary")

            initial_show_card = bool(init_card.get("anomaly_triggers"))
            with gr.Accordion("📊 市场级决策详情", open=initial_show_card):
                market_card_md = gr.Markdown(_render_market_card_v2(init_card))

            gr.Markdown("### 📈 最近 7 天的个股观察")
            include_neutral = gr.Checkbox(label="同时显示 NEUTRAL 决策", value=False)
            recent_list_md = gr.Markdown(_render_recent_list(_load_recent_decisions(), include_neutral=False))

            with gr.Row():
                refresh_recent_btn = gr.Button("刷新最近列表")

            market_log = gr.Textbox(label="运行日志", lines=10, max_lines=20, interactive=False)

            check_market_btn.click(
                run_market_analysis,
                outputs=[market_log, temperature_md, market_card_md],
            )
            include_neutral.change(
                lambda inc: _render_recent_list(_load_recent_decisions(), include_neutral=inc),
                inputs=include_neutral,
                outputs=recent_list_md,
            )
            refresh_recent_btn.click(
                lambda inc: _render_recent_list(_load_recent_decisions(), include_neutral=inc),
                inputs=include_neutral,
                outputs=recent_list_md,
            )

        # ─────────────────────────── Tab 2: 分析个股 ───────────────────────────
        with gr.Tab("分析个股"):
            gr.Markdown("**输入 A 股 6 位代码或 HK 5 位代码**(如 `600989` / `01810`)")
            with gr.Row():
                stock_code = gr.Textbox(label="股票代码", value="", placeholder="600989 / 01810", scale=3)
                analyze_btn = gr.Button("开始分析(调 LLM, 20-40 秒)", variant="primary", scale=2)

            stock_header_md = gr.Markdown("")
            stock_decision_md = gr.Markdown("*输入代码后点「开始分析」。系统会:拉日K → 算 44 个指标 → 严格 B/S 检测 → Bull/Bear 双 LLM 辩论 → 出三选一决策。*")

            gr.Markdown("### 为什么 — 这场辩论")
            with gr.Row():
                bull_md = gr.Markdown("*Bull 论点(分析后展示)*")
                bear_md = gr.Markdown("*Bear 论点(分析后展示)*")

            gr.Markdown("### 关键指标(人话解读)")
            indicator_summary_md = gr.Markdown("*指标解读(分析后展示)*")

            with gr.Accordion("▼ 全部指标(开发者视图)", open=False):
                indicator_full_md = gr.Markdown("*尚无指标*")

            stock_log = gr.Textbox(label="运行日志", lines=12, max_lines=30, interactive=False)

            analyze_btn.click(
                run_stock_analysis,
                inputs=stock_code,
                outputs=[stock_log, stock_header_md, stock_decision_md,
                         bull_md, bear_md, indicator_summary_md, indicator_full_md],
            )

        # ─────────────────────────── Tab 3: 角色编排 ───────────────────────────
        with gr.Tab("角色编排"):
            gr.Markdown("### Research Institute 投研编排")

            with gr.Row():
                inst_status_md = gr.Markdown(_institute_status())
                inst_refresh_btn = gr.Button("刷新状态")

            inst_refresh_btn.click(fn=_institute_status, outputs=inst_status_md)

            gr.Markdown("#### 执行单个角色")
            with gr.Row():
                inst_role_dd = gr.Dropdown(
                    choices=_institute_role_choices(),
                    label="选择角色",
                    value=(_institute_role_choices()[0][1] if _institute_role_choices() else None),
                    scale=3,
                )
                inst_run_btn = gr.Button("执行", variant="primary", scale=1)
            inst_role_output = gr.Textbox(label="执行结果", lines=25, max_lines=40, interactive=False)
            inst_run_btn.click(fn=_institute_run_role, inputs=inst_role_dd, outputs=inst_role_output)

            gr.Markdown("#### 执行完整简报")
            inst_briefing_btn = gr.Button("执行今日完整简报流程", variant="primary")
            inst_briefing_output = gr.Textbox(label="简报内容", lines=25, max_lines=40, interactive=False)
            inst_briefing_btn.click(fn=_institute_run_briefing, outputs=inst_briefing_output)

            gr.Markdown("#### 报告列表")
            inst_reports_md = gr.Markdown(_institute_list_reports())
            inst_refresh_reports_btn = gr.Button("刷新报告列表")
            inst_refresh_reports_btn.click(fn=_institute_list_reports, outputs=inst_reports_md)

            gr.Markdown("#### 阅读报告")
            with gr.Row():
                inst_report_select = gr.Dropdown(
                    choices=_institute_report_choices(),
                    label="选择报告",
                    value=(_institute_report_choices()[0] if _institute_report_choices() else None),
                    scale=3,
                )
                inst_read_btn = gr.Button("读取", scale=1)
            inst_report_content = gr.Textbox(label="报告内容", lines=30, max_lines=40, interactive=False)
            inst_read_btn.click(fn=_institute_read_report, inputs=inst_report_select, outputs=inst_report_content)

            # 刷新报告下拉选项
            def _refresh_report_dropdown():
                return gr.Dropdown(choices=_institute_report_choices())
            inst_refresh_reports_btn.click(fn=_refresh_report_dropdown, outputs=inst_report_select)

        # ─────────────────────────── Tab 4: 历史决策 ───────────────────────────
        with gr.Tab("历史决策"):
            gr.Markdown("**累计的所有个股决策卡** · 胜率口径:持有期内最大涨跌幅(LONG 看 max-high,SHORT 看 min-low)")

            with gr.Row():
                filter_dd = gr.Dropdown(
                    choices=[("全部", "all"), ("LONG", "long"), ("SHORT", "short"), ("NEUTRAL", "neutral")],
                    value="all", label="筛选", scale=1,
                )
                refresh_hist_btn = gr.Button("刷新(重算胜率,慢)", scale=1)

            all_cards = _load_all_decisions()
            init_summary, init_rows = _render_history_table(all_cards, "all")
            history_summary_md = gr.Markdown(init_summary)

            history_table = gr.Dataframe(
                headers=["日期", "决策", "代码", "名称", "信心", "持有期最大盈亏"],
                value=init_rows,
                wrap=True,
                interactive=False,
            )

            def _refresh_hist(filt):
                cards = _load_all_decisions()
                summary, rows = _render_history_table(cards, filt)
                return summary, rows

            filter_dd.change(_refresh_hist, inputs=filter_dd, outputs=[history_summary_md, history_table])
            refresh_hist_btn.click(_refresh_hist, inputs=filter_dd, outputs=[history_summary_md, history_table])

        # ─────────────────────────── 折叠抽屉:系统状态(高级) ───────────────────────────
        with gr.Accordion("⚙️ 系统状态(高级)", open=False):
            with gr.Tabs():
                with gr.Tab("衰减记忆"):
                    mem_stat = gr.Markdown(memory_stats_md())
                    mem_table = gr.Dataframe(
                        headers=MEMORY_HEADERS, value=load_memory_rows(),
                        wrap=True, interactive=False,
                    )
                    mem_refresh = gr.Button("刷新")
                    mem_refresh.click(
                        lambda: (memory_stats_md(), load_memory_rows()),
                        outputs=[mem_stat, mem_table],
                    )

                with gr.Tab("市场快照"):
                    snap_md = gr.Markdown(load_snapshot_md())
                    gr.Markdown("*实时抓取走 akshare + yfinance,冷启动约 25-40 秒。*")
                    fetch_btn = gr.Button("立即抓取", variant="primary")
                    fetch_btn.click(fetch_snapshot_now, outputs=snap_md)
                    snap_refresh = gr.Button("仅从缓存刷新")
                    snap_refresh.click(load_snapshot_md, outputs=snap_md)

                with gr.Tab("回测"):
                    bt_summary_init, bt_rows_init = load_backtest()
                    bt_summary = gr.Markdown(bt_summary_init)
                    bt_table = gr.Dataframe(
                        headers=BACKTEST_HEADERS, value=bt_rows_init,
                        wrap=True, interactive=False,
                    )
                    bt_btn = gr.Button("跑回测(mock decisions)", variant="primary")
                    bt_log = gr.Textbox(label="运行日志", lines=10, max_lines=20, interactive=False)
                    bt_btn.click(run_backtest_mock, outputs=[bt_log, bt_summary, bt_table])
                    bt_refresh = gr.Button("仅刷新")
                    bt_refresh.click(load_backtest, outputs=[bt_summary, bt_table])

    return app


if __name__ == "__main__":
    demo = build_ui()
    port = int(os.environ.get("GRADIO_SERVER_PORT", "7862"))
    demo.launch(server_name="0.0.0.0", server_port=port, share=False, theme=gr.themes.Soft())
