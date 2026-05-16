#!/usr/bin/env python3
"""
api_server.py — RROS HTTP API（供 peistock 前端调用）

运行: PYTHONPATH=~/family-mind uvicorn api_server:app --port 8000
"""
import os
import re
import sys
import json
import logging
import threading
import uuid
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

ARCHIVE_DIR = ROOT / "data" / "archives"
ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

FM_ROOT = os.path.expanduser("~/family-mind")
if FM_ROOT not in sys.path:
    sys.path.insert(0, FM_ROOT)

from dotenv import load_dotenv
# 先加载 rebel_research 自己的 .env（DeepSeek 配置优先）
load_dotenv(os.path.join(ROOT, ".env"))
# 再加载 family-mind 的 .env（本地未设置的变量兜底）
load_dotenv(os.path.join(FM_ROOT, ".env"))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="RROS API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_institute = None

def _get_institute():
    global _institute
    if _institute is None:
        from institute.orchestrator import ResearchInstitute
        _institute = ResearchInstitute()
    return _institute


@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.now().isoformat()}


# ── Async job queue ──────────────────────────────────────────────────────────
_jobs = {}
_jobs_lock = threading.Lock()
_bg_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="analyze-")


def _run_analysis_task(task_id: str, code: str, signal: str, date_str: str):
    """后台执行分析链，结果写入 _jobs。"""
    inst = _get_institute()
    try:
        # Phase 0: 预取研报客观数据（只取一次，供 Bull/Bear/Preemption 共用）
        research_data = ""
        try:
            from core.research_report import get_research_report_data, summarize_for_prompt
            market = "a" if len(code) == 6 and code.isdigit() else "hk"
            rr_raw = get_research_report_data(code, market=market, limit=2, llm=inst.llm)
            if rr_raw:
                research_data = summarize_for_prompt(rr_raw, max_total_chars=2000)
                logger.info(f"[{code}] 研报数据已获取: {len(research_data)} 字符")
        except Exception as e:
            logger.warning(f"[{code}] 研报获取失败: {e}")

        ctx = {"code": code, "signal": signal, "research_report_data": research_data}

        with _jobs_lock:
            _jobs[task_id]["status"] = "running"
            _jobs[task_id]["progress"] = "Bull/Bear 并行分析中..."

        # Phase 1: Bull / Bear 并行
        original_effort = getattr(inst.llm, "reasoning_effort", None)
        inst.llm.reasoning_effort = None
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = {
                    pool.submit(inst.run_analyst, "bull", date_str, context=ctx): "bull",
                    pool.submit(inst.run_analyst, "bear", date_str, context=ctx): "bear",
                }
                for fut in as_completed(futures):
                    role = futures[fut]
                    try:
                        fut.result()
                        logger.info(f"[{code}] {role} 分析完成")
                    except Exception as e:
                        logger.error(f"[{code}] {role} 分析失败: {e}")
        finally:
            inst.llm.reasoning_effort = original_effort

        with _jobs_lock:
            _jobs[task_id]["progress"] = "Preemption / Sentiment 并行分析中..."

        # Phase 2: Preemption + Sentiment 并行（均依赖 Bull/Bear）
        inst.llm.reasoning_effort = "high"
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = {
                    pool.submit(inst.run_analyst, "preemption", date_str, context=ctx): "preemption",
                    pool.submit(inst.run_analyst, "sentiment", date_str, context=ctx): "sentiment",
                }
                for fut in as_completed(futures):
                    role = futures[fut]
                    try:
                        fut.result()
                        logger.info(f"[{code}] {role} 分析完成")
                    except Exception as e:
                        logger.error(f"[{code}] {role} 分析失败: {e}")
        finally:
            inst.llm.reasoning_effort = original_effort

        with _jobs_lock:
            _jobs[task_id]["progress"] = "Chair 投委会裁决中..."

        # Phase 3: Chair
        inst.llm.reasoning_effort = "high"
        try:
            path = inst.run_analyst("chair_debate", date_str, context=ctx)
        finally:
            inst.llm.reasoning_effort = original_effort

        if path and path.exists():
            content = path.read_text(encoding="utf-8")
            with _jobs_lock:
                _jobs[task_id].update({
                    "status": "completed",
                    "result": {
                        "code": code,
                        "date": date_str,
                        "status": "completed",
                        "report_path": str(path),
                        "report_preview": content[:8000],
                    },
                    "progress": "分析完成",
                })
        else:
            with _jobs_lock:
                _jobs[task_id].update({
                    "status": "error",
                    "detail": "chair report not found",
                    "progress": "Chair 报告未找到",
                })
    except Exception as e:
        logger.error(f"[{code}] 分析任务异常: {e}")
        with _jobs_lock:
            _jobs[task_id].update({
                "status": "error",
                "detail": str(e),
                "progress": f"异常: {str(e)[:100]}",
            })


