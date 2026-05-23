# P1 方案：Chair 评分公式回测化

> **状态：已实施（2026-05-23）**。本方案的核心内容（ChairScorer、chair_weights.yaml、五维度评分提取、DB schema 补齐）已在 2026-05-23 完成。实际实施时还同步落地了 Phase 1.5 对抗辩论、AgentState 结构化通信、Evals 评测框架、Data Sandbox、Risk Manager 零 LLM 风控层、cninfo 公告 fallback 等配套能力。

> 整合数据层分析 + 搜索算法设计 + Chair 解耦方案

## 结论先行

当前 `optimize_chair_weights.py` 已就绪，但**跑不起来**——`backtest_tracker.db` 里缺少 `macro_industry_score`，决策卡 JSON 里也没有五维度原始评分。必须先补齐数据，再改 Chair 输出格式，最后才能跑权重搜索。

整个改造分 4 步，前两步是阻塞项。

---

## 第一步：补齐数据存储（阻塞项，命中红线）

### 1.1 DB schema 新增字段

修改 `core/backtest_tracker.py` 的 `CREATE TABLE`：

```python
# 在 validated_decisions 表中新增两列
"""
CREATE TABLE IF NOT EXISTS validated_decisions (
    ...
    bull_confidence REAL,
    bear_confidence REAL,
    preemption_score REAL,
    macro_industry_score REAL,        -- 新增
    sentiment_rating TEXT,
    sentiment_score REAL,             -- 新增（量化后的数值）
    ...
)
"""
```

同步修改 `validate_pending_decisions()` 的 `INSERT OR REPLACE` 语句，把这两个字段写进去。

**红线说明**：数据库 schema 变更属于必须先确认的操作。如果同意执行，我需要在现有表上执行 `ALTER TABLE ADD COLUMN`（SQLite 支持），不会丢数据。

### 1.2 决策卡 JSON 补录五维度评分

修改 `api_server.py` 的 `_generate_stock_decision_card()`，从 Chair Markdown 报告中正则提取五维度评分：

```python
# 在 _generate_stock_decision_card 中新增提取逻辑
def _extract_dimension_score(text: str, label: str) -> Optional[float]:
    """从五维度对比表格中提取指定维度的评分。"""
    # 匹配格式：| 置信度/评分 | XX | XX | XX | XX | XX |
    # 需要知道 label 在表头中的列位置
    pattern = rf"\|\s*{re.escape(label)}\s*\|\s*([\d\.]+|\-?[\d\.]+)"
    m = re.search(pattern, text, re.IGNORECASE)
    if m:
        return float(m.group(1))
    return None

# 在 card 组装前提取
card["bull_confidence"] = _extract_dimension_score(chair_content, "Bull")
card["bear_confidence"] = _extract_dimension_score(chair_content, "Bear")
card["preemption_score"] = _extract_dimension_score(chair_content, "Preemption")
card["macro_industry_score"] = _extract_dimension_score(chair_content, "MacroIndustry")
# Sentiment 是定性评级，提取文本后后续量化
card["sentiment_rating"] = _extract_sentiment_rating(chair_content)
```

**关键前提**：Chair 报告必须先输出规范的五维度对比表格（见第二步）。

---

## 第二步：改造 Chair 输出格式（阻塞项）

### 2.1 改 `roles/chair_debate.yaml`

**当前问题**：权重公式硬编码在 prompt 里，LLM 自己算 weighted_score。这导致：
1. Python 层无法获取原始评分
2. 权重不可调

**改造方案**：把加权计算从 prompt 中移除，要求 Chair 只输出**原始评分**和**定性判断**。

修改 prompt 的"基于「加权评分 + Sentiment 情绪过滤」做出最终裁决"段落：

