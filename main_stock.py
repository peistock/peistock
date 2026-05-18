#!/usr/bin/env python3
"""
main_stock.py
个股 Bull/Bear CLI 入口(A 股 / HK 通用)。
用法:
    .venv/bin/python main_stock.py 600989
    .venv/bin/python main_stock.py 01810
"""
import os
import sys
import yaml


def _init_llm():
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


from core.data_layer import DataLayer, _market_of
from core.indicators import calculate_all_indicators
from core.signal_detector import detect_signals, build_signal_input
from core.bull_bear import BullBearAnalyst
from core.decision_card import generate_stock_card, print_decision_card, save_stock_card
from core.news_fetcher import fetch_stock_news, fetch_stock_notices


def load_config(path="config/rebel.yaml"):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _check_mock_block_stock(dl, code: str, news=None):
    """
    如果 DataLayer 或 news 走了 mock fallback,打印显著报错并拒绝生成决策卡。
    返回 True 表示已拦截(调用方应直接退出)。
    """
    mock_sources = dl.get_mock_sources()
    if news and any(n.get("source") == "mock" for n in news):
        mock_sources.append("stock_news")
    if not mock_sources:
        return False
    banner = "\n" + "!" * 60
    print(banner)
    print("  ⚠️  MOCK DATA DETECTED — DECISION BLOCKED")
    print("!" * 60)
    print("以下数据源使用了 Mock(假数据),无法为 " + code + " 生成真实决策:")
    for src in mock_sources:
        print("  · " + src)
    print("\n请检查:")
    print("  1. 网络连接是否正常")
    print("  2. 代理设置:export NO_PROXY=\"*\" 或代理软件加 eastmoney/cls 直连")
    print("  3. akshare 安装: pip install akshare>=1.18")
    print("!" * 60 + "\n")
    return True