@app.post("/api/analyze/stock/{code}")
def analyze_stock(code: str, signal: str = "B"):
    """提交分析任务，立即返回 task_id。分析在后台异步执行。"""
    date_str = datetime.now().strftime("%Y%m%d")

    # 检查当天是否已有 Chair 报告缓存
    cache_path = ARCHIVE_DIR / f"{date_str}_{code}_chair_debate.md"
    if cache_path.exists():
        content = cache_path.read_text(encoding="utf-8")
        task_id = f"cached_{code}_{date_str}"
        with _jobs_lock:
            _jobs[task_id] = {
                "code": code,
                "signal": signal,
                "status": "completed",
                "progress": "当日已分析，直接展示缓存",
                "created_at": datetime.now().isoformat(),
                "result": {
                    "code": code,
                    "date": date_str,
                    "status": "completed",
                    "report_path": str(cache_path),
                    "report_preview": content[:8000],
                },
            }
        logger.info(f"[{code}] 当日缓存命中，直接返回: {task_id}")
        # 直接返回 completed，前端无需轮询
        return {
            "task_id": task_id,
            "status": "completed",
            "progress": "当日已分析，直接展示缓存",
            "result": _jobs[task_id]["result"],
        }

    task_id = f"{code}_{datetime.now().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:6]}"
    with _jobs_lock:
        _jobs[task_id] = {
            "code": code,
            "signal": signal,
            "status": "queued",
            "progress": "排队中...",
            "created_at": datetime.now().isoformat(),
        }
    _bg_pool.submit(_run_analysis_task, task_id, code, signal, date_str)
    logger.info(f"[{code}] 分析任务已提交: {task_id}")
    return {"task_id": task_id, "status": "queued"}


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str):
    """轮询查询分析任务状态与结果。"""
    with _jobs_lock:
        job = _jobs.get(task_id)
    if not job:
        return {"status": "not_found", "detail": "任务不存在或已过期"}
    resp = {
        "task_id": task_id,
        "code": job.get("code"),
        "status": job["status"],
        "progress": job.get("progress", ""),
        "created_at": job.get("created_at"),
    }
    if job["status"] == "completed":
        resp["result"] = job.get("result")
    elif job["status"] == "error":
        resp["detail"] = job.get("detail", "未知错误")
    return resp


@app.get("/api/decisions/recent")
def recent_decisions(days: int = 7):
    """最近决策列表"""
    data_dir = ROOT / "data" / "stock_decisions"
    results = []
    if data_dir.exists():
        for path in sorted(data_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                card = json.loads(path.read_text(encoding="utf-8"))
                results.append({
                    "file": path.name,
                    "code": card.get("code"),
                    "name": card.get("name"),
                    "decision": card.get("decision"),
                    "conviction": card.get("conviction"),
                    "date": card.get("timestamp", ""),
                })
            except Exception:
                continue
    return {"decisions": results[:days * 3], "count": len(results)}


def _extract_summary(md_text: str, max_chars: int = 150) -> str:
    """从 Markdown 报告中提取核心观点摘要。去掉标题行和开场白话术，取前2段实质内容。"""
    if not md_text:
        return ""

    # 开场白话术过滤（中文）：只要以这些词开头，整段跳过
    filler_patterns = re.compile(
        r"^(现在我已|现在我已经|现在让我|让我|以下为|基于当前|基于以上|基于前述|基于已有|根据以上|根据已有|我将|我已经|我已完成|正在|开始|接下来|首先|综合以上|整理|构建|输出|生成|分析|报告|结论|汇总|总结)",
        re.IGNORECASE,
    )

    paragraphs = []
    for line in md_text.split("\n"):
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("---"):
            continue
        # 去掉 Markdown 粗体/斜体标记，保留纯文本
        clean = re.sub(r"\*\*|__|\*|_|`", "", line)
        if not clean or len(clean) < 15:
            continue
        # 跳过开场白：只要整句以 filler 开头，不管后面有什么
        if filler_patterns.search(clean):
            continue
        paragraphs.append(clean)

    text = " ".join(paragraphs[:2])
    if len(text) > max_chars:
        text = text[:max_chars] + "..."
    return text


@app.get("/api/stock/{code}/report-history")
def report_history(code: str, limit: int = 30):
    """查询个股历史 AI 分析报告，返回按日期倒序的摘要列表。

    关联逻辑：以 archives 中的报告日期为准（因为每次分析产生4份报告+1个决策卡），
    再尝试匹配同日期决策卡获取元数据。
    """
    decisions_dir = ROOT / "data" / "stock_decisions"
    history = []

    # 1. 遍历 archives，收集该 code 的所有报告日期
    report_dates = set()
    for p in ARCHIVE_DIR.glob(f"*_{code}_*.md"):
        parts = p.name.split("_")
        if len(parts) >= 3 and parts[1] == code:
            date_str = parts[0]
            if date_str.isdigit() and len(date_str) == 8:
                report_dates.add(date_str)

    # 2. 按日期倒序，逐个组装
    for date_str in sorted(report_dates, reverse=True)[:limit]:
        try:
            # 读取4份报告
            reports = {}
            for slug in ("bull", "bear", "preemption", "chair_debate"):
                report_path = ARCHIVE_DIR / f"{date_str}_{code}_{slug}.md"
                if report_path.exists():
                    md = report_path.read_text(encoding="utf-8")
                    reports[slug] = _extract_summary(md)
                else:
                    reports[slug] = ""

            # 尝试匹配同日期决策卡
            card_path = decisions_dir / f"{code}_{date_str}.json"
            decision = "unknown"
            conviction = 0
            price = None
            change_pct = None
            if card_path.exists():
                try:
                    card = json.loads(card_path.read_text(encoding="utf-8"))
                    decision = card.get("decision", "unknown")
                    conviction = card.get("conviction", 0)
                    price = card.get("price")
                    change_pct = card.get("change_pct")
                except Exception:
                    pass

            history.append({
                "date": f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}",
                "decision": decision,
                "conviction": conviction,
                "price": price,
                "change_pct": change_pct,
                "reports": reports,
            })
        except Exception as e:
            logger.warning(f"[report-history] 解析失败 {date_str}_{code}: {e}")
            continue

    return {
        "code": code,
        "count": len(history),
        "history": history,
    }


