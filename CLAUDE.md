# CLAUDE.md — RebelResearchOS

> 给 AI 协作者快速建立项目认知用。通用偏好(沟通、红线)见 `~/CLAUDE.md`,本文件只写项目特有规则。

## 项目身份

反共识 AI 研究系统。五个分析师(Bull / Bear / Preemption / Sentiment / MacroIndustry)在异常信号触发时输出独立报告,由投委会裁决员(Chair)综合出三选一决策卡(long / short / neutral)。带衰减记忆 + 数据锚定 fact-check + 历史回测 + 零 LLM 风控层。

**两条主线**:
1. **市场级**(`main.py`):mag7 离散度 / VIX / PMI / 融资集中度 / A 股 / HK 龙头离散度 / 涨跌停极端 触发宏观辩论(+ 财联社快讯注入 prompt)
2. **个股级**(`main_stock.py` / `api_server.py`):A 股 6 位 / HK 5 位代码,拉日 K 算 peistock 指标 + 严格 B/S 信号 + 近期新闻/公告 + 季度财报 → Bull/Bear 并行分析 → **Phase 1.5 对抗辩论**(Bear Rebuttal → Bull Response) → Preemption/Sentiment/MacroIndustry 并行分析 → **Risk Manager 风控评估** → Chair(五维度裁决) → 个股决策卡

## 运行方式

项目已自包含，不再依赖外部 `~/family-mind`。LLM 配置走本地 `.env`：

```bash
cd ~/rebel_research
.venv/bin/python main.py                                   # 市场级日跑
.venv/bin/python main_stock.py 600989                      # 个股 A 股
.venv/bin/python main_stock.py 01810                       # 个股 HK
.venv/bin/python main_backtest.py --mock                   # 回测(不调 LLM)
.venv/bin/python panel.py                                  # Gradio 面板 http://localhost:7862
.venv/bin/uvicorn api_server:app --port 8000              # FastAPI（本地开发）
```

**生产部署**（JD Cloud 服务器）：
```bash
cd /opt/rebel_research
mkdir -p logs
nohup .venv/bin/uvicorn api_server:app --host 0.0.0.0 --port 8000 > logs/api.log 2>&1 &
```
前端通过 Cloudflare Tunnel 代理到 `research.peistock.win`，绕过 JD Cloud 代理屏蔽。

**前端部署**（peistock 仓库）：
- 前端代码在 `peistock` 仓库（`github.com/peistock/peistock`），EdgeOne Pages 自动构建
- rebel_research 的 `src/` 代码变更需同步到 peistock 仓库后 push，触发 EdgeOne 自动部署
- 本地开发时 Vite 代理 `/api/research` → `http://localhost:8000`；生产环境直接请求 `research.peistock.win`

注:`panel.py` 内部用 subprocess 起 `main.py` / `main_stock.py`，已不需要额外 PYTHONPATH。

## 外部依赖

- **`.env`**：项目根目录 `.env` 配置 LLM 端点（`LLM_BASE_URL`、`LLM_API_KEY`、`MODEL_DAILY` 等）。`institute/mind/llm_client.py` 直接读取，无需外部项目
- **akshare ≥ 1.18**(A 股 / HK 数据):个股 K 线、龙头 spot、涨跌停池、CSI300 成分;**也是新闻源**:`stock_news_em` 个股新闻 / `stock_individual_notice_report` 公告 / `stock_info_global_cls` 财联社快讯
- **yfinance**(mag7 / VIX 等美股)
- **peistock**(`~/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock`):**指标引擎的 source-of-truth**,`core/indicators.py` 和 `core/signal_detector.py` 是 TS → Python 的 1:1 移植。改公式时**先去 peistock 改,再同步本侧**,别在 Python 端单方面"优化"。

## 路由清单(入口)

| 入口 | 用途 | LLM | 写盘 | 退出码 |
|---|---|---|---|---|
| `main.py` | 市场级日跑 | ✓ | `data/decision.json` + memory.db | 0=正常, 10=mock 数据拒绝生成 |
| `main_stock.py <code>` | 个股 CLI(Bull/Bear/Preemption/Sentiment/Chair) | ✓ | `data/stock_decisions/<code>_<YYYYMMDD>.json` | 0=正常, 10=mock 数据拒绝生成 |
| `api_server.py` | FastAPI(端口 8000,供 peistock 前端调用) | ✓ | `data/archives/<date>_<code>_<slug>.md` | N/A(HTTP 状态码) |
| `main_backtest.py` | 历史回测 | ✗ | `data/backtest_report.json` | 0 |
| `panel.py` | Gradio 面板(端口 7862) | 间接(subprocess) | 同上 | 0 |

