# RebelResearchOS

反共识 AI 研究系统 —— 用减法做乘法。

## 核心设计反转

| 原版 ResearchOS | RebelResearchOS | 实现 |
|---|---|---|
| 42 个分析师覆盖全角度 | **5 个分析师 + 1 裁决员 + Phase 1.5 对抗辩论 + 零 LLM 风控** | `roles/` + `institute/orchestrator.py` + `core/risk_manager.py` |
| 无限归档向量沉淀 | **观点有半衰期,自动遗忘 + 墓碑机制** | `core/decaying_memory.py` |
| 每 30-60min 强制产出 | **异常信号触发,其余时间静默** | `core/anomaly_trigger.py` |
| 模型 A 验证模型 B | **对接真实数据源验证** | `core/fact_anchor.py` |
| 全面分析所有数据 | **只抓"预期差"** | `core/expectation_gap.py` |
| 纯指标解读 | **辩论吃指标 + 最近 24h 新闻 / 公告 + 季度财报预注入** | `core/news_fetcher.py` + `core/financial_data.py` |
| 输出长篇报告 | **输出三选一决策:long/short/neutral + kill_switch** | `core/decision_card.py` |
| 无回测验证 | **历史回测 + 信号级回测 + Evals 评测框架** | `core/backtest.py` + `core/signal_backtest.py` + `core/evals/` |
| 纯 LLM 决策 | **LLM 输出原始评分 + Python 层权重可配置 + 风控过滤** | `core/chair_scorer.py` + `core/risk_manager.py` |

## 快速开始

### 1. 安装依赖

```bash
cd rebel_research
pip install -r requirements.txt
```

### 2. 运行主系统

```bash
python main.py
```

系统会：
1. 获取真实市场数据（AKShare + yfinance）
2. 检测异常信号（Mag7 离散度、融资集中度、PMI 预期差、VIX 突变、A 股 / HK 龙头离散度、A 股涨跌停极端）
3. 无信号时静默，有信号时触发 Bull vs Bear 辩论
4. 生成三选一决策卡（long/short/neutral）
5. 数据锚定验证（查真实 API，不是模型互验）
6. 观点存入记忆库，自动衰减遗忘

**Mock 数据拒绝**：如果 AKShare / yfinance 抓取失败，系统会回退到 mock 数据，但此时 `_check_mock_block()` 会检测到 mock 来源、打印警报横幅，并以 **exit code 10** 拒绝生成决策卡。这是为了防止假数据导致错误的投资决策。代理未修通时运行会看到红色警报而非静默生成假卡。

### 3. 个股 Bull/Bear（A 股 / HK）

```bash
python main_stock.py 600989  # A 股 6 位代码
python main_stock.py 01810   # HK 5 位代码
```

流程：
1. 拉日 K（akshare）+ quote + 流通股本
2. 算 peistock 全集指标（BIAS 系列 / Yang-Zhang 波动 / CRI / GSI / MAHS-EMAHS / costDeviation 分位 / PVT 背离 / ADX）
3. 严格 B/S 信号检测（雪球大V口径：B(底背离) / B(恐慌) / S(顶背离) / S(贪婪)）
4. 抓近期新闻 + 公告（stock_news_em + stock_individual_notice_report）
5. Bull / Bear LLM 辩论（注入全部指标值 + 新闻原文）
6. 个股决策卡写入 `data/stock_decisions/<code>_<YYYYMMDD>.json`（含 news_context 字段）

### 4. 运行回测

```bash
# 使用模拟决策进行回测演示
python main_backtest.py --mock --start 2024-01-01 --end 2025-12-31

# 使用真实决策历史回测
python main_backtest.py --decisions data/decision_history.json --start 2024-01-01 --end 2025-12-31
```

回测输出示例：
```
============================================================
  BACKTEST RESULTS
============================================================

  Period:        2024-01-01 to 2025-12-31
  Total Trades:  15

  --- Combined ---
  Win Rate:      53.3%
  Avg PnL:       2.1%
  Avg Win:       5.8%
  Avg Loss:      -2.3%
  Max PnL:       12.4%
  Min PnL:       -5.1%
  Total PnL:     31.5%
  Kill Switch:   26.7%

  Report saved: data/backtest_report.json
```