@app.get("/api/signals/latest")
def latest_signals():
    """最新异常信号"""
    data_dir = ROOT / "data"
    signals_files = sorted(data_dir.glob("signals_*.json"), key=lambda p: p.name, reverse=True)
    if signals_files:
        try:
            data = json.loads(signals_files[0].read_text(encoding="utf-8"))
            return {
                "date": data.get("date"),
                "signals": data.get("signals", []),
                "count": len(data.get("signals", [])),
            }
        except Exception as e:
            return {"date": None, "signals": [], "count": 0, "error": str(e)}
    return {"date": None, "signals": [], "count": 0}


@app.get("/api/memory/active")
def active_memory():
    """活跃观点（衰减后 >30%）"""
    try:
        from core.decaying_memory import DecayingMemoryStore
        dm = DecayingMemoryStore("data/memory.db")
        dm.decay_all()
        claims = dm.search_active(keyword="", limit=10)
        return {
            "claims": [
                {
                    "claim_id": c.get("claim_id"),
                    "type": c.get("type"),
                    "content": c.get("content"),
                    "confidence": c.get("current_confidence"),
                    "age_days": c.get("age_days"),
                }
                for c in claims
            ],
            "count": len(claims),
        }
    except Exception as e:
        return {"claims": [], "count": 0, "error": str(e)}


@app.get("/api/roles")
def list_roles():
    """列出所有加载的角色"""
    inst = _get_institute()
    return {
        "roles": [
            {
                "slug": r.slug,
                "name": r.name,
                "schedule": r.schedule,
                "dependencies": r.dependencies,
                "model": r.model,
            }
            for r in inst.roles.values()
        ]
    }


import requests as _requests


@app.get("/api/search/stock")
def search_stock(q: str = ""):
    """代理东方财富搜索接口，解决浏览器 CORS 限制。"""
    if not q or not q.strip():
        return {"code": None, "name": None, "error": "empty query"}
    try:
        url = f"https://searchapi.eastmoney.com/api/suggest/get"
        params = {"input": q.strip(), "type": 14, "count": 5}
        r = _requests.get(url, params=params, timeout=5)
        r.raise_for_status()
        data = r.json()
        items = data.get("QuotationCodeTable", {}).get("Data", [])
        if not items:
            return {"code": None, "name": None, "error": "not found"}
        first = items[0]
        return {
            "code": first.get("Code"),
            "name": first.get("Name"),
            "market": first.get("SecurityTypeName"),
        }
    except Exception as e:
        logger.warning(f"[search] 失败: {e}")
        return {"code": None, "name": None, "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
