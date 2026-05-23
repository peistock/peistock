#!/usr/bin/env python3
"""
api_server.py — RROS HTTP API（供 peistock 前端调用）

运行: uvicorn api_server:app --port 8000
"""
import os
import re
import json
import logging
import threading
import uuid
from pathlib import Path
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent

ARCHIVE_DIR = ROOT / "data" / "archives"
ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

from dotenv import load_dotenv
# LLM 配置来源：项目根目录 .env
load_dotenv(ROOT / ".env", override=True)

from fastapi import FastAPI, Header, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from core.chair_scorer import ChairScorer

app = FastAPI(title="RROS API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ── Account auth ─────────────────────────────────────────────────────────────
_ACCOUNTS: Dict[str, str] = {}
_ACCOUNTS_FILE = ROOT / "config" / "accounts.json"

def _load_accounts():
    global _ACCOUNTS
    if _ACCOUNTS_FILE.exists():
        try:
            _ACCOUNTS = json.loads(_ACCOUNTS_FILE.read_text(encoding="utf-8"))
        except Exception:
            _ACCOUNTS = {}
    else:
        _ACCOUNTS = {}

_load_accounts()


def require_account(
    x_account: str = Header("", alias="X-Account"),
    x_password: str = Header("", alias="X-Password"),
) -> str:
    """验证账号密码，返回账号名。AI 分析接口不需要，仅 watchlist 等个人数据使用。"""
    if not x_account or not x_password:
        raise HTTPException(status_code=401, detail="Missing X-Account or X-Password header")
    expected = _ACCOUNTS.get(x_account)
    if expected is None or expected != x_password:
        raise HTTPException(status_code=401, detail="Invalid account or password")
    return x_account

_institute = None
_institute_lock = threading.Lock()

def _get_institute():
    global _institute
    if _institute is None:
        with _institute_lock:
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
# 内部并行复用的线程池（避免每次任务都创建销毁）
_inner_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="inner-")


class _LLMProxy:
    """代理 LLMClient，临时覆盖 reasoning_effort，不影响全局单例。"""
    __slots__ = ("_llm", "reasoning_effort")

    def __init__(self, llm, reasoning_effort):
        object.__setattr__(self, "_llm", llm)
        object.__setattr__(self, "reasoning_effort", reasoning_effort)

    def __getattr__(self, name):
        return getattr(self._llm, name)

    def __setattr__(self, name, value):
        if name in ("_llm", "reasoning_effort"):
            object.__setattr__(self, name, value)
        else:
            setattr(self._llm, name, value)

    def chat_messages(self, messages, model=None, max_tokens=4096, temperature=0.7):
        """代理 chat_messages，传入自己的 reasoning_effort 覆盖值。"""
        return self._llm.chat_messages(
            messages=messages,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            reasoning_effort=self.reasoning_effort,
        )

    def chat(self, system, user_prompt, model=None, max_tokens=1500, temperature=0.7, json_mode=False):
        """代理 chat，传入自己的 reasoning_effort 覆盖值。"""
        return self._llm.chat(
            system=system,
            user_prompt=user_prompt,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            json_mode=json_mode,
            reasoning_effort=self.reasoning_effort,
        )


def _try_parse_analyst_json(path: Path) -> Optional[Dict]:
    """尝试从分析师报告文件中提取 JSON 对象。
    兼容纯 JSON 输出和 JSON+Markdown 混合输出（JSON 在前）。
    """
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    # 尝试直接解析
    if text.startswith('{'):
        try:
            return json.loads(text)
        except Exception:
            pass
    # 尝试提取第一个 JSON 对象（混合输出时 JSON 通常在开头）
    m = re.search(r'\{[\s\S]*?"signal"[\s\S]*?\}', text)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return None