## 文件结构

```
rebel_research/
├── main.py                  市场级日跑入口
├── main_stock.py            个股 CLI（A 股 / HK）
├── api_server.py            FastAPI（端口 8000，供 peistock 前端调用）
├── main_backtest.py         回测入口
├── panel.py                 Gradio 面板（SSE 流式输出 / 决策卡 / 记忆 / 回测 / 快照 / 个股）
├── deploy.sh                一键部署到 JD Cloud
├── config/
│   ├── rebel.yaml           配置：阈值、衰减率、分析师提示词
│   └── accounts.json        静态账号配置（account: password）
├── core/
│   ├── data_layer.py        真实数据层（AKShare A/HK + yfinance + mock fallback + mock 追踪 + NO_PROXY 检测）
│   ├── anomaly_trigger.py   异常检测 + 类型级 cooldown（7 类信号）
│   ├── bull_bear.py         对抗式分析师（市场级 + 个股级）
│   ├── indicators.py        peistock 指标引擎 Python 移植
│   ├── signal_detector.py   严格 B/S 信号（雪球大V口径）
│   ├── expectation_gap.py   预期差检测
│   ├── decision_card.py     三选一决策输出（市场卡 + 个股卡）
│   ├── decaying_memory.py   观点半衰期 + 墓碑机制
│   ├── fact_anchor.py       数据锚定验证
│   ├── news_fetcher.py      增量市场信息（akshare 个股新闻 / 公告 / 财联社快讯 + cninfo fallback）
│   ├── research_report.py   东方财富研报抓取与摘要
│   ├── financial_data.py    季度财报数据获取（akshare 业绩报表）
│   ├── backtest.py          历史回测引擎
│   ├── signal_backtest.py   信号级回测：逐日 B/S 信号持有统计 + 当前条件最相似历史日期对比
│   ├── watchlist_store.py   按账号隔离的股票池 JSON 存储（新账号继承默认配置）
│   ├── sector_context.py    行业分析师（贵金属/煤炭/电力等周期行业）
│   ├── metal_context.py     贵金属专项上下文（金价/铜价/美联储利率）
│   ├── preemption_scorer.py 跨财报窗口真空期定价分析
│   ├── agent_state.py       结构化信号存储（AnalystSignal + AgentState dataclass）
│   ├── risk_manager.py      零 LLM 规则风控层（共识/情绪/消化/波动率 4 维评分）
│   ├── chair_scorer.py      Chair 权重可配置计算器（读取 config/chair_weights.yaml）
│   ├── data_sandbox.py      安全 Python 代码执行环境（LLM 派生指标预处理）
│   ├── cninfo_api.py        巨潮资讯网公告抓取 fallback
│   └── evals/               轻量级策略评测框架（assertions / gate / runner + 边界测试 case）
├── institute/
│   ├── orchestrator.py      ResearchInstitute：YAML 角色加载 + 依赖注入 + 研报缓存
│   ├── vector_store.py      向量存储封装
│   ├── topic_generator.py   研报主题生成
│   └── fact_check.py        事实核查（验证报告中的数字声明）
├── roles/                   分析师角色 YAML 配置
│   ├── bull_agent.yaml      多头分析师
│   ├── bear_agent.yaml      空头分析师
│   ├── preemption.yaml      预判你的预判（信息消化评估）
│   ├── chair_debate.yaml    投委会裁决员（三维度综合裁决）
│   ├── macro.yaml           宏观分析师
│   ├── signal_monitor.yaml  信号监控员
│   └── ...
├── src/                     React 前端（与 peistock 仓库共享）
│   ├── App.tsx              主应用
│   ├── components/
│   │   ├── StockPool.tsx    股票池面板（localStorage 持久化）
│   │   ├── StockSearch.tsx  搜索 + AI 分析展示
│   │   ├── StockChart.tsx   K 线图
│   │   ├── ReportHistory.tsx 历史 AI 报告对比表格
│   │   ├── SignalBacktestPanel.tsx 信号级回测看板（逐日 B/S 信号持有统计）
│   │   └── ...
│   ├── data/
│   │   └── watchlist.ts     股票池数据层（localStorage CRUD）
│   └── utils/
│       ├── eastmoneyApi.ts  东方财富 API 封装
│       ├── researchApi.ts   RROS 后端 API 封装
│       └── indicators.ts    前端指标计算
├── data/                    运行时生成
│   ├── memory.db            SQLite 记忆库
│   ├── decision.json        最新市场级决策卡
│   ├── stock_decisions/     个股决策卡（<code>_<YYYYMMDD>.json）
│   ├── archives/            角色研报存档（<date>_<code>_<slug>.md）
│   ├── backtest_report.json 回测报告
│   ├── watchlists.json      各账号股票池（account → {stocks, categories}）
│   └── default_watchlist.json  154 只默认股票（新账号自动继承）
└── requirements.txt
```