```yaml
# 原内容（移除）：
# 7. 基于「加权评分 + Sentiment 情绪过滤」做出最终裁决：
#    - 计算加权得分：weighted_score = Bull置信度 × 0.30 + ...
#    - 基础决策：weighted_score > 20 → LONG ...

# 新内容：
7. 基于五维度原始评分 + Sentiment 情绪过滤做出最终裁决：
   - 首先，在输出中明确列出每个维度的原始评分（数值）：
     * Bull 置信度：0-100
     * Preemption 入场时机评分：0-100
     * Bear 置信度：0-100
     * MacroIndustry 综合评分：-50 ~ +50
     * Sentiment 情绪评级：极度贪婪/贪婪/中性/恐慌/极度恐慌
   - 然后，给出你的定性判断：
     * Preemption 是否 <15（信息已完全消化）？
     * Sentiment 是否处于极端状态？
     * 基于以上条件，你的建议方向是什么（LONG/SHORT/NEUTRAL）？
     * 你的信心度是多少（0-100）？
   - **注意**：不要自行计算加权得分，系统会根据你给出的原始评分自动计算。
```

同时，在输出格式的"五维度对比摘要"表格中，确保评分列是**纯数字**，方便正则提取：

```markdown
| 维度 | Bull | Bear | Preemption | Sentiment | MacroIndustry |
|------|------|------|------------|-----------|---------------|
| 置信度/评分 | 75 | 30 | 60 | 贪婪 | +20 |
```

### 2.2 新增 `core/chair_scorer.py`

把原来在 prompt 里的计算逻辑搬到 Python 代码中：

```python
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
        sent_key = SENTIMENT_MAP.get(sentiment_rating.strip(), "neutral")
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
```

### 2.3 配置文件 `config/chair_weights.yaml`

```yaml
weights:
  bull: 0.30
  preemption: 0.30
  bear: 0.25
  macro_industry: 0.15

thresholds:
  long: 20.0
  short: -20.0
  preemption_neutral: 15.0
  extreme_greed_short: -10.0
  extreme_fear_long: 10.0
```

### 2.4 集成到 `api_server.py`

在 `_generate_stock_decision_card()` 提取完原始评分后，调用 `ChairScorer`：

```python
from core.chair_scorer import ChairScorer

scorer = ChairScorer()
result = scorer.calculate(
    bull_conf=card.get("bull_confidence", 50),
    preemption=card.get("preemption_score", 50),
    bear_conf=card.get("bear_confidence", 50),
    macro_score=card.get("macro_industry_score", 0),
    sentiment_rating=card.get("sentiment_rating", "中性"),
)

# 用 ChairScorer 的结果覆盖 Chair 的原始决策（可配置是否覆盖）
card["decision"] = result["decision"].upper()
card["conviction"] = result["conviction"]
card["weighted_score"] = result["weighted_score"]
```

---

## 第三步：跑权重优化（数据补齐后）

`core/optimize_chair_weights.py` 已就绪。数据补齐后的用法：

```bash
cd ~/rebel_research

# 1. 生成 mock 数据测试脚本
.venv/bin/python core/optimize_chair_weights.py --generate-mock
.venv/bin/python core/optimize_chair_weights.py --csv data/chair_mock_history.csv --algo bayes --trials 200

# 2. 从真实 DB 跑（需要等 validate_pending_decisions 积累数据后）
.venv/bin/python core/optimize_chair_weights.py --algo bayes --trials 500

# 3. 导出最优参数到 JSON
# 结果自动写入 data/chair_best_params.json
```

拿到最优参数后，手动更新 `config/chair_weights.yaml`，或写一个自动同步脚本。

---

## 第四步：历史数据回填（可选，建议做）

已有的 `data/stock_decisions/*.json` 和 `data/archives/*_chair_debate.md` 里有历史记录，但早期决策卡缺少五维度评分。

如果要做权重优化，需要一定样本量（至少 30 条，理想 100+）。两个回填方案：

**方案 A：从 Chair Markdown 报告回填**（推荐）
- 遍历 `data/archives/*_chair_debate.md`
- 用正则提取五维度表格中的评分
- 回填到 `data/stock_decisions/*.json` 和 `backtest_tracker.db`