def _generate_stock_decision_card(code: str, date_str: str, chair_content: str):
    """从 Chair 报告中提取结构化决策卡，写入 data/stock_decisions/。
    兼容 JSON 输出（新）和 Markdown（旧缓存）。
    """
    import re

    def _re_search(pattern, text, flags=re.IGNORECASE | re.DOTALL):
        m = re.search(pattern, text, flags)
        return m.group(1).strip() if m else None

    # ── 1. 尝试 JSON 解析 ─────────────────────────────
    parsed_json = None
    content = chair_content.strip()
    if content.startswith('{'):
        try:
            parsed_json = json.loads(content)
        except Exception:
            pass

    if parsed_json:
        raw_decision = parsed_json.get("decision") or parsed_json.get("signal", "")
        decision = str(raw_decision).upper() if raw_decision else None
        if decision not in ("LONG", "SHORT", "NEUTRAL"):
            decision = None
        conviction = parsed_json.get("confidence") or parsed_json.get("conviction")
        try:
            conviction = int(conviction) if conviction is not None else 0
        except Exception:
            conviction = 0
        thesis = str(parsed_json.get("thesis", "")).replace("\n", " ").strip()[:300]
        catalyst = parsed_json.get("catalyst", "")
        kill_switch = parsed_json.get("kill_switch", "")
        max_loss = parsed_json.get("max_loss", "")
        hold_period = parsed_json.get("holding_period", "")
    else:
        # ── Markdown 正则提取（兼容旧缓存）──────────────
        decision = _re_search(r"###\s*决策\s*（Decision）\s*\n\s*([A-Z]+)", chair_content)
        if decision and decision not in ("LONG", "SHORT", "NEUTRAL"):
            decision = None
        if not decision:
            m = re.search(r"\b(LONG|SHORT|NEUTRAL)\b", chair_content, re.IGNORECASE)
            if m:
                decision = m.group(1).upper()

        conviction_str = _re_search(r"###\s*信心度\s*（Conviction）\s*\n\s*(\d+)", chair_content)
        conviction = int(conviction_str) if conviction_str else 0
        if not conviction:
            m = re.search(r"(?:信心度|conviction).*?(\d{1,3})\s*%", chair_content, re.IGNORECASE)
            if m:
                conviction = int(m.group(1))
            else:
                m = re.search(r"\b(\d{1,3})\s*%\s*(?:信心|conviction)", chair_content, re.IGNORECASE)
                if m:
                    conviction = int(m.group(1))

        thesis = _re_search(r"###\s*核心论点\s*（Thesis）\s*\n\s*(.+?)(?=\n###|\n##\s|$)", chair_content)
        if thesis:
            thesis = thesis.replace("\n", " ").strip()[:300]

        catalyst = _re_search(
            r"###\s*催化剂\s*/\s*触发条件\s*（Catalyst\s*/\s*Trigger）\s*\n\s*(.+?)(?=\n###|\n##\s|$)",
            chair_content,
        )
        kill_switch = _re_search(
            r"###\s*止损位\s*（Kill\s*Switch）\s*\n\s*(.+?)(?=\n###|\n##\s|$)", chair_content
        )
        max_loss = _re_search(
            r"###\s*最大损失\s*（Max\s*Loss）\s*\n\s*(.+?)(?=\n###|\n##\s|$)", chair_content
        )
        hold_period = _re_search(
            r"###\s*持有期建议\s*\n\s*(.+?)(?=\n###|\n##\s|$)", chair_content
        )

    # ── 2. 提取五维度原始评分（Raw Scores 区块）───────────
    def _extract_raw_score(text: str, label: str) -> Optional[float]:
        # JSON 模式下优先从 dict 取
        if parsed_json:
            key_map = {
                "Bull 置信度": "bull_confidence",
                "Bear 置信度": "bear_confidence",
                "Preemption 评分": "preemption_score",
                "MacroIndustry 综合评分": "macro_industry_score",
            }
            key = key_map.get(label)
            if key and key in parsed_json:
                try:
                    return float(parsed_json[key])
                except Exception:
                    pass
        m = re.search(
            rf"-\s*{re.escape(label)}\s*[:：]\s*([+-]?\d+\.?\d*)",
            text, re.IGNORECASE
        )
        return float(m.group(1)) if m else None

    def _extract_sentiment(text: str) -> str:
        if parsed_json:
            sr = parsed_json.get("sentiment_rating")
            if sr:
                return str(sr).strip()
        m = re.search(
            r"-\s*Sentiment\s*情绪评级\s*[:：]\s*([^\n]+)",
            text, re.IGNORECASE
        )
        if m:
            return m.group(1).strip()
        m = re.search(
            r"情绪评级[是为]\s*[:：]?\s*(极度贪婪|贪婪|中性|恐慌|极度恐慌)",
            text
        )
        return m.group(1) if m else "中性"

    bull_conf = _extract_raw_score(chair_content, "Bull 置信度")
    bear_conf = _extract_raw_score(chair_content, "Bear 置信度")
    preemption = _extract_raw_score(chair_content, "Preemption 评分")
    macro_score = _extract_raw_score(chair_content, "MacroIndustry 综合评分")
    sentiment_rating = _extract_sentiment(chair_content)

    # ── 3. ChairScorer 加权计算 ─────────────────────────
    scorer = ChairScorer()
    scored = scorer.calculate(
        bull_conf=bull_conf or 50.0,
        preemption=preemption or 50.0,
        bear_conf=bear_conf or 50.0,
        macro_score=macro_score or 0.0,
        sentiment_rating=sentiment_rating,
    )

    # 优先信任 Chair 原始报告中的决策和信心度（A 方案）
    final_decision = decision.upper() if decision else scored["decision"].upper()
    final_conviction = conviction if conviction else round(scored["conviction"], 1)

    card = {
        "code": code,
        "date": date_str,
        "decision": final_decision,
        "conviction": final_conviction,
        "weighted_score": round(scored["weighted_score"], 2),
        "thesis": thesis or "",
        "catalyst": catalyst or "",
        "kill_switch": kill_switch or "",
        "risk_if_wrong": max_loss or "",
        "holding_period": hold_period or "",
        "timestamp": datetime.now().isoformat(),
        "bull_confidence": bull_conf,
        "bear_confidence": bear_conf,
        "preemption_score": preemption,
        "macro_industry_score": macro_score,
        "sentiment_rating": sentiment_rating,
    }

    out_dir = ROOT / "data" / "stock_decisions"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{code}_{date_str}.json"
    out_path.write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_path


