"""
core/expectation_gap.py
Expectation gap detector: actual vs consensus vs price reaction
"""
from dataclasses import dataclass
from typing import Dict

@dataclass
class ExpectationGap:
    ticker: str
    metric: str
    actual: float
    expected: float
    gap: float
    price_reaction: float  # post-event return %
    priced_in: bool  # True if market already reacted
    actionable: bool  # True if gap exists AND not priced in
    note: str

class ExpectationGapDetector:
    def __init__(self):
        pass

    def detect(self, ticker: str, actual_data: Dict, consensus_data: Dict) -> ExpectationGap:
        """
        Detect expectation gap for a single ticker
        """
        actual = actual_data.get("revenue_growth", 0)
        expected = consensus_data.get("revenue_growth", 0)
        gap = actual - expected

        # Price reaction as proxy for "priced in"
        price_reaction = actual_data.get("post_earnings_return", 0)
        priced_in = abs(price_reaction) > 2.0  # >2% move = market reacted

        # Actionable only if significant gap AND not priced in
        actionable = abs(gap) > 2.0 and not priced_in

        note_parts = []
        note_parts.append("Actual " + str(round(actual, 1)) + "% vs Expected " + str(round(expected, 1)) + "%")
        note_parts.append("Gap " + str(round(gap, 1)) + "%")
        if priced_in:
            note_parts.append("PRICED IN (post-event return " + str(round(price_reaction, 1)) + "%)")
        else:
            note_parts.append("NOT PRICED IN (post-event return " + str(round(price_reaction, 1)) + "%)")

        return ExpectationGap(
            ticker=ticker,
            metric="revenue_growth",
            actual=actual,
            expected=expected,
            gap=gap,
            price_reaction=price_reaction,
            priced_in=priced_in,
            actionable=actionable,
            note="; ".join(note_parts)
        )

    def batch_detect(self, tickers: list, data_layer) -> list:
        """
        Batch detect gaps for multiple tickers
        """
        results = []
        for ticker in tickers:
            # Mock consensus for now - in production fetch from Wind/Bloomberg
            consensus = {"revenue_growth": 25.0}  # placeholder
            actual = {"revenue_growth": 28.0, "post_earnings_return": 0.5}  # placeholder
            gap = self.detect(ticker, actual, consensus)
            results.append(gap)
        return results