def run(code: str) -> int:
    try:
        market = _market_of(code)
    except ValueError as e:
        print("[ERROR] " + str(e))
        return 2

    print("=" * 60)
    print("  RebelResearchOS · Stock Bull/Bear  ::  " + code + " (" + market.upper() + ")")
    print("=" * 60)

    config = load_config()
    dl = DataLayer()
    dl.clear_mock_sources()

    print()
    print("[1/6] Fetching history & quote...")
    try:
        hist = dl.get_stock_history(code, days=300)
        quote = dl.get_stock_quote(code)
        capital = dl.get_stock_capital(code)
    except Exception as e:
        print("[ERROR] data fetch failed: " + str(e))
        return 3

    if _check_mock_block_stock(dl, code, None):
        return 10

    if hist is None or len(hist) < 60:
        print("[ERROR] history too short for indicators: len=" + str(0 if hist is None else len(hist)))
        return 3

    print("  - name:     " + str(quote.get("name")))
    print("  - price:    " + str(quote.get("price")) + " (" + str(quote.get("change_pct")) + "%)")
    print("  - history:  " + str(len(hist)) + " rows")
    print("  - capital:  " + str(int(capital)) + " shares")

    print()
    print("[2/6] Computing peistock indicators...")
    try:
        indicators = calculate_all_indicators(hist, capital)
    except Exception as e:
        print("[ERROR] indicator compute failed: " + str(e))
        return 4
    if not indicators:
        print("[ERROR] indicator output empty")
        return 4
    latest = indicators[-1]
    print("  - BIAS225 pct:    " + str(latest.get("bias225_percentile")))
    print("  - CRI / pct:      " + str(latest.get("cri")) + " / " + str(latest.get("cri_percentile")))
    print("  - GSI pct:        " + str(latest.get("greedy_percentile")))
    print("  - CostDev pct:    " + str(latest.get("cost_deviation_percentile")))
    print("  - PVT divergence: " + str(latest.get("pvt_divergence")))
    print("  - ADX:            " + str(latest.get("adx")))

    print()
    print("[3/6] Strict B/S signal detection...")
    sig_input = build_signal_input(indicators, lookback=5)
    signal_result = detect_signals(sig_input, use_divergence=True)
    print("  - signal_type:  " + str(signal_result.get("signal_type")))
    print("  - signals:      " + ", ".join(signal_result.get("signals") or []) or "(none)")

    print()
    print("[4/6] Fetching recent news & announcements...")
    news = fetch_stock_news(code, market, limit=8)
    notices = fetch_stock_notices(code, limit=5) if market == "a" else []
    all_news = news + notices
    print("  - news items:    " + str(len(news)) + (" (mock)" if news and news[0].get("source") == "mock" else ""))
    print("  - notice items:  " + str(len(notices)))
    for n in all_news[:3]:
        title = (n.get("title") or "")[:50]
        print("    · " + str(n.get("time", ""))[:16] + "  " + title)

    # 获取研报客观数据（A 股）
    rr_data = ""
    if market == "a":
        print("  - fetching research reports...")
        try:
            from core.research_report import get_research_report_data, summarize_for_prompt
            rr_raw = get_research_report_data(code, market="a", limit=2, llm=None)
            if rr_raw:
                rr_data = summarize_for_prompt(rr_raw, max_total_chars=2000)
                print("    · research reports: " + str(len(rr_data)) + " chars")
        except Exception as e:
            print("    · research reports failed: " + str(e))

    if _check_mock_block_stock(dl, code, all_news):
        return 10

    # 获取板块背景（A 股）
    sector_context = ""
    if market == "a":
        try:
            from core.sector_context import get_sector_context
            sector_context = get_sector_context(code)
            if sector_context:
                print("  - sector context: " + sector_context)
        except Exception as e:
            print("  - sector context failed: " + str(e))

    # 获取历史决策记录（回测闭环）
    history_context = ""
    try:
        from core.backtest_tracker import format_recent_decisions_for_prompt
        history_context = format_recent_decisions_for_prompt(code, limit=3)
        if history_context:
            print("  - history context: " + history_context.split("\n")[0])
    except Exception as e:
        print("  - history context failed: " + str(e))

    # 获取贵金属/有色金属宏观关联视角
    metal_context = ""
    try:
        from core.metal_context import get_metal_context
        # 从 quote 中获取行业信息（如果可用），否则用空字符串让内部判断
        industry = quote.get("industry", "")
        stock_change = quote.get("change_pct", 0)
        metal_context = get_metal_context(code, industry, stock_change_20d=stock_change)
        if metal_context:
            print("  - metal context: " + metal_context.split("\n")[0])
    except Exception as e:
        print("  - metal context failed: " + str(e))

    print()
    print("[5/6] Bull vs Bear debate...")
    llm = _init_llm()
    if llm is not None:
        print("  - LLM model: " + str(getattr(llm, "model_daily", "unknown")))
    analyst = BullBearAnalyst(config, llm=llm)
    bull = analyst.analyze_stock("bull", code, quote, latest, signal_result, news=all_news, research_report=rr_data, sector_context=sector_context, history_context=history_context, metal_context=metal_context)
    bear = analyst.analyze_stock("bear", code, quote, latest, signal_result, news=all_news, research_report=rr_data, sector_context=sector_context, history_context=history_context, metal_context=metal_context)
    print("  Bull: " + bull.stance + " | confidence=" + str(bull.confidence))
    print("  Bear: " + bear.stance + " | confidence=" + str(bear.confidence))

    print()
    print("[6/6] Decision card...")
    card = generate_stock_card(bull, bear, code, quote, latest, signal_result, news=all_news)
    print_decision_card(card)
    path = save_stock_card(card, base_dir="data/stock_decisions")
    print()
    print("Saved: " + path)
    return 0


def main():
    if len(sys.argv) < 2:
        print("Usage: main_stock.py <code>")
        print("  A 股: 6 位数字(如 600989)")
        print("  HK  : 5 位数字(如 01810)")
        sys.exit(1)
    code = sys.argv[1].strip()
    rc = run(code)
    sys.exit(rc)


if __name__ == "__main__":
    main()