## 核心机制详解

### 异常信号触发器

系统只在以下情况唤醒：

**美股 / 宏观**
- Mag7 离散度 > 35%
- 融资集中度 > 75%
- PMI 实际 vs 预期差 > 0.5
- VIX 日内变化 > 5

**A 股 / HK**
- A 股龙头（沪深 300 前 10）日内涨跌幅 std > 3%
- HK 科技龙头（00700 / 09988 等 8 票）日内涨跌幅 std > 3%
- A 股广度极端：涨停 ≥ 100 只 或 跌停 ≥ 30 只 或 涨家占比 <25% / >75%

**类型级 cooldown**：同类型信号 4 小时内不重复触发，不同类型信号允许插队。

**静默期**：每晚 22:00 - 次日 08:00 系统休眠。

### 个股五步链（peistock 指标 + LLM 投研）

`main_stock.py` 和 `api_server.py` 走以下流程：

1. `data_layer.get_stock_history(code)` 拉 300 天日 K（A 用 `stock_zh_a_hist`，HK 用 `stock_hk_hist`，前复权）
2. `indicators.calculate_all_indicators(hist, capital)` 输出 44 个指标字段，包括 BIAS 系列、CRI / GSI / MAHS-EMAHS、ADX、PVT 背离、Yang-Zhang 年化波动
3. `signal_detector.detect_signals(...)` 检测严格 B/S：B(底背离) / B(恐慌) / S(顶背离) / S(贪婪)
4. **Bull + Bear 并行分析**（`_inner_pool`）：各拿一遍指标摘要 + 信号 + 新闻 + 季度财报去生成独立报告。**Markdown + JSON 混合格式**：先输出完整 Markdown 分析报告（核心论点、催化剂/触发条件、上行/下行空间、置信度、风险、核心摘要等章节），末尾附带 JSON 结构化数据（signal/confidence/reasoning/key_metrics/thesis/kill_switch/max_loss）。`orchestrator.py` 的 `_strip_thinking_before_json` 自动过滤 JSON 前的模型思考过程泄露
5. **Phase 1.5 对抗辩论**（串行）：Bear Rebuttal 读 Bull 报告逐条反驳 → Bull Response 读 Rebuttal 回防并反击 → LLM 生成 Debate Summary 注入 Chair prompt
6. **Preemption + Sentiment + MacroIndustry 并行**（`_inner_pool`）：Preemption 读取 Bull/Bear 报告判断利好/利空是否已 Price-in（0-100 入场时机评分）；Sentiment 基于融资融券/换手/资金流向度量市场情绪；MacroIndustry 输出宏观环境 + 行业板块综合评分（-50 ~ +50）
7. **Risk Manager 风控评估**（零 LLM）：`core/risk_manager.py` 基于 Bull/Bear 置信度差、情绪极端值、信息消化度、20 日历史波动率计算综合风险分。HIGH 风险锁死 Chair confidence 上限 60；MEDIUM 风险建议半仓
8. **Chair（五维度裁决）**：综合 Bull/Bear/Preemption/Sentiment/MacroIndustry 五维度原始评分 + Risk Manager 约束出最终决策卡（LONG/SHORT/NEUTRAL + 止损位 + 持有期），写到 `data/stock_decisions/` 和 `data/archives/`。Chair 模型为 **deepseek-v4-pro**，其他角色为 deepseek-v4-flash

