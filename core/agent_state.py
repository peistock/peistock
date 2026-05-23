"""core/agent_state.py
全局 Agent 状态管理：将各分析师的 Markdown 报告转为结构化信号。
"""
import json
from pathlib import Path
from typing import Dict, Optional, Literal, Any
from dataclasses import dataclass, asdict

SignalType = Literal["BULLISH", "BEARISH", "NEUTRAL"]


@dataclass
class AnalystSignal:
    signal: SignalType
    confidence: int  # 0-100
    reasoning: str
    key_metrics: Dict[str, float]
    thesis: str
    kill_switch: Optional[str]
    max_loss: Optional[str]


class AgentState:
    """管理单只股票在某日期的所有分析师结构化信号。"""

    STATE_DIR = Path(__file__).parent.parent / "data" / "agent_states"

    def __init__(self, code: str, date_str: str):
        self.code = code
        self.date_str = date_str
        self._reports: Dict[str, AnalystSignal] = {}

    def set_report(self, slug: str, report: AnalystSignal) -> None:
        self._reports[slug] = report

    def get_report(self, slug: str) -> Optional[AnalystSignal]:
        return self._reports.get(slug)

    def to_json(self) -> str:
        payload = {
            "code": self.code,
            "date_str": self.date_str,
            "reports": {
                slug: {
                    "signal": r.signal,
                    "confidence": r.confidence,
                    "reasoning": r.reasoning,
                    "key_metrics": r.key_metrics,
                    "thesis": r.thesis,
                    "kill_switch": r.kill_switch,
                    "max_loss": r.max_loss,
                }
                for slug, r in self._reports.items()
            },
        }
        return json.dumps(payload, ensure_ascii=False, indent=2)

    @classmethod
    def from_json(cls, json_str: str) -> "AgentState":
        data = json.loads(json_str)
        inst = cls(data["code"], data["date_str"])
        for slug, r in data.get("reports", {}).items():
            inst.set_report(
                slug,
                AnalystSignal(
                    signal=r["signal"],
                    confidence=r["confidence"],
                    reasoning=r["reasoning"],
                    key_metrics=r.get("key_metrics", {}),
                    thesis=r["thesis"],
                    kill_switch=r.get("kill_switch"),
                    max_loss=r.get("max_loss"),
                ),
            )
        return inst

    def save(self) -> Path:
        self.STATE_DIR.mkdir(parents=True, exist_ok=True)
        path = self.STATE_DIR / f"{self.code}_{self.date_str}.json"
        path.write_text(self.to_json(), encoding="utf-8")
        return path

    @classmethod
    def load(cls, code: str, date_str: str) -> Optional["AgentState"]:
        path = cls.STATE_DIR / f"{code}_{date_str}.json"
        if path.exists():
            return cls.from_json(path.read_text(encoding="utf-8"))
        return None
