"""
core/anomaly_trigger.py
Anomaly detection with real data + type-based cooldown
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List

@dataclass
class AnomalySignal:
    type: str
    severity: str
    trigger_value: float
    note: str
    created_at: datetime = None

    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now()

class AnomalyTrigger:
    def __init__(self, thresholds: Dict):
        self.thresholds = thresholds
        self.last_trigger_by_type: Dict[str, datetime] = {}
        self.mandatory_cooldown = thresholds.get("cooldown_hours", 4)
        self.quiet_hours = set(thresholds.get("quiet_hours", [22, 23, 0, 1, 2, 3, 4, 5, 6, 7]))

    def is_quiet_hour(self) -> bool:
        return datetime.now().hour in self.quiet_hours

    def is_cooldown_active(self, signal_type: str) -> bool:
        last = self.last_trigger_by_type.get(signal_type)
        if last is None:
            return False
        elapsed = datetime.now() - last
        return elapsed < timedelta(hours=self.mandatory_cooldown)

    def should_trigger(self, market_data: Dict) -> List[AnomalySignal]:
        if self.is_quiet_hour():
            return []

        signals = []

        # Signal 1: VIX spike
        vix = market_data.get("vix", 16.0)
        vix_change = market_data.get("vix_change", 0.0)
        if abs(vix_change) > self.thresholds.get("vix_spike_threshold", 5.0):
            if not self.is_cooldown_active("vix_spike"):
                signals.append(AnomalySignal(
                    type="vix_spike",
                    severity="high",
                    trigger_value=abs(vix_change),
                    note="VIX change " + str(round(vix_change, 2)) + " volatility spike"
                ))
                self.last_trigger_by_type["vix_spike"] = datetime.now()

        # Signal 2: A 股龙头离散度(沪深 300 前 10 当日涨跌幅 std)
        a_dispersion = market_data.get("a_dispersion", 0.0)
        if a_dispersion > self.thresholds.get("a_dispersion_threshold", 0.03):
            if not self.is_cooldown_active("a_dispersion_spike"):
                signals.append(AnomalySignal(
                    type="a_dispersion_spike",
                    severity="high" if a_dispersion > 0.05 else "medium",
                    trigger_value=a_dispersion,
                    note="A 股龙头日内涨跌幅 std " + str(round(a_dispersion, 4)) + " 头部分化"
                ))
                self.last_trigger_by_type["a_dispersion_spike"] = datetime.now()

        # Signal 3: HK 科技龙头离散度
        hk_dispersion = market_data.get("hk_dispersion", 0.0)
        if hk_dispersion > self.thresholds.get("hk_dispersion_threshold", 0.03):
            if not self.is_cooldown_active("hk_dispersion_spike"):
                signals.append(AnomalySignal(
                    type="hk_dispersion_spike",
                    severity="high" if hk_dispersion > 0.05 else "medium",
                    trigger_value=hk_dispersion,
                    note="HK Tech 龙头日内涨跌幅 std " + str(round(hk_dispersion, 4)) + " 头部分化"
                ))
                self.last_trigger_by_type["hk_dispersion_spike"] = datetime.now()

        # Signal 4: A 股市场广度极端(涨停/跌停股数 或 涨家占比极端)
        breadth = market_data.get("a_breadth") or {}
        zt = int(breadth.get("zt_count", 0) or 0)
        dt = int(breadth.get("dt_count", 0) or 0)
        adv_ratio = float(breadth.get("advance_ratio", 0.5) or 0.5)
        zt_thr = self.thresholds.get("a_zhangting_extreme", 100)
        dt_thr = self.thresholds.get("a_dieting_extreme", 30)
        adv_thr = self.thresholds.get("a_advance_ratio_extreme", 0.25)

        extreme_hit = False
        notes = []
        severity = "medium"
        trigger_val = 0.0
        if zt >= zt_thr:
            extreme_hit = True
            notes.append("涨停 " + str(zt) + " 只")
            trigger_val = max(trigger_val, float(zt))
            if zt >= 200:
                severity = "high"
        if dt >= dt_thr:
            extreme_hit = True
            notes.append("跌停 " + str(dt) + " 只")
            trigger_val = max(trigger_val, float(dt))
            if dt >= 80:
                severity = "high"
        if adv_ratio < adv_thr or adv_ratio > (1 - adv_thr):
            extreme_hit = True
            notes.append("涨家占比 " + str(round(adv_ratio, 3)))
            trigger_val = max(trigger_val, abs(adv_ratio - 0.5) * 100)

        if extreme_hit and not self.is_cooldown_active("a_breadth_extreme"):
            signals.append(AnomalySignal(
                type="a_breadth_extreme",
                severity=severity,
                trigger_value=trigger_val,
                note="A 股广度极端: " + " / ".join(notes)
            ))
            self.last_trigger_by_type["a_breadth_extreme"] = datetime.now()

        return signals