**新增 API 路由**:
| 路由 | 说明 |
|---|---|
| `POST /api/analyze/stock/{code}` | 提交个股分析任务，返回 task_id |
| `GET /api/tasks/{task_id}` | 轮询查询分析状态与结果 |
| `GET /api/decisions/recent` | 最近决策列表 |
| `GET /api/signals/latest` | 最新异常信号 |
| `GET /api/memory/active` | 活跃观点（衰减后 >30%） |
| `GET /api/roles` | 列出所有加载的角色 |
| `GET /api/search/stock?q=` | 代理东方财富搜索（名称/拼音 → 代码） |
| `GET /api/stock/{code}/report-history` | 查询个股历史 AI 分析报告摘要 |
| `GET /api/backtest/signals/{code}` | 信号级回测：逐日 B/S 信号持有统计 + 当前条件最相似历史日期回测 |
| `GET /api/backtest/summary` | 全局回测统计（按置信度/Preemption 条件分组） |
| `GET /api/backtest/stock/{code}` | 单股票回测统计和最近交易记录 |
| `GET /api/watchlist` | 获取当前账号的股票池（需 `X-Account` / `X-Password` header） |
| `POST /api/watchlist` | 保存当前账号的股票池（需认证 header） |

**账号认证**：`api_server.py` 读取 `config/accounts.json`（`{"account": "password"}` 格式），所有 watchlist 端点通过 `X-Account` + `X-Password` header 鉴权。未认证请求返回 401。账号相互隔离，各自的股票池存于 `data/watchlists.json`。|

## 不可触碰区

- **`institute/mind/` 自包含 LLM 客户端**：从 FamilyMind 移植的 `llm_client.py` + `agent_message.py`，所有角色统一走单轮调用。如需修改 LLM 调用逻辑，直接改 `institute/mind/llm_client.py`
- **`data/memory.db`**:SQLite 衰减记忆库,删了等于丢失「观点半衰期」状态。**只能 read + insert + decay**,不要 DROP
- **`data/decision.json` / `data/stock_decisions/`**:历史决策档,做回测和长期评估用,不要批量清
- **`config/rebel.yaml` 的阈值**:改之前先看 `core/anomaly_trigger.py` 的判断分支,别只改 yaml 不改代码逻辑

## 架构约束

