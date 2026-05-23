"""core/chair_scorer.py
Chair 评分计算器：把硬编码在 prompt 中的加权公式抽成可配置代码。
"""
import yaml
from pathlib import Path
from typing import Dict, Optional

DEFAULT_WEIGHTS_PATH = Path(__file__).parent.parent / "config" / "chair_weights.yaml"

SENTIMENT_MAP = {
    "极度贪婪": "extreme_greed",
    "贪婪": "greed",
    "中性": "neutral",
    "恐慌": "fear",
    "极度恐慌": "extreme_fear",
    "extreme_greed": "extreme_greed",
    "greed": "greed",
    "neutral": "neutral",
    "fear": "fear",
    "extreme_fear": "extreme_fear",
}


class ChairScorer:
    def __init__(self, config_path: Optional[Path] = None):
        path = config_path or DEFAULT_WEIGHTS_PATH
        if path.exists():
            self.config = yaml.safe_load(path.read_text(encoding="utf-8"))
        else:
            self.config = self._default_config()

    def _default_config(self) -> Dict:
        return {
            "weights": {
                "bull": 0.30,
                "preemption": 0.30,
                "bear": 0.25,
                "macro_industry": 0.15,
            },
            "thresholds": {
                "long": 20.0,
                "short": -20.0,
                "preemption_neutral": 15.0,
                "extreme_greed_short": -10.0,
                "extreme_fear_long": 10.0,
            },
        }

    def calculate(
        self,
        bull_conf: float,
        preemption: float,
        bear_conf: float,
        macro_score: float,
        sentiment_rating: str,
    ) -> Dict:
        """
        计算 Chair 最终决策。
        返回: {"decision": "long"|"short"|"neutral", "conviction": float, "weighted_score": float}
        """
        w = self.config["weights"]
        t = self.config["thresholds"]

        score = (
            bull_conf * w["bull"]
            + preemption * w["preemption"]
            - bear_conf * w["bear"]
            + macro_score * w["macro_industry"]
        )

        # Preemption 硬性过滤
        if preemption < t["preemption_neutral"]:
            return {"decision": "neutral", "conviction": 40.0, "weighted_score": score}

        # Sentiment 极端情绪过滤
        sent_key = SENTIMENT_MAP.get(str(sentiment_rating).strip().lower().replace(" ", "_"), "neutral")
        if sent_key == "extreme_greed":
            if score < t["extreme_greed_short"]:
                return {"decision": "short", "conviction": abs(score), "weighted_score": score}
            return {"decision": "neutral", "conviction": 40.0, "weighted_score": score}
        if sent_key == "extreme_fear":
            if score > t["extreme_fear_long"]:
                return {"decision": "long", "conviction": score, "weighted_score": score}
            return {"decision": "neutral", "conviction": 40.0, "weighted_score": score}

        # 基础决策
        if score > t["long"]:
            return {"decision": "long", "conviction": score, "weighted_score": score}
        if score < t["short"]:
            return {"decision": "short", "conviction": abs(score), "weighted_score": score}
        return {"decision": "neutral", "conviction": max(40.0, 100 - abs(score)), "weighted_score": score}

    def save_config(self, path: Optional[Path] = None):
        path = path or DEFAULT_WEIGHTS_PATH
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(yaml.safe_dump(self.config, allow_unicode=True, sort_keys=False), encoding="utf-8")
