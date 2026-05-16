"""
core/bull_bear.py
Bull vs Bear analysts powered by family-mind LLMClient.
LLM is the only path; if unavailable or output unparseable, return neutral.
"""
import json
import logging
from dataclasses import dataclass
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class AnalystResult:
    stance: str  # "bull" | "bear" | "neutral"
    thesis: str
    confidence: float  # 0-100
    catalyst: str
    max_upside: str
    max_loss: str
    trigger_condition: str


class BullBearAnalyst:
    def __init__(self, config: Dict, llm=None):
        self.config = config
        self.llm = llm
        self.bull_prompt = config.get("analysts", {}).get("bull", {}).get("system_prompt", "")
        self.bear_prompt = config.get("analysts", {}).get("bear", {}).get("system_prompt", "")

    def analyze_bull(self, signals: List, market_data: Dict,
                     news: Optional[List[Dict]] = None) -> AnalystResult:
        return self._analyze("bull", self.bull_prompt, signals, market_data, news=news)

    def analyze_bear(self, signals: List, market_data: Dict,
                     news: Optional[List[Dict]] = None) -> AnalystResult:
        return self._analyze("bear", self.bear_prompt, signals, market_data, news=news)

    def analyze_stock(self, side: str, code: str, quote: Dict,
                      indicators_latest: Dict, signal_result: Dict,
                      news: Optional[List[Dict]] = None) -> AnalystResult:
        """个股 Bull/Bear。复用市场级 system_prompt,user_prompt 包注入指标数字 + 近期新闻。"""
        system_prompt = self.bull_prompt if side == "bull" else self.bear_prompt
        if self.llm is None:
            logger.warning("[stock-%s] LLM not configured, returning neutral", side)
            return self._neutral(side)

        user_prompt = self._build_stock_user_prompt(side, code, quote, indicators_latest, signal_result, news=news)

        try:
            raw = self.llm.chat(
                system=system_prompt,
                user_prompt=user_prompt,
                json_mode=True,
                max_tokens=800,
                temperature=0.4,
            )
        except Exception as e:
            logger.error("[stock-%s] LLM call failed: %s", side, e)
            return self._neutral(side)

        if not raw:
            logger.warning("[stock-%s] LLM returned empty", side)
            return self._neutral(side)

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.warning("[stock-%s] JSON parse failed: %s; raw=%s", side, e, raw[:200])
            return self._neutral(side)

        stance = str(data.get("stance", "neutral")).lower().strip()
        if stance not in ("bull", "bear", "neutral"):
            stance = "neutral"
        try:
            confidence = float(data.get("confidence", 0))
        except (ValueError, TypeError):
            confidence = 0.0
        confidence = max(0.0, min(100.0, confidence))

        return AnalystResult(
            stance=stance,
            thesis=str(data.get("thesis", "") or ""),
            confidence=confidence,
            catalyst=str(data.get("catalyst", "") or ""),
            max_upside=str(data.get("max_upside", "") or "") if side == "bull" else "",
            max_loss=str(data.get("max_loss", "") or "") if side == "bear" else "",
            trigger_condition=str(data.get("trigger_condition", "") or "") if side == "bear" else "",
        )

    def _analyze(self, side: str, system_prompt: str, signals: List, market_data: Dict,
                 news: Optional[List[Dict]] = None) -> AnalystResult:
        if self.llm is None:
            logger.warning("[%s] LLM not configured, returning neutral", side)
            return self._neutral(side)

        user_prompt = self._build_user_prompt(side, signals, market_data, news=news)

        try:
            raw = self.llm.chat(
                system=system_prompt,
                user_prompt=user_prompt,
                json_mode=True,
                max_tokens=800,
                temperature=0.4,
            )
        except Exception as e:
            logger.error("[%s] LLM call failed: %s", side, e)
            return self._neutral(side)

        if not raw:
            logger.warning("[%s] LLM returned empty", side)
            return self._neutral(side)

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.warning("[%s] JSON parse failed: %s; raw=%s", side, e, raw[:200])
            return self._neutral(side)

        stance = str(data.get("stance", "neutral")).lower().strip()
        if stance not in ("bull", "bear", "neutral"):
            stance = "neutral"

        try:
            confidence = float(data.get("confidence", 0))
        except (ValueError, TypeError):
            confidence = 0.0
        confidence = max(0.0, min(100.0, confidence))

        return AnalystResult(
            stance=stance,
            thesis=str(data.get("thesis", "") or ""),
            confidence=confidence,
            catalyst=str(data.get("catalyst", "") or ""),
            max_upside=str(data.get("max_upside", "") or "") if side == "bull" else "",
            max_loss=str(data.get("max_loss", "") or "") if side == "bear" else "",
            trigger_condition=str(data.get("trigger_condition", "") or "") if side == "bear" else "",
        )

    def _build_user_prompt(self, side: str, signals: List, market_data: Dict,
                           news: Optional[List[Dict]] = None) -> str:
        lines = [f"Today's anomaly signals ({len(signals)}):"]
        if signals:
            for s in signals:
                lines.append(f"- [{s.severity}] {s.type}: {s.note}")
        else:
            lines.append("- (none)")

        lines.append("")
        lines.append("Market snapshot:")
        pmi = market_data.get("pmi", {})
        pmi_val = pmi.get("manufacturing") if isinstance(pmi, dict) else pmi
        lines.append(f"- Mag7 dispersion: {market_data.get('mag7_dispersion')}")
        lines.append(f"- Margin concentration: {market_data.get('margin_concentration')}")
        lines.append(f"- VIX: {market_data.get('vix')}")
        lines.append(f"- Manufacturing PMI: {pmi_val}")
        lines.append("")

        # 增量市场信息(宏观快讯) — 没新闻时也明确告知
        lines.append("Recent macro headlines (last 24h, descending by time):")
        if news:
            from core.news_fetcher import summarize_for_prompt
            lines.append(summarize_for_prompt(news, max_items=10, max_total_chars=1800))
        else:
            lines.append("(no news fetched)")
        lines.append("")
        lines.append("Use the headlines above as narrative context — ground your thesis in what is happening, "
                     "not only in the abstract numbers.")
        lines.append("")

        if side == "bull":
            lines.append("Provide a bull-side judgement. Output a strict JSON object with fields:")
            lines.append('{"stance": "bull" or "neutral", "thesis": "1-2 sentence argument", '
                         '"confidence": integer 0-100, "catalyst": "date or event", '
                         '"max_upside": "e.g. +10%"}')
            lines.append('If no strong bull case, set stance="neutral" and confidence<30.')
        else:
            lines.append("Provide a bear-side judgement. Output a strict JSON object with fields:")
            lines.append('{"stance": "bear" or "neutral", "thesis": "1-2 sentence argument", '
                         '"confidence": integer 0-100, "trigger_condition": "condition that confirms thesis", '
                         '"max_loss": "e.g. -10%"}')
            lines.append('If no strong bear case, set stance="neutral" and confidence<30.')

        return "\n".join(lines)

    def _build_stock_user_prompt(self, side: str, code: str, quote: Dict,
                                 ind: Dict, signal_result: Dict,
                                 news: Optional[List[Dict]] = None) -> str:
        """个股 prompt: 注入 peistock 指标摘要 + 严格 B/S 信号 + 近期新闻与公告。"""
        def fmt(v, nd=2):
            if v is None:
                return "N/A"
            try:
                return str(round(float(v), nd))
            except (TypeError, ValueError):
                return str(v)

        market = quote.get("market", "")
        market_label = "A 股" if market == "a" else ("HK 港股" if market == "hk" else market)

        lines = [
            f"Stock: {code} {quote.get('name') or ''}  ({market_label})",
            f"Price: {fmt(quote.get('price'))} ({fmt(quote.get('change_pct'))}%)",
            "",
            "Peistock indicators (latest):",
            f"- close vs MAHS:        {fmt(ind.get('close'))} vs {fmt(ind.get('mahs'))}",
            f"- MA20 / MA60 / MA225:  {fmt(ind.get('ma20'))} / {fmt(ind.get('ma60'))} / {fmt(ind.get('ma225'))}",
            f"- BIAS225:              {fmt(ind.get('bias225'))}% (percentile {fmt(ind.get('bias225_percentile'),1)}%)",
            f"- CRI:                  {fmt(ind.get('cri'),1)} (percentile {fmt(ind.get('cri_percentile'),1)}%)",
            f"- GSI percentile:       {fmt(ind.get('greedy_percentile'),1)}%",
            f"- Cost deviation:       {fmt(ind.get('cost_deviation'))} (percentile {fmt(ind.get('cost_deviation_percentile'),1)}%)",
            f"- ADX / +DI / -DI:      {fmt(ind.get('adx'),1)} / {fmt(ind.get('plus_di'),1)} / {fmt(ind.get('minus_di'),1)}",
            f"- PVT divergence:       {ind.get('pvt_divergence') or 'none'}",
            f"- Trend strength:       {ind.get('trend_strength') or 'unknown'}",
            "",
            "Strict B/S signals (xueqiu thresholds):",
            f"- signal_type:   {signal_result.get('signal_type') or 'none'}",
            f"- signals:       {', '.join(signal_result.get('signals') or []) or '(none)'}",
            "",
            "Recent news & announcements (descending by time):",
        ]

        if news:
            from core.news_fetcher import summarize_for_prompt
            lines.append(summarize_for_prompt(news, max_items=10, max_total_chars=1800))
        else:
            lines.append("(no news fetched)")
        lines.append("")
        lines.append("Use the news above as narrative context — explain WHY the indicators look this way, "
                     "or whether news flow contradicts what the indicators suggest.")
        lines.append("")

        if side == "bull":
            lines.append("Provide a BULL-side judgement on this stock. Output a strict JSON object:")
            lines.append('{"stance": "bull" or "neutral", "thesis": "1-2 sentence argument grounded in the indicators above", '
                         '"confidence": integer 0-100, "catalyst": "date or event", "max_upside": "e.g. +10%"}')
            lines.append('If no strong bull case, set stance="neutral" and confidence<30.')
        else:
            lines.append("Provide a BEAR-side judgement on this stock. Output a strict JSON object:")
            lines.append('{"stance": "bear" or "neutral", "thesis": "1-2 sentence argument grounded in the indicators above", '
                         '"confidence": integer 0-100, "trigger_condition": "what confirms the thesis", "max_loss": "e.g. -10%"}')
            lines.append('If no strong bear case, set stance="neutral" and confidence<30.')

        return "\n".join(lines)

    def _neutral(self, side: str) -> AnalystResult:
        return AnalystResult(
            stance="neutral",
            thesis=f"NO {side.upper()} STANCE THIS ROUND",
            confidence=0.0,
            catalyst="N/A",
            max_upside="",
            max_loss="",
            trigger_condition="",
        )
