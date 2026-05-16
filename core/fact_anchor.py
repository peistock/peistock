"""
core/fact_anchor.py
Data-anchored fact check: verify claims against real data sources
Not model-vs-model, but claim-vs-API
"""
import re
from typing import Dict, List

class DataAnchoredFactCheck:
    def __init__(self, data_layer):
        self.dl = data_layer

    def extract_numeric_claims(self, text: str) -> List[Dict]:
        """Extract numeric claims from text"""
        claims = []
        # Pattern: number + % or B or keyword
        patterns = [
            (r'([+-]?\d+\.?\d*)%', 'percentage'),
            (r'\$(\d+\.?\d*)\s*B', 'billion_dollars'),
            (r'PMI\s+([+-]?\d+\.?\d*)', 'pmi'),
            (r'VIX\s+([+-]?\d+\.?\d*)', 'vix'),
        ]
        for pat, ctype in patterns:
            for m in re.finditer(pat, text, re.IGNORECASE):
                val = float(m.group(1))
                ctx_start = max(0, m.start() - 30)
                ctx_end = min(len(text), m.end() + 30)
                ctx = text[ctx_start:ctx_end].strip().replace(chr(10), " ")
                claims.append({"type": ctype, "value": val, "context": ctx, "position": m.start()})
        return claims

    def verify_claim(self, claim: Dict) -> Dict:
        """Verify a single claim against real data"""
        ctype = claim["type"]
        claimed = claim["value"]
        actual = None
        source = "unknown"

        if ctype == "pmi":
            pmi_data = self.dl.get_pmi()
            actual = pmi_data.get("manufacturing", 50.0)
            source = "akshare"
        elif ctype == "vix":
            actual = self.dl.get_vix()
            source = "yfinance"
        elif ctype == "percentage":
            # Cannot verify generic percentage without ticker context
            return {"verifiable": False, "reason": "generic percentage without ticker"}
        else:
            return {"verifiable": False, "reason": "unsupported claim type"}

        if actual is None:
            return {"verifiable": False, "reason": "data source failed"}

        delta = abs(claimed - actual)
        verdict = "verified" if delta < 0.5 else "disputed"

        return {
            "verifiable": True,
            "claimed": claimed,
            "actual": round(actual, 2),
            "delta": round(delta, 2),
            "verdict": verdict,
            "source": source,
            "context": claim["context"]
        }

    def check_text(self, text: str) -> List[Dict]:
        """Full pipeline: extract + verify all claims in text"""
        claims = self.extract_numeric_claims(text)
        results = []
        for c in claims:
            results.append(self.verify_claim(c))
        return results
