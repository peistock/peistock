#!/usr/bin/env python3
"""
main.py
RebelResearchOS - Entry point
Philosophy: subtraction creates multiplication
"""
import os
import yaml


def _init_llm():
    """Load LLMClient from rebel_research .env."""
    try:
        from dotenv import load_dotenv
        rr_root = os.path.dirname(os.path.abspath(__file__))
        load_dotenv(os.path.join(rr_root, ".env"))
        from institute.mind.llm_client import LLMClient
        client = LLMClient()
        client._init()
        return client
    except Exception as e:
        print("[LLM] LLMClient unavailable, Bull/Bear will return neutral: " + str(e))
        return None


from core.data_layer import DataLayer
from core.anomaly_trigger import AnomalyTrigger
from core.bull_bear import BullBearAnalyst
from core.decision_card import generate_decision_card, print_decision_card, save_decision_card
from core.decaying_memory import DecayingMemoryStore
from core.fact_anchor import DataAnchoredFactCheck
from core.expectation_gap import ExpectationGapDetector
from core.news_fetcher import fetch_macro_news

def load_config(path="config/rebel.yaml"):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def _check_mock_block(dl, news=None):
    """
    如果 DataLayer 或 news 走了 mock fallback,打印显著报错并拒绝生成决策卡。
    返回 True 表示已拦截(调用方应直接退出)。
    """
    mock_sources = dl.get_mock_sources()
    news_mock = False
    if news and any(n.get("source") == "mock" for n in news):
        news_mock = True
        mock_sources.append("macro_news")
    if not mock_sources:
        return False
    banner = "\n" + "!" * 60
    print(banner)
    print("  ⚠️  MOCK DATA DETECTED — DECISION BLOCKED")
    print("!" * 60)
    print("以下数据源使用了 Mock(假数据),无法生成真实决策:")
    for src in mock_sources:
        print("  · " + src)
    print("\n请检查:")
    print("  1. 网络连接是否正常")
    print("  2. 代理设置:export NO_PROXY=\"*\" 或代理软件加 eastmoney/cls 直连")
    print("  3. akshare 安装: pip install akshare>=1.18")
    print("!" * 60 + "\n")
    return True

def main():
    os.makedirs("data", exist_ok=True)

    print("=" * 60)
    print("  RebelResearchOS - Anti-Consensus Research System")
    print("=" * 60)

    config = load_config()

    llm = _init_llm()
    if llm is not None:
        print("[LLM] Using model: " + str(llm.model_daily))

    dl = DataLayer()
    dl.clear_mock_sources()
    trigger = AnomalyTrigger(config.get("triggers", {}))
    analyst = BullBearAnalyst(config, llm=llm)
    memory = DecayingMemoryStore(
        db_path="data/memory.db",
        decay_config=config.get("confidence_decay", {})
    )
    fact_check = DataAnchoredFactCheck(dl)
    gap_detector = ExpectationGapDetector()

    print()
    print("[1/6] Fetching market snapshot...")
    market = dl.get_full_snapshot()
    print("  - Mag7 dispersion: " + str(market.get("mag7_dispersion")))
    print("  - Margin concentration: " + str(market.get("margin_concentration")))
    print("  - VIX: " + str(market.get("vix")))
    print("  - PMI: " + str(market.get("pmi", {}).get("manufacturing")))

    if _check_mock_block(dl, None):
        sys.exit(10)

    print()
    print("[2/6] Scanning for anomaly signals...")
    signals = trigger.should_trigger(market)

    if not signals:
        print("  >> SILENT: No anomaly signals. System sleeps.")
        print()
        print("[Stats] Memory: " + str(memory.stats()))
        print()
        print("Done.")
        return

    print("  >> ALERT: " + str(len(signals)) + " signal(s) detected!")
    for s in signals:
        print("     [" + s.severity.upper() + "] " + s.note)

    print()
    print("[3/6] Fetching macro news (财联社全球快讯)...")
    macro_news = fetch_macro_news(limit=12)
    if macro_news and macro_news[0].get("source") == "mock":
        print("  - news items: " + str(len(macro_news)) + " (MOCK — akshare offline?)")
    else:
        print("  - news items: " + str(len(macro_news)))
    for n in macro_news[:3]:
        title = (n.get("title") or "")[:60]
        print("    · " + str(n.get("time", ""))[:16] + "  " + title)

    if _check_mock_block(dl, macro_news):
        sys.exit(10)

    print()
    print("[4/6] Bull vs Bear debate...")
    bull = analyst.analyze_bull(signals, market, news=macro_news)
    bear = analyst.analyze_bear(signals, market, news=macro_news)
    print("  Bull: " + bull.stance + " | confidence=" + str(bull.confidence))
    print("  Bear: " + bear.stance + " | confidence=" + str(bear.confidence))

    print()
    print("[5/6] Generating decision card...")
    card = generate_decision_card(bull, bear, signals, news=macro_news)
    print_decision_card(card)
    save_decision_card(card, "data/decision.json")

    print()
    print("[6/6] Anchoring to memory...")
    memory.add_claim(
        content=card["thesis"],
        claim_type="narrative_based",
        confidence=card["conviction"],
        metadata={"decision": card["decision"], "bull": bull.confidence, "bear": bear.confidence}
    )

    memory.decay_all()

    print()
    print("[Fact Check] Verifying claims in thesis against real data...")
    checks = fact_check.check_text(card["thesis"])
    for c in checks:
        if c.get("verifiable"):
            print("  " + c["verdict"].upper() + ": claimed=" + str(c["claimed"]) + " actual=" + str(c["actual"]) + " (" + c["source"] + ")")
        else:
            print("  SKIP: " + c.get("reason", "unknown"))

    print()
    print("[Stats] Memory: " + str(memory.stats()))
    print()
    print("=" * 60)
    print("Done. Decision saved to data/decision.json")
    print("=" * 60)

if __name__ == "__main__":
    main()