def _run_analysis_task(task_id: str, code: str, signal: str, date_str: str):
    """后台执行分析链，结果写入 _jobs。"""
    inst = _get_institute()
    try:
        # Phase 0: 预取所有数据（只取一次，供所有角色共享，避免重复调用 akshare）
        market = "a" if len(code) == 6 and code.isdigit() else "hk"

        # 0a. 研报客观数据
        research_data = ""
        research_data_available = False
        try:
            from core.research_report import get_research_report_data, summarize_for_prompt
            rr_raw = get_research_report_data(code, market=market, limit=2, llm=inst.llm)
            if rr_raw:
                research_data = summarize_for_prompt(rr_raw, max_total_chars=2000)
                research_data_available = True
                logger.info(f"[{code}] 研报数据已获取: {len(research_data)} 字符")
        except Exception as e:
            logger.warning(f"[{code}] 研报获取失败: {e}")

        # 0b. 季度财报数据
        financial_data = ""
        try:
            from core.financial_data import get_quarterly_financial_for_prompt
            financial_data = get_quarterly_financial_for_prompt(code, market=market)
            logger.info(f"[{code}] 财报数据已预取: {len(financial_data)} 字符")
        except Exception as e:
            logger.warning(f"[{code}] 财报预取失败: {e}")

        # 0c. 预期基准数据（业绩预告/历史增速）
        expectation_data = ""
        try:
            from core.financial_data import get_expectation_for_stock
            expectation_data = get_expectation_for_stock(code, market=market)
            logger.info(f"[{code}] 预期基准已预取: {len(expectation_data)} 字符")
        except Exception as e:
            logger.warning(f"[{code}] 预期基准预取失败: {e}")

        # 0d. 板块相对强弱背景（A 股）
        sector_context = ""
        if market == "a":
            try:
                from core.sector_context import get_sector_context
                sector_context = get_sector_context(code)
                if sector_context:
                    logger.info(f"[{code}] 板块背景已预取: {sector_context}")
            except Exception as e:
                logger.warning(f"[{code}] 板块背景预取失败: {e}")

        # 0e. 贵金属/有色金属宏观关联视角
        metal_context = ""
        try:
            from core.metal_context import get_metal_context
            metal_context = get_metal_context(code, "", stock_change_20d=0)
            if metal_context:
                logger.info(f"[{code}] 贵金属宏观视角已预取")
        except Exception as e:
            logger.warning(f"[{code}] 贵金属宏观视角预取失败: {e}")

        # 0f. 宏观-行业联动分析
        macro_industry_context = ""
        try:
            from core.macro_industry_analyst import generate_macro_industry_report
            macro_industry_context = generate_macro_industry_report(code)
            logger.info(f"[{code}] 宏观-行业联动报告已预取 ({len(macro_industry_context)} 字符)")
        except Exception as e:
            logger.warning(f"[{code}] 宏观-行业联动预取失败: {e}")

        ctx = {
            "code": code,
            "signal": signal,
            "market": market,
            "research_report_data": research_data,
            "research_data_available": research_data_available,
            "financial_data": financial_data,
            "expectation_data": expectation_data,
            "sector_context": sector_context,
            "metal_context": metal_context,
            "macro_industry_context": macro_industry_context,
        }

        with _jobs_lock:
            _jobs[task_id]["status"] = "running"
            _jobs[task_id]["progress"] = "Bull/Bear/宏观行业 并行分析中..."

        # Phase 1: Bull / Bear / macro_industry 并行（reasoning_effort=None，按角色模型选择）
        llm_bull = _LLMProxy(inst._get_llm_for_role(inst.roles["bull"]), None)
        llm_bear = _LLMProxy(inst._get_llm_for_role(inst.roles["bear"]), None)
        llm_mi = _LLMProxy(inst._get_llm_for_role(inst.roles.get("macro_industry", inst.roles["bull"])), None)
        try:
            futures = {
                _inner_pool.submit(inst.run_analyst, "bull", date_str, context=ctx, llm=llm_bull): "bull",
                _inner_pool.submit(inst.run_analyst, "bear", date_str, context=ctx, llm=llm_bear): "bear",
            }
            # macro_industry 角色存在才加入并行
            if "macro_industry" in inst.roles:
                futures[_inner_pool.submit(inst.run_analyst, "macro_industry", date_str, context=ctx, llm=llm_mi)] = "macro_industry"
            for fut in as_completed(futures):
                role = futures[fut]
                try:
                    fut.result(timeout=300)
                    logger.info(f"[{code}] {role} 分析完成")
                except Exception as e:
                    logger.error(f"[{code}] {role} 分析失败: {e}")
        except Exception as e:
            logger.error(f"[{code}] Phase 1 异常: {e}")

        # Phase 1.5: Bull/Bear 对抗辩论（可选）
        try:
            import yaml
            rebel_cfg = yaml.safe_load((ROOT / "config" / "rebel.yaml").read_text(encoding="utf-8"))
            debate_cfg = rebel_cfg.get("debate", {})
        except Exception:
            debate_cfg = {"enabled": True, "max_rounds": 1}

        if debate_cfg.get("enabled", True):
            with _jobs_lock:
                _jobs[task_id]["progress"] = "Bull/Bear 对抗辩论中..."

            bull_path = ARCHIVE_DIR / f"{date_str}_{code}_bull.md"
            bear_rebuttal_path = ARCHIVE_DIR / f"{date_str}_{code}_bear_rebuttal.md"
            bull_response_path = ARCHIVE_DIR / f"{date_str}_{code}_bull_response.md"

            # 1. Bear 反驳 Bull
            if bull_path.exists() and not bear_rebuttal_path.exists():
                try:
                    ctx["bull_report"] = bull_path.read_text(encoding="utf-8")
                    llm_bear_rebuttal = _LLMProxy(inst._get_llm_for_role(inst.roles["bear_rebuttal"]), None)
                    inst.run_analyst("bear_rebuttal", date_str, context=ctx, llm=llm_bear_rebuttal)
                    logger.info(f"[{code}] Bear rebuttal 完成")
                except Exception as e:
                    logger.error(f"[{code}] Bear rebuttal 失败: {e}")

            # 2. Bull 回应 Bear（带重试：内容过短时自动重试最多 2 次）
            def _is_valid_report(path: Path) -> bool:
                if not path.exists():
                    return False
                text = path.read_text(encoding="utf-8")
                return len(text.strip()) > 500 and "报告生成失败" not in text

            if bear_rebuttal_path.exists() and not _is_valid_report(bull_response_path):
                for attempt in range(1, 3):
                    try:
                        ctx["bear_rebuttal_report"] = bear_rebuttal_path.read_text(encoding="utf-8")
                        llm_bull_response = _LLMProxy(inst._get_llm_for_role(inst.roles["bull_response"]), None)
                        inst.run_analyst("bull_response", date_str, context=ctx, llm=llm_bull_response)
                        if _is_valid_report(bull_response_path):
                            logger.info(f"[{code}] Bull response 完成（尝试 {attempt}）")
                            break
                        else:
                            logger.warning(f"[{code}] Bull response 内容过短，尝试 {attempt}/2")
                            if attempt < 2:
                                bull_response_path.unlink(missing_ok=True)
                    except Exception as e:
                        logger.error(f"[{code}] Bull response 失败（尝试 {attempt}）: {e}")

            # 3. 生成辩论摘要
            if bull_path.exists() and bear_rebuttal_path.exists() and bull_response_path.exists():
                try:
                    bull_content = bull_path.read_text(encoding="utf-8")
                    bear_rebuttal_content = bear_rebuttal_path.read_text(encoding="utf-8")
                    bull_response_content = bull_response_path.read_text(encoding="utf-8")

                    summary_prompt = (
                        "请阅读以下 Bull/Bear 对抗辩论的三份材料，输出一份不超过 300 字的交锋摘要。\n\n"
                        "【Bull 初稿核心论点】\n"
                        f"{bull_content[:2000]}\n\n"
                        "【Bear 反驳】\n"
                        f"{bear_rebuttal_content[:2000]}\n\n"
                        "【Bull 回应】\n"
                        f"{bull_response_content[:2000]}\n\n"
                        "摘要格式要求：\n"
                        "1. Bear 有效反驳了哪些 Bull 论点\n"
                        "2. Bull 哪些核心论据未被反驳\n"
                        "3. Bull 哪些质疑未能回应\n"
                        "4. 综合判断（不直接给出决策方向，仅作为补充信息）\n"
                        "\n请用中文输出，不超过 300 字，不要加任何开场白。"
                    )
                    # 辩论摘要用 deepseek-v4-flash（默认模型）
                    summary = inst.llm.chat(
                        system="你是辩论摘要生成器。你只做一件事：客观总结交锋双方的观点和反驳，不做投资决策。",
                        user_prompt=summary_prompt,
                        model="deepseek-v4-flash",
                        max_tokens=800,
                        temperature=0.3,
                    )
                    if summary:
                        ctx["debate_summary"] = summary.strip()
                        logger.info(f"[{code}] 辩论摘要生成完成 ({len(summary)} 字符)")
                except Exception as e:
                    logger.error(f"[{code}] 辩论摘要生成失败: {e}")

        with _jobs_lock:
            _jobs[task_id]["progress"] = "Preemption / Sentiment 并行分析中..."

        # Phase 2: Preemption + Sentiment 并行（reasoning_effort=high，按角色模型选择）
        llm_preemption = _LLMProxy(inst._get_llm_for_role(inst.roles["preemption"]), "high")
        llm_sentiment = _LLMProxy(inst._get_llm_for_role(inst.roles["sentiment"]), "high")
        try:
            futures = {
                _inner_pool.submit(inst.run_analyst, "preemption", date_str, context=ctx, llm=llm_preemption): "preemption",
                _inner_pool.submit(inst.run_analyst, "sentiment", date_str, context=ctx, llm=llm_sentiment): "sentiment",
            }
            for fut in as_completed(futures):
                role = futures[fut]
                try:
                    fut.result(timeout=300)
                    logger.info(f"[{code}] {role} 分析完成")
                except Exception as e:
                    logger.error(f"[{code}] {role} 分析失败: {e}")
        except Exception as e:
            logger.error(f"[{code}] Phase 2 异常: {e}")

        # Phase 2 后：Preemption 重试（API 偶发返回空/短内容）
        def _is_valid_preemption(path: Path) -> bool:
            if not path.exists():
                return False
            text = path.read_text(encoding="utf-8")
            return len(text.strip()) > 500 and "报告生成失败" not in text

        prep_path = ARCHIVE_DIR / f"{date_str}_{code}_preemption.md"
        for attempt in range(1, 3):
            if not _is_valid_preemption(prep_path):
                logger.warning(f"[{code}] Preemption 内容过短或失败，尝试重试 {attempt}/2")
                try:
                    if prep_path.exists():
                        prep_path.unlink(missing_ok=True)
                    inst.run_analyst("preemption", date_str, context=ctx, llm=llm_preemption)
                    if _is_valid_preemption(prep_path):
                        logger.info(f"[{code}] Preemption 重试成功（尝试 {attempt}）")
                        break
                except Exception as e:
                    logger.error(f"[{code}] Preemption 重试 {attempt} 失败: {e}")
            else:
                break

        # Phase 2.5: Risk Manager 规则风控（零 LLM）
        try:
            import yaml as _yaml
            rebel_cfg = _yaml.safe_load((ROOT / "config" / "rebel.yaml").read_text(encoding="utf-8"))
            risk_cfg = rebel_cfg.get("risk_manager", {})
        except Exception:
            risk_cfg = {"enabled": True, "volatility_threshold": 0.04, "high_threshold": 70, "medium_threshold": 40}

        if risk_cfg.get("enabled", True):
            with _jobs_lock:
                _jobs[task_id]["progress"] = "Risk Manager 风控评估中..."

            def _extract_score_from_report(path: Path, patterns: list, json_field: str = None) -> int:
                """从报告中提取整数分数。优先解析 JSON 字段，失败则回退到正则。"""
                if not path.exists():
                    return 50
                # 优先尝试 JSON 解析（Bull/Bear 强制 JSON 输出）
                if json_field:
                    parsed = _try_parse_analyst_json(path)
                    if parsed and json_field in parsed:
                        try:
                            return int(parsed[json_field])
                        except Exception:
                            pass
                text = path.read_text(encoding="utf-8")
                for pat in patterns:
                    m = re.search(pat, text, re.IGNORECASE)
                    if m:
                        try:
                            return int(m.group(1))
                        except Exception:
                            pass
                return 50

            bull_path = ARCHIVE_DIR / f"{date_str}_{code}_bull.md"
            bear_path = ARCHIVE_DIR / f"{date_str}_{code}_bear.md"
            prep_path = ARCHIVE_DIR / f"{date_str}_{code}_preemption.md"
            sent_path = ARCHIVE_DIR / f"{date_str}_{code}_sentiment.md"

            # Bull/Bear 优先解析 JSON confidence 字段；回退到正则（兼容口语化表达）
            bull_conf = _extract_score_from_report(bull_path, [
                r"置信度.*?(?:[:：]\s*|[给为是]\s*)(\d+)",
                r"confidence.*?(?:[:：]\s*|[给为是]\s*)(\d+)",
                r"(?:[:：]\s*|[给为是]\s*)(\d+)\s*分",
            ], json_field="confidence")
            bear_conf = _extract_score_from_report(bear_path, [
                r"置信度.*?(?:[:：]\s*|[给为是]\s*)(\d+)",
                r"confidence.*?(?:[:：]\s*|[给为是]\s*)(\d+)",
                r"(?:[:：]\s*|[给为是]\s*)(\d+)\s*分",
            ], json_field="confidence")
            # Preemption：兼容 "入场时机评分：40" 或 "评分 40 分" 等口语化表达
            entry_score = _extract_score_from_report(prep_path, [
                r"入场时机评分.*?(?:[:：]\s*|[给为是]\s*)(\d+)",
                r"entry timing.*?(?:[:：]\s*|[给为是]\s*)(\d+)",
                r"(?:评分|score).*?(?:[:：]\s*|[给为是]\s*)(\d+)",
            ])
            # Sentiment：优先匹配明确的量化分数，回退到贪婪指数分位值
            sentiment_score = _extract_score_from_report(sent_path, [
                r"(?:情绪量化分数|情绪评分|sentiment_score).*?(?:[:：]\s*|[给为是]\s*)(\d+)",
                r"贪婪指数.*?([\d.]+)\s*%?分位",
                r"贪婪指数.*?(?:[:：]\s*|[给为是]\s*)(\d+)",
            ])

            # 计算 20 日历史波动率
            hist_vol = 0.0
            try:
                from core.data_layer import DataLayer
                from core.risk_manager import calc_hist_volatility
                dl = DataLayer()
                hist_df = dl.get_stock_history(code, days=30)
                if hist_df is not None and len(hist_df) >= 21:
                    closes = hist_df["close"].tolist()
                    hist_vol = calc_hist_volatility(closes)
                    logger.info(f"[{code}] 20日历史波动率: {hist_vol:.4f}")
            except Exception as e:
                logger.warning(f"[{code}] 波动率计算失败: {e}")

            try:
                from core.risk_manager import assess_risk
                risk_result = assess_risk(
                    bull_signal={"confidence": bull_conf, "signal": "BULLISH"},
                    bear_signal={"confidence": bear_conf, "signal": "BEARISH"},
                    preemption_signal={"entry_timing_score": entry_score},
                    sentiment_signal={"sentiment_score": sentiment_score},
                    hist_volatility=hist_vol,
                    config=risk_cfg,
                )
                ctx["risk_assessment"] = risk_result
                logger.info(
                    f"[{code}] Risk Manager: level={risk_result['risk_level']}, "
                    f"score={risk_result['total_score']}, limit={risk_result['position_limit']}"
                )
            except Exception as e:
                logger.warning(f"[{code}] Risk Manager 评估失败: {e}")

        with _jobs_lock:
            _jobs[task_id]["progress"] = "Chair 投委会裁决中..."

        # Phase 3: Chair（reasoning_effort=high，按角色模型选择）
        llm_chair = _LLMProxy(inst._get_llm_for_role(inst.roles["chair_debate"]), "high")
        try:
            path = inst.run_analyst("chair_debate", date_str, context=ctx, llm=llm_chair)
        except Exception as e:
            logger.error(f"[{code}] Chair 分析失败: {e}")
            path = None

        if path and path.exists():
            content = path.read_text(encoding="utf-8")

            # 解析所有角色的 JSON 输出并保存到 AgentState
            agent_state = None
            try:
                from core.agent_state import AgentState, AnalystSignal
                agent_state = AgentState(code, date_str)

                # Chair
                if content.strip().startswith('{'):
                    try:
                        parsed = json.loads(content)
                        agent_state.set_report(
                            "chair_debate",
                            AnalystSignal(
                                signal=parsed.get("decision", parsed.get("signal", "NEUTRAL")),
                                confidence=parsed.get("confidence", 0) or parsed.get("conviction", 0),
                                reasoning=parsed.get("reasoning", ""),
                                key_metrics=parsed.get("key_metrics", {}),
                                thesis=parsed.get("thesis", ""),
                                kill_switch=parsed.get("kill_switch"),
                                max_loss=parsed.get("max_loss"),
                            ),
                        )
                    except Exception as e:
                        logger.warning(f"[{code}] AgentState chair 解析失败: {e}")

                # Bull / Bear / Preemption / Sentiment（从已生成的报告文件解析）
                for slug in ("bull", "bear", "preemption", "sentiment"):
                    report_path = ARCHIVE_DIR / f"{date_str}_{code}_{slug}.md"
                    parsed = _try_parse_analyst_json(report_path)
                    if parsed:
                        try:
                            agent_state.set_report(
                                slug,
                                AnalystSignal(
                                    signal=parsed.get("signal", "NEUTRAL"),
                                    confidence=parsed.get("confidence", 0),
                                    reasoning=parsed.get("reasoning", ""),
                                    key_metrics=parsed.get("key_metrics", {}),
                                    thesis=parsed.get("thesis", ""),
                                    kill_switch=parsed.get("kill_switch"),
                                    max_loss=parsed.get("max_loss"),
                                ),
                            )
                        except Exception as e:
                            logger.warning(f"[{code}] AgentState {slug} 解析失败: {e}")

                agent_state.save()
                logger.info(f"[{code}] AgentState 已持久化 ({len(agent_state._reports)} 个角色)")
            except Exception as e:
                logger.warning(f"[{code}] AgentState 初始化失败: {e}")

            # 生成决策卡 JSON（供历史接口和 recent_decisions 使用）
            card = {}
            try:
                card_path = _generate_stock_decision_card(code, date_str, content)
                if card_path and card_path.exists():
                    card = json.loads(card_path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"[{code}] 决策卡生成失败: {e}")

            # 运行断言评测（旁路，不阻断决策）
            try:
                from core.evals.runner import evaluate_current_decision
                eval_pass, eval_detail = evaluate_current_decision(
                    card,
                    preemption_score=card.get("preemption_score"),
                    sentiment_rating=card.get("sentiment_rating"),
                )
                logger.info(
                    f"[{code}] Evals: pass_rate={eval_detail['pass_rate']:.0%}, "
                    f"overall={'PASS' if eval_pass else 'FAIL'}, "
                    f"assertions={ {k:v['passed'] for k,v in eval_detail['assertions'].items()} }"
                )
            except Exception as e:
                logger.warning(f"[{code}] Evals 运行失败: {e}")

            with _jobs_lock:
                _jobs[task_id].update({
                    "status": "completed",
                    "result": {
                        "code": code,
                        "date": date_str,
                        "status": "completed",
                        "report_path": str(path),
                        "report_preview": content[:8000],
                        "conviction": card.get("conviction", 0),
                        "decision": card.get("decision", "unknown"),
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
        logger.error(f"[{code}] 分析任务异常: {e}", exc_info=True)
        with _jobs_lock:
            _jobs[task_id].update({
                "status": "error",
                "detail": str(e),
                "progress": f"异常: {str(e)[:100]}",
            })


def _find_recent_cache(code: str, days: int = 3) -> Optional[Tuple[str, Path]]:
    """查找最近 N 天内是否有完整的分析报告缓存。
    返回 (date_str, chair_debate_path) 或 None。
    """
    # 动态检查 debate 配置，确保旧缓存（无 debate）不会被误认为完整
    try:
        import yaml
        rebel_cfg = yaml.safe_load((ROOT / "config" / "rebel.yaml").read_text(encoding="utf-8"))
        debate_enabled = rebel_cfg.get("debate", {}).get("enabled", True)
    except Exception:
        debate_enabled = True

    if debate_enabled:
        _slugs = ("bull", "bear", "bear_rebuttal", "bull_response", "preemption", "sentiment", "chair_debate")
    else:
        _slugs = ("bull", "bear", "preemption", "sentiment", "chair_debate")

    today = datetime.now()
    for i in range(days):
        check_date = (today - timedelta(days=i)).strftime("%Y%m%d")
        if all((ARCHIVE_DIR / f"{check_date}_{code}_{s}.md").exists() for s in _slugs):
            chair_path = ARCHIVE_DIR / f"{check_date}_{code}_chair_debate.md"
            if chair_path.exists():
                return check_date, chair_path
    return None


def _cleanup_old_jobs():
    """清理 1 小时前已完成的旧任务，防止 _jobs 无限增长。"""
    cutoff = datetime.now().timestamp() - 3600
    with _jobs_lock:
        expired = [
            tid for tid, job in _jobs.items()
            if job.get("status") in ("completed", "error")
            and datetime.fromisoformat(job.get("created_at", "2000-01-01T00:00:00")).timestamp() < cutoff
        ]
        for tid in expired:
            del _jobs[tid]
        if expired:
            logger.info(f"已清理 {len(expired)} 个过期任务")


@app.post("/api/analyze/stock/{code}")
def analyze_stock(code: str, signal: str = "B"):
    """提交分析任务，立即返回 task_id。分析在后台异步执行。"""
    # 股票代码预校验
    if not (code.isdigit() and (len(code) == 6 or len(code) == 5)):
        return {"status": "error", "detail": f"无效股票代码: {code}，应为 6 位 A 股或 5 位港股"}

    _cleanup_old_jobs()
    date_str = datetime.now().strftime("%Y%m%d")

    # 检查最近 3 天内是否已有完整报告（冷却期，避免频繁重复分析）
    _cache_info = _find_recent_cache(code, days=3)
    if _cache_info:
        cache_date_str, cache_path = _cache_info
        content = cache_path.read_text(encoding="utf-8")

        # 优先尝试 AgentState 结构化缓存
        card = {}
        try:
            from core.agent_state import AgentState
            agent_state = AgentState.load(code, cache_date_str)
            if agent_state:
                chair_report = agent_state.get_report("chair_debate")
                if chair_report:
                    card = {
                        "decision": chair_report.signal,
                        "conviction": chair_report.confidence,
                        "thesis": chair_report.thesis,
                    }
        except Exception:
            pass

        if not card:
            card_path = ROOT / "data" / "stock_decisions" / f"{code}_{cache_date_str}.json"
            if card_path.exists():
                try:
                    card = json.loads(card_path.read_text(encoding="utf-8"))
                except Exception:
                    pass

        task_id = f"cached_{code}_{cache_date_str}"
        with _jobs_lock:
            _jobs[task_id] = {
                "code": code,
                "signal": signal,
                "status": "completed",
                "progress": f"{cache_date_str} 已分析，3 日内直接展示缓存",
                "created_at": datetime.now().isoformat(),
                "result": {
                    "code": code,
                    "date": cache_date_str,
                    "status": "completed",
                    "report_path": str(cache_path),
                    "report_preview": content[:8000],
                    "conviction": card.get("conviction", 0),
                    "decision": card.get("decision", "unknown"),
                },
            }
        logger.info(f"[{code}] 3 日内缓存命中 ({cache_date_str})，直接返回: {task_id}")
        return {
            "task_id": task_id,
            "status": "completed",
            "progress": f"{cache_date_str} 已分析，3 日内直接展示缓存",
            "result": _jobs[task_id]["result"],
        }

    # 检查当天是否已有完整报告缓存（兜底）
    # 动态检查 debate 配置
    try:
        import yaml
        rebel_cfg = yaml.safe_load((ROOT / "config" / "rebel.yaml").read_text(encoding="utf-8"))
        debate_enabled = rebel_cfg.get("debate", {}).get("enabled", True)
    except Exception:
        debate_enabled = True
    if debate_enabled:
        _slugs = ("bull", "bear", "bear_rebuttal", "bull_response", "preemption", "sentiment", "chair_debate")
    else:
        _slugs = ("bull", "bear", "preemption", "sentiment", "chair_debate")
    _all_exist = all((ARCHIVE_DIR / f"{date_str}_{code}_{s}.md").exists() for s in _slugs)
    cache_path = ARCHIVE_DIR / f"{date_str}_{code}_chair_debate.md"
    if _all_exist and cache_path.exists():
        content = cache_path.read_text(encoding="utf-8")

        # 优先尝试 AgentState 结构化缓存
        card = {}
        try:
            from core.agent_state import AgentState
            agent_state = AgentState.load(code, date_str)
            if agent_state:
                chair_report = agent_state.get_report("chair_debate")
                if chair_report:
                    card = {
                        "decision": chair_report.signal,
                        "conviction": chair_report.confidence,
                        "thesis": chair_report.thesis,
                    }
        except Exception:
            pass

        if not card:
            card_path = ROOT / "data" / "stock_decisions" / f"{code}_{date_str}.json"
            if card_path.exists():
                try:
                    card = json.loads(card_path.read_text(encoding="utf-8"))
                except Exception:
                    pass

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
                    "conviction": card.get("conviction", 0),
                    "decision": card.get("decision", "unknown"),
                },
            }
        logger.info(f"[{code}] 当日缓存命中，直接返回: {task_id}")
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
    _cleanup_old_jobs()
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
    """从 Markdown 报告中提取核心观点摘要。优先提取 ## 核心论点/预判结论/核心裁决 等章节，
    其次提取 ## 预期差分析 / 三维度对比摘要，最后回退到前2段实质内容。
    兼容 JSON 输出（Bull/Bear）和 Markdown 输出（Preemption/Sentiment/Chair）。"""
    if not md_text:
        return ""

    # JSON 输出角色（Bull/Bear）：优先解析 JSON 字段
    if md_text.strip().startswith("{"):
        try:
            parsed = json.loads(md_text.strip())
            # 优先 thesis，其次 reasoning
            for key in ("thesis", "reasoning"):
                val = parsed.get(key, "")
                if val and len(val) > 10:
                    text = val.replace("\n", " ").strip()
                    if len(text) > max_chars:
                        text = text[:max_chars] + "..."
                    return text
        except Exception:
            pass
        # JSON 解析失败但仍是 JSON 格式：尝试正则提取
        m = re.search(r'"thesis"\s*:\s*"([^"]+)"', md_text)
        if m:
            return m.group(1)[:max_chars]
        m = re.search(r'"reasoning"\s*:\s*"([^"]+)"', md_text)
        if m:
            return m.group(1)[:max_chars]

    # 0. 最高优先：报告末尾显式生成的核心摘要（角色 prompt 已要求 LLM 输出）
    m = re.search(r"##\s*核心摘要.*?\n(.*?)(?=\n## |\n---|\Z)", md_text, re.DOTALL | re.IGNORECASE)
    if m:
        text = _clean_md_paragraphs(m.group(1), max_chars)
        if text:
            return text

    # 1. 优先：提取核心论点/论据/结论类章节
    core_sections = [
        r"##\s*核心论点.*?\n(.*?)(?=\n## |\n---|\Z)",
        r"##\s*核心论据.*?\n(.*?)(?=\n## |\n---|\Z)",
        r"##\s*预判结论.*?\n(.*?)(?=\n## |\n---|\Z)",
        r"##\s*核心裁决.*?\n(.*?)(?=\n## |\n---|\Z)",
    ]
    for pattern in core_sections:
        m = re.search(pattern, md_text, re.DOTALL | re.IGNORECASE)
        if m:
            text = _clean_md_paragraphs(m.group(1), max_chars)
            if text:
                return text

    # 2. 其次：Preemption 专用 — 预期差分析、信息消化评估
    preemption_sections = [
        r"##\s*预期差分析.*?\n(.*?)(?=\n## |\n---|\Z)",
        r"##\s*信息消化评估.*?\n(.*?)(?=\n## |\n---|\Z)",
    ]
    for pattern in preemption_sections:
        m = re.search(pattern, md_text, re.DOTALL | re.IGNORECASE)
        if m:
            text = _clean_md_paragraphs(m.group(1), max_chars)
            if text:
                return text

    # 3. Chair 专用 — 三维度对比摘要（取表格后的核心论据列）
    m = re.search(r"##\s*三维度对比摘要.*?\n(.*?)(?=\n## |\n---|\Z)", md_text, re.DOTALL | re.IGNORECASE)
    if m:
        # 提取表格中 "核心论据" 行的内容
        table_text = m.group(1)
        for line in table_text.split("\n"):
            if "核心论据" in line and "|" in line:
                parts = [p.strip() for p in line.split("|")]
                # 格式: 核心论据 | bull内容 | bear内容 | preemption内容
                if len(parts) >= 4:
                    pieces = [p for p in parts[1:] if p and not p.startswith("-")]
                    text = " | ".join(pieces)
                    if len(text) > max_chars:
                        text = text[:max_chars] + "..."
                    return text

    # 4. 回退：取前2段实质内容
    return _clean_md_paragraphs(md_text, max_chars)


def _clean_md_paragraphs(md_text: str, max_chars: int = 150) -> str:
    """清理 Markdown 标记，取前2段有效文字。"""
    filler_patterns = re.compile(
        r"^(现在我已|现在我已经|现在让我|让我开始|让我为您|让我来|以下为|基于当前|基于以上|基于前述|根据以上|根据已有|我将为您|我已经完成|我已完成|正在分析|开始分析|接下来我|综合以上信息|整理如下|构建完成|输出如下|生成报告|分析报告|结论如下|汇总如下|总结如下|标的：|日期：|收盘价：)",
        re.IGNORECASE,
    )

    paragraphs = []
    for line in md_text.split("\n"):
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("---") or line.startswith("|"):
            continue
        # 去掉 Markdown 粗体/斜体/代码标记
        clean = re.sub(r"\*\*|__|\*|_|`", "", line)
        if not clean or len(clean) < 15:
            continue
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
            # 读取5份报告（summary 用于表格，full 用于 Tooltip）
            reports = {}
            for slug in ("bull", "bear", "preemption", "sentiment", "chair_debate"):
                report_path = ARCHIVE_DIR / f"{date_str}_{code}_{slug}.md"
                if report_path.exists():
                    md = report_path.read_text(encoding="utf-8")
                    reports[slug] = {
                        "summary": _extract_summary(md),
                        "full": md,
                    }
                else:
                    reports[slug] = {"summary": "", "full": ""}

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


# ---------- 回测闭环 API ----------

@app.post("/api/backtest/validate")
def trigger_backtest_validation():
    """手动触发验证所有待处理的决策卡，计算实际盈亏。"""
    try:
        from core.backtest_tracker import validate_pending_decisions
        result = validate_pending_decisions()
        return {
            "status": "ok",
            "validated": result.get("validated", 0),
            "skipped": result.get("skipped", 0),
            "errors": result.get("errors", 0),
        }
    except Exception as e:
        logger.error(f"[backtest/validate] 失败: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/api/backtest/summary")
def backtest_summary():
    """全局回测统计：按置信度、Preemption 等条件分组。"""
    try:
        from core.backtest_tracker import get_condition_stats
        stats = get_condition_stats(min_samples=1)
        if not stats:
            return {"status": "ok", "message": "暂无足够验证数据", "stats": {}}
        return {"status": "ok", "stats": stats}
    except Exception as e:
        logger.error(f"[backtest/summary] 失败: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/api/backtest/stock/{code}")
def backtest_stock(code: str):
    """某股票的历史验证统计和最近交易记录。"""
    try:
        from core.backtest_tracker import get_stock_history_stats
        stats = get_stock_history_stats(code)
        if not stats:
            return {"status": "ok", "message": "该股票暂无验证数据", "code": code, "data": None}
        return {"status": "ok", "code": code, "data": stats}
    except Exception as e:
        logger.error(f"[backtest/stock/{code}] 失败: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/api/backtest/signals/{code}")
def backtest_signals(code: str):
    """信号级回测：逐日检测 B/S 信号，计算每个信号的持有期统计，以及当前条件最相似的历史日期回测。"""
    try:
        from core.signal_backtest import run_signal_backtest
        result = run_signal_backtest(code)
        if not result:
            return {"status": "ok", "message": "无回测数据", "code": code, "data": None}
        return {"status": "ok", "code": code, "data": result}
    except Exception as e:
        logger.error(f"[backtest/signals/{code}] 失败: {e}")
        return {"status": "error", "message": str(e)}


# ── Watchlist (per-account, cross-device sync) ──────────────────────────────

@app.get("/api/watchlist")
def get_watchlist_endpoint(account: str = Depends(require_account)):
    """获取当前账号的股票池和分类列表。"""
    try:
        from core.watchlist_store import get_watchlist
        return {"status": "ok", **get_watchlist(account)}
    except Exception as e:
        logger.error(f"[watchlist/get] 失败: {e}")
        return {"status": "error", "message": str(e)}


@app.post("/api/watchlist")
def set_watchlist_endpoint(
    payload: Dict[str, Any],
    account: str = Depends(require_account),
):
    """保存当前账号的股票池和分类列表。"""
    try:
        from core.watchlist_store import set_watchlist
        stocks = payload.get("stocks", [])
        categories = payload.get("categories", [])
        set_watchlist(account, stocks, categories)
        return {"status": "ok", "saved": True}
    except Exception as e:
        logger.error(f"[watchlist/set] 失败: {e}")
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
