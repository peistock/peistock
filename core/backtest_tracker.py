"""
core/backtest_tracker.py
决策验证追踪器：将 AI 决策卡与实际行情对照，记录真实盈亏。

形成"决策 → 记录 → 到期验证 → 统计 → 新决策参考"的闭环。
"""
import json
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional

# 数据库文件（与 memory.db 同级）
DB_PATH = Path(__file__).parent.parent / "data" / "backtest_tracker.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _init_db():
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS validated_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            decision_date TEXT NOT NULL,
            decision TEXT NOT NULL,
            conviction REAL,
            entry_price REAL,
            exit_price REAL,
            actual_pnl REAL,
            holding_days INTEGER,
            hit_kill_switch INTEGER DEFAULT 0,
            validated_at TEXT,
            bull_confidence REAL,
            bear_confidence REAL,
            preemption_score REAL,
            sentiment_rating TEXT,
            kill_switch TEXT,
            holding_period TEXT,
            UNIQUE(code, decision_date)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_code ON validated_decisions(code)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_date ON validated_decisions(decision_date)
    """)
    conn.commit()
    conn.close()


_init_db()


def _load_decision_cards(decisions_dir: str = "data/stock_decisions") -> List[Dict]:
    """扫描决策卡目录，返回未验证的决策列表。"""
    p = Path(decisions_dir)
    if not p.exists():
        return []

    cards = []
    for fpath in sorted(p.glob("*.json")):
        try:
            card = json.loads(fpath.read_text(encoding="utf-8"))
            timestamp = card.get("timestamp", "")
            if isinstance(timestamp, str) and len(timestamp) >= 10:
                decision_date = timestamp[:10]
            else:
                # fallback 从文件名
                stem = fpath.stem
                parts = stem.split("_")
                if len(parts) >= 2 and parts[-1].isdigit() and len(parts[-1]) == 8:
                    decision_date = f"{parts[-1][:4]}-{parts[-1][4:6]}-{parts[-1][6:8]}"
                else:
                    continue

            card["_decision_date"] = decision_date
            cards.append(card)
        except Exception:
            continue
    return cards


def _is_decision_validated(code: str, decision_date: str) -> bool:
    conn = _get_conn()
    row = conn.execute(
        "SELECT 1 FROM validated_decisions WHERE code=? AND decision_date=?",
        (code, decision_date)
    ).fetchone()
    conn.close()
    return row is not None


def validate_pending_decisions(decisions_dir: str = "data/stock_decisions") -> Dict:
    """
    扫描所有未验证的决策卡，计算实际盈亏并写入数据库。
    只验证持有期已过的决策（决策日 + holding_days + 2 < 今天）。

    Returns:
        {"validated": int, "skipped": int, "errors": int}
    """
    from core.backtest import BacktestEngine

    cards = _load_decision_cards(decisions_dir)
    today = datetime.now().date()
    validated = 0
    skipped = 0
    errors = 0

    # 收集所有需要验证的决策，按 ticker 分组以减少数据加载
    pending = []
    for card in cards:
        code = card.get("code", "")
        decision_date = card.get("_decision_date", "")
        if not code or not decision_date:
            skipped += 1
            continue
        if _is_decision_validated(code, decision_date):
            skipped += 1
            continue

        # 检查持有期是否已过
        hp = str(card.get("holding_period", "T+5")).upper()
        days = 5
        if hp.startswith("T+"):
            try:
                days = int(hp.replace("T+", "").strip())
            except ValueError:
                pass
        try:
            d = datetime.strptime(decision_date, "%Y-%m-%d").date()
            if d + timedelta(days=days + 2) > today:
                skipped += 1
                continue
        except ValueError:
            skipped += 1
            continue

        pending.append(card)

    if not pending:
        return {"validated": 0, "skipped": skipped, "errors": 0}

    # 初始化回测引擎（日期范围覆盖所有待验证决策）
    min_date = min(
        c.get("_decision_date", "2024-01-01") for c in pending
    )
    max_date = (today + timedelta(days=1)).strftime("%Y-%m-%d")

    engine = BacktestEngine(start_date=min_date, end_date=max_date)

    conn = _get_conn()
    for card in pending:
        code = card.get("code", "")
        decision_date = card.get("_decision_date", "")
        market = card.get("market", "")

        # 推断 ticker
        if market == "a" or (len(code) == 6 and code.isdigit()):
            ticker = code + ".SS" if code.startswith("6") or code.startswith("5") else code + ".SZ"
        elif market == "hk" or len(code) == 5:
            ticker = code + ".HK"
        else:
            ticker = code.upper()

        try:
            trade = engine.run_trade(
                entry_date=decision_date,
                decision=str(card.get("decision", "")).lower(),
                ticker=ticker,
                conviction=float(card.get("conviction", 0) or 0),
                kill_switch=card.get("kill_switch", ""),
                holding_period=card.get("holding_period", "T+5"),
                thesis=card.get("thesis", ""),
                entry_price=card.get("price"),
                bull_confidence=card.get("bull_confidence"),
                bear_confidence=card.get("bear_confidence"),
                preemption_score=card.get("preemption_score"),
            )
            if trade:
                conn.execute("""
                    INSERT OR REPLACE INTO validated_decisions
                    (code, decision_date, decision, conviction, entry_price,
                     exit_price, actual_pnl, holding_days, hit_kill_switch,
                     validated_at, bull_confidence, bear_confidence,
                     preemption_score, sentiment_rating, kill_switch, holding_period)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    code, decision_date, trade.decision, trade.conviction,
                    trade.entry_price, trade.exit_price, trade.pnl_pct,
                    trade.holding_period, 1 if trade.hit_kill_switch else 0,
                    datetime.now().isoformat(),
                    trade.bull_confidence, trade.bear_confidence,
                    trade.preemption_score,
                    card.get("sentiment_rating"),  # 决策卡中可能没有，预留
                    str(card.get("kill_switch", "")),
                    str(card.get("holding_period", "")),
                ))
                validated += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"[BacktestTracker] Validate failed {code}@{decision_date}: {e}")
            errors += 1

    conn.commit()
    conn.close()
    return {"validated": validated, "skipped": skipped, "errors": errors}