**指标引擎以 peistock 为准**：`core/indicators.py` 和 `core/signal_detector.py` 是 peistock TS 实现的 1:1 Python 移植。改公式时先去 peistock 改并验证，再同步本侧。

**角色纯 YAML 配置**：新增分析师只需在 `roles/` 下放 YAML（含 persona、tools、dependencies、output_template），`ResearchInstitute` 自动加载并按拓扑排序执行。无需改 Python 代码。

### 对抗式分析师 + 裁决机制

- **Bull**：必须找到"这次不一样"的论据，必须反驳当前看空叙事。**Markdown + JSON 混合格式**：先输出完整 Markdown 分析报告（核心论点、催化剂、最大上行空间、置信度、关键风险、核心摘要），末尾附带 JSON 结构化数据
- **Bear**：必须指出逻辑漏洞，必须量化最大损失。**Markdown + JSON 混合格式**：先输出完整 Markdown 分析报告（核心论点、触发条件、最大损失、置信度、潜在催化剂、核心摘要），末尾附带 JSON 结构化数据
- **Phase 1.5 对抗辩论**：Bear Rebuttal 逐条反驳 Bull 论据 → Bull Response 回防反击 → Debate Summary 注入 Chair，让 Chair 看到对抗张力而非单方报告
- **Preemption（预判你的预判）**：评估 Bull/Bear 提到的利好/利空是否已被股价提前消化。输出 0-100 入场时机评分（100=完全未消化，0=已被完全消化）。评分 <40 时提示"追涨/杀跌陷阱"
- **Sentiment（情绪行为分析师）**：基于融资融券/北向资金/龙虎榜/换手率度量市场情绪。识别"极度贪婪+机构流出"等逆向信号
- **MacroIndustry（宏观-行业联动分析师）**：输出宏观环境得分 + 行业板块得分，综合评分范围 -50 ~ +50
- **Risk Manager（零 LLM 风控层）**：在 Chair 调用前运行，4 维子风险归一化评分：
  - 共识风险 = abs(bull_conf - bear_conf)
  - 情绪极端风险 = 100 if sentiment >=80 or <=20 else 0
  - 信息消化风险 = 100 if entry_score <=30; 50 if <=50; else 0
  - 波动率风险 = 100 if hist_volatility >= 0.04 else 0
  - 加权总分 = consensus*0.3 + sentiment*0.3 + digestion*0.25 + volatility*0.15
  - HIGH(>=70) → 锁死 confidence 上限 60，收紧止损 30%
  - MEDIUM(>=40) → 半仓建议
  - LOW → 正常裁决
- **Chair（投委会裁决员）**：基于五维度原始评分 + Risk Manager 约束做最终裁决。Chair 模型为 **deepseek-v4-pro**，只输出原始评分和定性判断，不自行计算加权得分
- **ChairScorer（Python 层权重计算）**：`core/chair_scorer.py` 读取 `config/chair_weights.yaml` 计算最终决策。默认权重：Bull×0.30 + Preemption×0.30 − Bear×0.25 + MacroIndustry×0.15。信任 Chair 原始决策优先，不覆盖 Chair 明确给出的 NEUTRAL

### 增量市场信息（news_fetcher）

Bull/Bear 辩论除了拿到指标数字，还会拿到**最近 24h 的新闻原文**：

- 个股：`ak.stock_news_em(code)` 拉公司新闻 + `ak.stock_individual_notice_report(code)` 拉公告（A 股），HK 公告 akshare 不稳暂不拉
- 市场：`ak.stock_info_global_cls()` 拉财联社全球快讯

新闻 / 公告原文以 `news_context` 字段落盘到决策卡 JSON，回测时可知道辩论吃了什么材料。LLM prompt 会把每条新闻压成 `[time] title — content(source)` 单行喂进去。

代理对 `eastmoney.com` / `cls.cn` 不直连时，akshare 抓取失败 → 走 mock，辩论会退化为纯指标解读。详见已知坑。

### 预期差检测

不是分析"发生了什么"，而是分析：
1. 实际数据 vs 一致预期
2. 股价是否已反应（post-event return > 2% 认为已定价）
3. **缺口存在且未定价 = 可行动**

### 观点半衰期