**方案 B：从 MacroIndustry 子报告回填**
- 遍历 `data/archives/*_macro_industry.md`
- 提取 "综合评分" 数值
- 但早期报告格式可能不一致，正则容错要求高

---

## 文件改动清单

| 文件 | 改动内容 | 是否阻塞 |
|------|---------|---------|
| `core/backtest_tracker.py` | DB schema +2 字段，INSERT 语句同步 | **是**（红线） |
| `api_server.py` | `_generate_stock_decision_card` 提取五维度评分 + 调用 ChairScorer | **是** |
| `roles/chair_debate.yaml` | 移除硬编码权重，要求输出原始评分 | **是** |
| `core/chair_scorer.py` | 新增 | 否 |
| `config/chair_weights.yaml` | 新增 | 否 |
| `core/optimize_chair_weights.py` | 已存在，待数据补齐后启用 | 否 |

---

## 实施记录（2026-05-23）

| 计划项 | 状态 | 备注 |
|--------|------|------|
| DB schema 新增字段 | ✅ 已完成 | `macro_industry_score`、`sentiment_score` 已加入 |
| 决策卡 JSON 补录五维度评分 | ✅ 已完成 | `_generate_stock_decision_card` 已提取原始评分 |
| Chair prompt 移除硬编码权重 | ✅ 已完成 | Chair 只输出原始评分和定性判断 |
| `core/chair_scorer.py` | ✅ 已完成 | 权重可配置，信任 Chair 原始决策优先 |
| `config/chair_weights.yaml` | ✅ 已完成 | 默认权重 + 阈值已配置 |
| 集成到 `api_server.py` | ✅ 已完成 | 提取评分后调用 ChairScorer |
| Phase 1.5 对抗辩论 | ✅ 同步实施 | Bear Rebuttal → Bull Response → Debate Summary |
| AgentState 结构化通信 | ✅ 同步实施 | `core/agent_state.py` 替代正则解析 |
| Evals 评测框架 | ✅ 同步实施 | `core/evals/` 5 断言 + 12 边界 case |
| Data Sandbox | ✅ 同步实施 | `core/data_sandbox.py` 安全 Python 执行 |
| Risk Manager | ✅ 同步实施 | `core/risk_manager.py` 零 LLM 风控 |
| cninfo 公告 fallback | ✅ 同步实施 | `core/cninfo_api.py` 巨潮资讯网回退 |

**与计划的不同之处**：
1. 原始计划只涉及 Chair 解耦和权重优化。实际实施时，用户要求同步落地了 6 项配套能力（Debate、AgentState、Evals、Sandbox、Risk Manager、cninfo）。
2. ChairScorer 与 Chair 原始决策的冲突：原始计划建议"用 ChairScorer 的结果覆盖 Chair 的原始决策"，实际实施中发现这会导致 Chair 明确 NEUTRAL 时被强行改为 LONG。最终方案是**信任 Chair 原始决策优先**，ChairScorer 仅在 Chair 未明确方向时作为 fallback。
3. 权重优化（`optimize_chair_weights.py`）尚未实际运行，因为积累的历史带五维度评分的样本量还不足（需要 30+ 条）。待样本量充足后启用。

---

## 风险与待决策点

1. **DB schema 变更**：是否需要保留历史数据？SQLite `ALTER TABLE ADD COLUMN` 不丢数据，但旧记录的 `macro_industry_score` 会是 NULL。
2. **Chair prompt 改造后输出稳定性**：移除加权公式后，LLM 是否还能稳定输出五维度评分表格？建议先在本地跑 5-10 只股票的端到端测试验证格式解析成功率。
3. **Sentiment 量化**：当前 Sentiment 是定性文本（"贪婪"/"恐慌"），`ChairScorer` 用字典映射。如果后续要让 Sentiment 也参与权重搜索，需要先定义量化映射规则。
4. **生产切换策略**：`ChairScorer` 的决策是否直接覆盖 LLM 的决策？建议先并行运行一段时间（LLM 决策 vs Scorer 决策都记录），对比一致性后再切换。