def get_stock_history_stats(code: str) -> Optional[Dict]:
    """
    获取某股票的历史验证统计。

    Returns:
        {
            "code": str,
            "total_decisions": int,
            "long": {"count": int, "win_rate": float, "avg_pnl": float, "total_pnl": float},
            "short": {"count": int, "win_rate": float, "avg_pnl": float, "total_pnl": float},
            "neutral": {"count": int},
            "recent_trades": [list of last 5 trades],
        }
    """
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM validated_decisions WHERE code=? ORDER BY decision_date DESC",
        (code,)
    ).fetchall()
    conn.close()

    if not rows:
        return None

    longs = [r for r in rows if r["decision"] == "long"]
    shorts = [r for r in rows if r["decision"] == "short"]

    def _calc(trades):
        if not trades:
            return {"count": 0}
        pnls = [t["actual_pnl"] for t in trades if t["actual_pnl"] is not None]
        wins = [p for p in pnls if p > 0]
        return {
            "count": len(trades),
            "win_rate": round(len(wins) / len(pnls) * 100, 1) if pnls else 0,
            "avg_pnl": round(sum(pnls) / len(pnls), 2) if pnls else 0,
            "total_pnl": round(sum(pnls), 2),
        }

    recent = []
    for r in rows[:5]:
        recent.append({
            "decision_date": r["decision_date"],
            "decision": r["decision"],
            "conviction": r["conviction"],
            "actual_pnl": r["actual_pnl"],
            "holding_days": r["holding_days"],
            "preemption_score": r["preemption_score"],
        })

    return {
        "code": code,
        "total_decisions": len(rows),
        "long": _calc(longs),
        "short": _calc(shorts),
        "recent_trades": recent,
    }