- **数据层带 mock fallback + mock 追踪拒绝**:`core/data_layer.py` 所有外部数据方法都有 `_mock_*` 兜底,同时记录到 `self._mock_sources` set。`main.py` / `main_stock.py` 在生成决策卡前调用 `_check_mock_block()`,若检测到 mock 数据则打印警报横幅并以 exit code 10 拒绝生成,防止假数据导致错误投资决策。新增数据源时保留 mock fallback 模式,并确保 mock 路径调用 `self._mock_sources.add("source_name")`
- **股票池 localStorage + 后端同步**：`src/data/watchlist.ts` 保留硬编码 `DEFAULT_WATCHLIST` 作为首次访问的初始数据。登录状态下，前端先从后端 `GET /api/watchlist` 拉取账号股票池（覆盖 localStorage），用户操作后先写 localStorage（key: `rros_stock_pool`），再 fire-and-forget 同步到后端 `POST /api/watchlist`。未登录时仍走纯 localStorage 模式。后端 `core/watchlist_store.py` 按账号隔离存储于 `data/watchlists.json`，新账号自动继承 `data/default_watchlist.json`（154 只默认股票）。账号体系走 `config/accounts.json` 静态配置（`admin/admin`、`guest1/guest1`、`guest2/guest2`）。
- **个股数据走腾讯 API 直连，不走本地 peistock API**:`institute/orchestrator.py` 的 `_fetch_peistock_data` 优先 HTTP 连本地 peistock API（开发环境），失败后回退到 `_fetch_tencent_indicators` 直连腾讯财经 API（`web.ifzq.gtimg.cn`）获取 K 线 + 实时行情，本地 Python 指标引擎计算。生产环境 JD Cloud 无本地 peistock API，全部走腾讯 API。此设计避免了 akshare /mock 数据导致 AI 报告指标值失真（曾出现 MAHS/EMAHS 30% 偏差、CRI 相差 18 倍的数据质量事故）
- **`query_peistock` 工具已移除**:原 `query_peistock` 工具让 LLM 自行调用本地 API，但生产环境 Connection Refused 导致分析失败。现已从所有 `roles/*.yaml` 的 tools 列表移除。技术指标由 orchestrator 预注入 prompt，LLM 无需再调工具
- **AgentLoop 框架已移除**:原 FamilyMind 的多轮对话框架（intent 分类、tool calling 循环、guardrail、todo store）对 RROS 单轮报告场景是纯粹 overhead。现所有角色统一走 `LLMClient.chat_messages()` 单轮调用，`institute/mind/` 从 16 个文件精简到 2 个（`llm_client.py` + `agent_message.py`）
- **信号级回测看板**:新增 `core/signal_backtest.py`，直连腾讯 API 获取 500 天 K 线，本地 Python 指标引擎逐日检测 B/S 信号，计算每个信号的持有期统计（最大收益、最大回撤、至今收益）。同时用当前 CRI + 成本偏离分位的欧氏距离匹配历史最接近日期做对比回测。前端 `SignalBacktestPanel.tsx` 展示。信号检测逻辑与前端 K 线图严格对齐（底背离只标连续段最后一天、顶背离只标第一天、做空 S 信号逻辑）
- **季度财报数据预注入**:新增 `core/financial_data.py`，通过 akshare `stock_yjbb_em` 拉取最新季度财报（营收、净利润、同比/环比增速、毛利率、ROE），以 Markdown 格式注入 Bull/Bear/Preemption/Chair 的 prompt。LLM 严禁基于趋势推演猜测财报数据，必须使用已披露的实际数字
- **个股决策卡先不入 memory.db**:`generate_stock_card` 只写文件,不持久化到衰减记忆。原因:个股卡和市场卡的 `claim_type` 体系还没统一,先存盘观察
- **3 天 AI 分析冷却**：`api_server.py` 的 `analyze_stock` 在提交任务前调用 `_find_recent_cache(code, days=3)`，检查 `data/archives/` 中是否存在 3 天内同一股票的 Chair 报告缓存。若存在，直接返回缓存中的 conviction/decision/report_preview，不创建新 LLM 任务。避免同一股票在短时间内被重复分析，降低 API 成本。
- **AI 分析结果跨账号共享**：分析缓存和决策卡 `data/stock_decisions/` 按 `code_date` 存储，不隔离账号。任何账号查询某股的 AI 分析，如果 3 天内已有缓存，所有账号共享同一份结果。
- **api_server 决策卡解析**:Chair 报告生成后，`_generate_stock_decision_card` 从 Markdown 内容正则提取 decision/conviction/thesis/kill_switch 等字段，写入 `data/stock_decisions/<code>_<date>.json`，供 `recent_decisions` 和前端历史报告接口使用
- **市场 anomaly 走 `AnomalySignal` dataclass**:新增触发器在 `core/anomaly_trigger.py` 加分支,严重程度走 `severity = "high"|"medium"`,cooldown 走 `last_trigger_by_type` 字典
- **个股级走五步链，Bull/Bear 并行 → Debate 串行 → Preemption/Sentiment/MacroIndustry 并行 → Risk Manager → Chair**:Bull 和 Bear 无相互依赖，通过 `_inner_pool` 并行执行；Debate（Bear Rebuttal → Bull Response → Summary）串行；Preemption/Sentiment/MacroIndustry 均依赖 Bull+Bear+Debate，通过 `_inner_pool` 并行执行；Risk Manager 在 Chair 之前运行（零 LLM）；Chair 串行。总耗时 ~4-5min。`_LLMProxy` 为每个任务临时覆盖 `reasoning_effort`，避免 `_bg_pool` 多线程共享 LLM 单例导致配置互相覆盖。**Preemption 重试**：`api_server.py` Phase 2 后检测 Preemption 报告是否过短（<500 字符或包含"报告生成失败"），若异常则自动重试最多 2 次，缓解 DeepSeek API 偶发返回空/短内容的问题
- **报告缓存按 date+code 分文件名**:orchestrator.py 在 `run_analyst` 中读取 `context["code"]`，生成 `{date_str}_{code}_{slug}.md`，避免同日多票串缓存
- **个股角色纯 YAML 配置，不硬编码**:新增分析师只需在 `roles/` 下放 YAML，ResearchInstitute 自动加载。依赖关系走 `dependencies` 字段，orchestrator 自动按拓扑排序注入上游报告
- **`.env` 本地配置**：`api_server.py` / `main.py` / `main_stock.py` 启动时加载项目根目录 `.env`，配置 LLM 端点。`LLMClient` 默认连 LM Studio (localhost:1234)，必须通过 `.env` 覆盖为实际端点。`_get_institute()` 用双检锁防止 FastAPI 多线程并发重复初始化
- **个股 Bull/Bear/Preemption/Chair 复用 `roles/*.yaml` 的 persona**:`config/rebel.yaml` 里那对通用 prompt 对市场级够用；个股级角色单独在 `roles/` 下维护 YAML，不混用
- **指标计算**:`calculate_all_indicators` 接受 DataFrame 或 List[Dict] 都行,内部统一转 List[Dict] 处理,返回 List[Dict],每行一天
- **新闻注入辩论**:`core/news_fetcher.py` 提供 `fetch_stock_news` / `fetch_stock_notices` / `fetch_macro_news`,失败走 mock。`analyze_stock` / `analyze_bull` / `analyze_bear` 接 `news=` 参数透传到 prompt;`generate_*_card` 接 `news=` 把原文落盘到卡的 `news_context` 字段。**news 是可选参数**(None 时降级为纯指标 prompt),老调用点不传不会断
- **Phase 1.5 对抗辩论**：Bull/Bear 并行后，Bear Rebuttal 读 Bull 报告逐条反驳，Bull Response 读 Rebuttal 逐条回防，LLM 生成 Debate Summary 注入 Chair prompt。生成摘要使用 deepseek-v4-flash（与 Bull/Bear 同模型），Chair 使用 deepseek-v4-pro
- **Bull/Bear Markdown + JSON 混合格式**：`roles/bull_agent.yaml` 和 `roles/bear_agent.yaml` 的 persona 要求先输出完整 Markdown 分析报告（核心论点、催化剂/触发条件、上行/下行空间、置信度、风险、核心摘要等章节），然后在报告末尾附带 JSON 结构化数据。`api_server.py` 的 `_extract_summary` 优先从 JSON 解析 `thesis`/`reasoning` 字段供前端展示，`AgentState` 从 JSON 提取结构化信号。`orchestrator.py` 的 `_strip_thinking_before_json` 自动截断 JSON 前面的模型思考过程泄露，确保报告干净
- **AgentState 结构化通信**：`core/agent_state.py` 的 `AnalystSignal` + `AgentState` dataclass 统一存储各角色信号，持久化到 `data/agent_states/{code}_{date}.json`。Chair 和 Risk Manager 直接读取结构化数据，不再从 Markdown 中抓数字
- **ChairScorer 权重可配置**：`core/chair_scorer.py` 读取 `config/chair_weights.yaml` 计算最终决策。Chair 只输出五维度原始评分和定性判断，Python 层做加权计算。默认权重：Bull 0.30 + Preemption 0.30 - Bear 0.25 + MacroIndustry 0.15。**信任 Chair 原始决策优先**：若 Chair 明确给出 NEUTRAL，ChairScorer 不覆盖（曾出现 extreme_fear 过滤把 NEUTRAL 强行改为 LONG 的冲突）
- **Risk Manager 零 LLM 风控**：`core/risk_manager.py` 在 Chair 调用 LLM 之前运行，纯规则计算 4 维子风险（共识/情绪/消化/波动率）加权总分。HIGH(>=70) 风险锁死 Chair confidence 上限 60、收紧止损 30%；MEDIUM(>=40) 半仓建议；LOW 正常裁决。风控评估通过 `risk_assessment` 字段注入 Chair prompt，Chair 必须遵守
- **Evals 自动评测**：`core/evals/` 在 Chair 决策后自动运行（`evaluate_current_decision`），包含 5 条断言（format_valid、risk_compliance、data_coverage、confidence_reason_alignment、expected_decision_match）和 12 条边界回归 case。FAIL 仅记录日志不阻断流程
- **Data Sandbox 安全执行**：`core/data_sandbox.py` 为 LLM 提供受限 Python 执行环境预处理派生指标（MA20 斜率、振幅、量比等）。关键字黑名单必须用 `\b` 词边界匹配（不能用 substring，否则 "os" 会误杀 "close"），5s 超时（`signal.alarm`），stdout 捕获。数据变量注入用 `sandbox_locals["data"] = data`，不能用 `update(data)` 展开
- **cninfo 公告 fallback**：`core/cninfo_api.py` 在 akshare `stock_individual_notice_report` 失败时回退到巨潮资讯网 API（`www.cninfo.com.cn/new/hisAnnouncement/query`）。A 股代码规则：60/68/88/89 开头 → `.SH`，其他 → `.SZ`