| 观点类型 | 日衰减率 | 半衰期 |
|---------|---------|--------|
| 叙事型 | 70% | ~2 天 |
| 技术型 | 60% | ~1.5 天 |
| 宏观型 | 85% | ~4 天 |
| 财报型 | 95% | ~14 天 |

低于 30% 自动标记为"墓碑"，永久不再召回。

### 数据锚定验证

提取报告中的数字声明 → 查 AKShare/yfinance → 对比 delta。

不是问模型"你觉得对吗"，而是问 API"这个数字是多少"。

### 回测引擎

验证决策卡的历史表现：
- 根据 thesis 推断 ticker
- 按 entry_date 入场，按 holding_period 或 kill_switch 出场
- 统计胜率、平均盈亏、kill_switch 触发率
- 区分 long/short 分别统计

### Evals 评测框架

`core/evals/` 轻量级策略评测，在 Chair 决策后自动运行：
- **5 条断言**：format_valid（决策卡格式完整）、risk_compliance（Risk Manager HIGH 时 confidence ≤60）、data_coverage（关键字段非空）、confidence_reason_alignment（置信度与理由一致）、expected_decision_match（边界 case 预期决策匹配）
- **五维质量门**：quality、trigger、cost、latency、regression
- **12 条边界回归测试**：覆盖极端贪婪+SHORT、Preemption 陷阱、数据矛盾、风险合规等场景，存于 `data/evals/test_cases.jsonl`
- FAIL 仅记录日志，不阻断生产流程

### Data Sandbox 数据预处理

`core/data_sandbox.py` 安全 Python 代码执行环境：
- LLM 可生成数据预处理代码（MA20 斜率、振幅、量比等），在受限 locals 中执行
- 关键字黑名单用 `\b` 词边界匹配，5s 超时
- orchestrator 在注入 prompt 前调用 sandbox 计算派生指标
- 输出 stdout 捕获后注入 Chair/Bull/Bear 的 prompt

### AgentState 结构化通信

`core/agent_state.py` 替代 Markdown 正则解析：
- `AnalystSignal` dataclass：signal / confidence / reasoning / key_metrics / thesis / kill_switch / max_loss
- `AgentState` 容器：set_report / get_report / to_json / from_json / save / load
- 持久化到 `data/agent_states/{code}_{date}.json`
- Chair 和 Risk Manager 直接读取结构化数据，不再从 Markdown 中抓数字

### 前端功能（peistock 仓库）

**股票池管理**：
- 登录状态下前后端同步：`GET /api/watchlist` 拉取账号股票池覆盖 localStorage，用户操作后先写 localStorage 再 fire-and-forget 同步到后端。未登录走纯 localStorage 模式
- 新账号自动继承 `data/default_watchlist.json`（154 只默认股票）
- 按行业分类 tab 展示，支持自定义分类
- 添加股票时输入名称/拼音自动解析代码
- star 标记（替代旧收藏系统）
- 旧收藏 `peter_stock_favorites` 自动迁移

**搜索与分析**：
- 搜索框支持中文名称 / 拼音缩写搜索（通过后端代理东方财富 suggest API）
- AI 分析结果以卡片轮播展示，支持章节导航
- **3 天 AI 分析冷却**：同一股票 3 天内已有 Chair 报告缓存则直接返回，不重复调用 LLM，跨账号共享结果
- 历史 AI 报告对比表格：日期为行，Bull/Bear/Preemption/Sentiment/Chair 为列。移动端支持点击展开完整报告（Tooltip 在触屏设备上无 hover）

**数据源**：
- 东方财富 API（主）+ 腾讯财经 API（备）
- 本地开发 Vite 代理 `/api/research` → `localhost:8000`
- 生产环境直连 `research.peistock.win`

## 成本

**零 API 成本**（如果使用本地模式）或 **~$85-160/月**（国产模型）。

回测需要 yfinance 下载历史数据，免费。

## 扩展建议

1. 接入国产 LLM API（DeepSeek/Kimi/Qwen）
2. Ollama 本地模型支持
3. 更多异常信号（板块背离、个股 vs 指数背离）
4. 决策卡自动累积到 history，持续回测验证
5. Web 面板可视化回测曲线

## License

MIT - 仅供学习研究使用。