def get_condition_stats(min_samples: int = 3) -> Dict:
    """
    按条件分组统计全局表现（用于发现策略优劣）。

    Returns:
        {
            "by_conviction_high": {...},
            "by_conviction_mid": {...},
            "by_preemption_high": {...},
            ...
        }
    """
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM validated_decisions WHERE actual_pnl IS NOT NULL"
    ).fetchall()
    conn.close()

    if not rows:
        return {}

    def _group(trades):
        if not trades:
            return {}
        pnls = [t["actual_pnl"] for t in trades]
        wins = [p for p in pnls if p > 0]
        return {
            "count": len(trades),
            "win_rate": round(len(wins) / len(pnls) * 100, 1),
            "avg_pnl": round(sum(pnls) / len(pnls), 2),
            "total_pnl": round(sum(pnls), 2),
        }

    # 按置信度分组
    high_conf = [r for r in rows if r["conviction"] and r["conviction"] >= 70]
    mid_conf = [r for r in rows if r["conviction"] and 40 <= r["conviction"] < 70]
    low_conf = [r for r in rows if r["conviction"] and r["conviction"] < 40]

    # 按 Preemption 分组
    high_prep = [r for r in rows if r["preemption_score"] and r["preemption_score"] >= 60]
    mid_prep = [r for r in rows if r["preemption_score"] and 30 <= r["preemption_score"] < 60]
    low_prep = [r for r in rows if r["preemption_score"] and r["preemption_score"] < 30]

    # 按 Bull/Bear 差值分组
    bull_dom = [r for r in rows if r["bull_confidence"] and r["bear_confidence"]
                and r["bull_confidence"] - r["bear_confidence"] > 30]
    bear_dom = [r for r in rows if r["bull_confidence"] and r["bear_confidence"]
                and r["bear_confidence"] - r["bull_confidence"] > 30]

    result = {}
    groups = {
        "conviction_high(>=70)": high_conf,
        "conviction_mid(40-69)": mid_conf,
        "convidence_low(<40)": low_conf,
        "preemption_high(>=60)": high_prep,
        "preemption_mid(30-59)": mid_prep,
        "preemption_low(<30)": low_prep,
        "bull_dominant(diff>30)": bull_dom,
        "bear_dominant(diff>30)": bear_dom,
    }

    for label, trades in groups.items():
        if len(trades) >= min_samples:
            result[label] = _group(trades)

    return result


def format_stock_stats_for_prompt(code: str) -> str:
    """
    将某股票的历史验证统计格式化为 Markdown，可直接注入 Chair prompt。
    """
    stats = get_stock_history_stats(code)
    if not stats:
        return ""

    lines = [
        f"【该股票历史决策验证 · {code}】",
        "",
        f"该股票共有 {stats['total_decisions']} 次已验证的 AI 决策，历史表现如下：",
        "",
    ]

    long_stats = stats.get("long", {})
    if long_stats.get("count", 0) > 0:
        lines.append(
            f"- **LONG**：{long_stats['count']} 次，胜率 {long_stats['win_rate']}%，"
            f"平均收益 {long_stats['avg_pnl']:+.2f}%，累计收益 {long_stats['total_pnl']:+.2f}%"
        )

    short_stats = stats.get("short", {})
    if short_stats.get("count", 0) > 0:
        lines.append(
            f"- **SHORT**：{short_stats['count']} 次，胜率 {short_stats['win_rate']}%，"
            f"平均收益 {short_stats['avg_pnl']:+.2f}%，累计收益 {short_stats['total_pnl']:+.2f}%"
        )

    recent = stats.get("recent_trades", [])
    if recent:
        lines.append("")
        lines.append("最近 5 次已验证决策：")
        for t in recent:
            pnl_str = f"{t['actual_pnl']:+.2f}%" if t['actual_pnl'] is not None else "N/A"
            prep_str = f" Preemption={t['preemption_score']}" if t.get('preemption_score') else ""
            lines.append(
                f"- {t['decision_date']} {t['decision'].upper()} "
                f"(conv={t['conviction']}) → 实际盈亏 {pnl_str}{prep_str}"
            )

    lines.append("")
    lines.append("Chair 裁决时应参考以上历史表现："
                 "如果该股票历史上同类决策胜率显著低于 50%，应降低 conviction 或趋于保守。")
    return "\n".join(lines)