## 改完跑什么

```bash
# 快速烟测:三层全过一遍
.venv/bin/python -c "
from core.data_layer import DataLayer
from core.indicators import calculate_all_indicators
from core.signal_detector import detect_signals, build_signal_input
dl = DataLayer()
hist = dl._mock_stock_history('600989', 400)  # 用 mock 避免网络
ind = calculate_all_indicators(hist, 7e9)
print('indicators OK, last bias225_pct:', ind[-1]['bias225_percentile'])
sig = detect_signals(build_signal_input(ind))
print('signal:', sig)
"

# 个股 CLI 端到端(代理正常时)
.venv/bin/python main_stock.py 600989

# Mock 数据拒绝烟测(不设 NO_PROXY 让 akshare 走 mock,应 exit 10)
.venv/bin/python main_stock.py 600989; echo "exit=$?"  # 应输出 exit=10

# 新闻抓取烟测(代理不通时返 mock,不报错)
NO_PROXY="*" .venv/bin/python -c "
from core.news_fetcher import fetch_stock_news, fetch_macro_news, summarize_for_prompt
n = fetch_stock_news('600989', 'a', limit=3)
print('stock news first source:', n[0]['source'])  # mock 表示代理屏蔽
m = fetch_macro_news(limit=3)
print('macro news first source:', m[0]['source'])
print(summarize_for_prompt(n, max_items=2))
"

# 面板 import + SSE 流式验证
.venv/bin/python -c "import panel; panel.build_ui(); print('panel OK')"
# 启动面板后,点"检查今日大盘"或"分析个股",观察 Log 窗口是否实时滚动而非卡住 30 秒后一次性输出

# api_server 冒烟(.env 已配置前提下)
.venv/bin/python -c "
import api_server
print('api_server import OK')
# 验证 LLM 连接(不真跑分析,只测初始化)
inst = api_server._get_institute()
print('ResearchInstitute OK, roles:', list(inst.roles.keys()))
"
# 启动后: curl http://localhost:8000/health && curl http://localhost:8000/api/roles
```

## 已知坑

- **本机代理(`scutil --proxy` 显示 `127.0.0.1:17890`)对国内 akshare 域名是死路**:`push2.eastmoney.com` / `www.cls.cn` 走代理会被远端断连。修法是在代理软件(Clash/V2Ray)里把 `*.eastmoney.com` / `*.cls.cn` / `*.sse.com.cn` / `*.szse.cn` 加直连规则,或临时 `export NO_PROXY="*"` 让 akshare 全部直连(但代理软件得尊重 NO_PROXY)。代理没修通时所有 akshare 调用走 mock,流程不会断但数据是假的(`get_stock_quote('600989')['name']` 会返回 `MOCK-600989`,`fetch_stock_news` 返回 mock 占位),要识别。**mock 数据会触发拒绝机制 → 决策卡不会生成,防止错误投资**
- **Mock 数据陷阱（数据质量红线）**:`DataLayer.get_stock_history()` 在 akshare 失败时会回退到 `_mock_stock_history()`，生成合成随机数据。mock 数据的 MAHS/EMAHS/CRI 与真实数据可能偏差 30%+，曾导致 AI 报告出现"Bull 用 MAHS=32.48 而实际=24.16"的自相矛盾。修复方式：orchestrator 的 `_fetch_tencent_indicators` 直连腾讯 API（`web.ifzq.gtimg.cn`）获取真实 K 线，本地 Python 指标引擎计算，完全绕过 akshare/mock 路径
- **HK 个股流通股 akshare 不稳**:`core/data_layer.py:HK_CAPITAL_OVERRIDES` 硬编码了 HSI 主要龙头,未收录的票走 5e9 兜底(明显偏离实际)。新加 HK 票之前先看这张表。**signal_backtest.py 已绕过 DataLayer**，直接从腾讯 API `qt[70]`（港股）/`qt[72]`（A股）提取流通股本，与前端口径一致
- **HK 流通股索引（腾讯 API）**:港股 qt 数组中，**流通股本在索引 70**（`qt[70]`），索引 69 是总股本。曾误用 69 导致 DD 值计算为 500（应为 ~80）。A 股流通股本在索引 72（`qt[72]`）。orchestrator 的 `_fetch_tencent_indicators` 已正确区分
- **腾讯 API 返回字段类型**:`qt[70]` / `qt[72]` 返回的是带小数点的字符串（如 `'95912.000'`），Python `int()` 会报错。必须用 `int(float(qt[70]))`。同理 K 线成交量 `item[5]` 也可能带小数点
- **`main.py` 的 `quiet_hours`(22-7)默认开**:晚上跑会 silent 退出,看不到日志。手动测时在 `config/rebel.yaml` 临时设 `quiet_hours: []`,测完恢复
- **akshare spot 表延迟 3-15 分钟**:`get_stock_quote` 不是真实时,面板会标 timestamp,别假装是 tick 级数据
- **panel.py 长任务 SSE 心跳**:`subprocess.run` 会阻塞 20-40 秒,Gradio SSE 连接可能超时断开。已改用 `subprocess.Popen` 流式读取,每 0.3s yield 一次 log tail,保持连接活跃。改动 `panel.py` 的 `_stream_subprocess` 时注意保留 `PYTHONUNBUFFERED=1` 和 `bufsize=1`
- **腾讯 K-line high/low 映射**：腾讯 API 返回的日 K 线数组中，`item[3]` 是最高价（high），`item[4]` 是最低价（low），不是反过来。`core/signal_backtest.py` 和 `institute/orchestrator.py` 的 `_fetch_tencent_klines()` 已修正，前端 `tencentApi.ts` 也已修正。若 high/low 写反，会导致 Yang-Zhang 波动、成本偏离等指标计算失真。
- **AgentLoop 已移除，所有角色单轮调用**：`institute/mind/` 从 FamilyMind 移植的 16 个文件（agent_loop.py、tools.py、todo_store.py 等）已全部删除，只保留 `llm_client.py` + `agent_message.py`。个股分析链（Bull/Bear/Preemption/Sentiment/Chair）统一走 `LLMClient.chat_messages()` 单轮调用。如未来需要多轮 tool calling，直接基于 `openai` SDK 原生实现，不再维护自定义框架。
- **Data Sandbox 黑名单词边界**：`core/data_sandbox.py` 的关键字黑名单必须用 `\bword\b` 正则词边界匹配，不能用 `word in lower` substring 判断。曾出现 "os" 黑名单误杀 "close" 变量名，导致 K 线预处理代码无法引用 `close` 列表
- **AgentState 数据变量注入**：`DataSandbox.execute()` 中注入数据变量必须用 `sandbox_locals["data"] = data`，不能用 `sandbox_locals.update(data)`——后者会把 dict 的 key 展开成独立局部变量（如 `sandbox_locals["close"] = [...]`），破坏 LLM 生成的代码预期（代码里写的是 `data["close"]`）
- **ChairScorer 与 Chair 原始决策冲突**：`core/chair_scorer.py` 的 extreme_fear 过滤（score>10 → LONG）可能与 Chair 明确给出的 NEUTRAL 冲突。修复方案：信任 Chair 原始决策优先，ChairScorer 仅在 Chair 未明确给出方向时作为 fallback。不要覆盖 Chair 的 NEUTRAL
- **Sentiment 正则跨行匹配**：`_extract_sentiment` 曾用 `(.+?)(?=\n-|\n##|\n\s*$)` 匹配，会跨行吞掉后续内容。修复：用 `([^\n]+)` 限制单行匹配。所有 Markdown 字段提取都要注意边界贪婪问题
- **Bull/Bear 思考过程泄露过滤**：`deepseek-v4-flash` 等模型常在 JSON 前输出中文思考过程（如"好的，用户让我完成..."）。`orchestrator.py` 的 `_strip_thinking_before_json` 自动检测并截断 JSON 前面的思考内容，确保最终报告干净。若过滤失败导致 `_extract_summary` 抓到思考过程，`api_server.py` 会回退到 JSON 字段提取
- **Debate 摘要生成模型**：Debate Summary 使用 deepseek-v4-flash（与 Bull/Bear 同模型），Chair 使用 deepseek-v4-pro。两个模型同 endpoint 但不同 alias，通过 `MODEL_ENV_ALIASES` 路由。不要给 Summary 也用 pro，那是浪费
