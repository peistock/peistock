# CLAUDE.md — RebelResearchOS

> 给 AI 协作者快速建立项目认知用。通用偏好(沟通、红线)见 `~/CLAUDE.md`,本文件只写项目特有规则。

## 项目身份

反共识 AI 研究系统。三个分析师(Bull / Bear / Preemption)在异常信号触发时输出独立报告,由投委会裁决员(Chair)综合出三选一决策卡(long / short / neutral)。带衰减记忆 + 数据锚定 fact-check + 历史回测。

**两条主线**:
1. **市场级**(`main.py`):mag7 离散度 / VIX / PMI / 融资集中度 / A 股 / HK 龙头离散度 / 涨跌停极端 触发宏观辩论(+ 财联社快讯注入 prompt)
2. **个股级**(`main_stock.py` / `api_server.py`):A 股 6 位 / HK 5 位代码,拉日 K 算 peistock 指标 + 严格 B/S 信号 + 近期新闻/公告 + 季度财报 → Bull/Bear 并行分析 → Preemption/Sentiment 并行分析 → Chair(五维度裁决) → 个股决策卡

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

## 不可触碰区

- **`institute/mind/` 自包含 LLM 客户端**：从 FamilyMind 移植的 `llm_client.py` + `agent_message.py`，所有角色统一走单轮调用。如需修改 LLM 调用逻辑，直接改 `institute/mind/llm_client.py`
- **`data/memory.db`**:SQLite 衰减记忆库,删了等于丢失「观点半衰期」状态。**只能 read + insert + decay**,不要 DROP
- **`data/decision.json` / `data/stock_decisions/`**:历史决策档,做回测和长期评估用,不要批量清
- **`config/rebel.yaml` 的阈值**:改之前先看 `core/anomaly_trigger.py` 的判断分支,别只改 yaml 不改代码逻辑

## 架构约束

- **数据层带 mock fallback + mock 追踪拒绝**:`core/data_layer.py` 所有外部数据方法都有 `_mock_*` 兜底,同时记录到 `self._mock_sources` set。`main.py` / `main_stock.py` 在生成决策卡前调用 `_check_mock_block()`,若检测到 mock 数据则打印警报横幅并以 exit code 10 拒绝生成,防止假数据导致错误投资决策。新增数据源时保留 mock fallback 模式,并确保 mock 路径调用 `self._mock_sources.add("source_name")`
- **股票池 localStorage 持久化（浏览器端）**：`src/data/watchlist.ts` 保留硬编码 `DEFAULT_WATCHLIST` 作为首次访问的初始数据，后续读写走 `localStorage`（key: `rros_stock_pool`）。支持 CRUD：添加（名称/拼音自动解析代码）、删除、star 标记、分类切换。分类列表也持久化（key: `rros_stock_pool_categories`）。旧收藏 `peter_stock_favorites` 自动迁移到股票池并标记 star。
- **个股数据走腾讯 API 直连，不走本地 peistock API**:`institute/orchestrator.py` 的 `_fetch_peistock_data` 优先 HTTP 连本地 peistock API（开发环境），失败后回退到 `_fetch_tencent_indicators` 直连腾讯财经 API（`web.ifzq.gtimg.cn`）获取 K 线 + 实时行情，本地 Python 指标引擎计算。生产环境 JD Cloud 无本地 peistock API，全部走腾讯 API。此设计避免了 akshare /mock 数据导致 AI 报告指标值失真（曾出现 MAHS/EMAHS 30% 偏差、CRI 相差 18 倍的数据质量事故）
- **`query_peistock` 工具已移除**:原 `query_peistock` 工具让 LLM 自行调用本地 API，但生产环境 Connection Refused 导致分析失败。现已从所有 `roles/*.yaml` 的 tools 列表移除。技术指标由 orchestrator 预注入 prompt，LLM 无需再调工具
- **AgentLoop 框架已移除**:原 FamilyMind 的多轮对话框架（intent 分类、tool calling 循环、guardrail、todo store）对 RROS 单轮报告场景是纯粹 overhead。现所有角色统一走 `LLMClient.chat_messages()` 单轮调用，`institute/mind/` 从 16 个文件精简到 2 个（`llm_client.py` + `agent_message.py`）
- **信号级回测看板**:新增 `core/signal_backtest.py`，直连腾讯 API 获取 500 天 K 线，本地 Python 指标引擎逐日检测 B/S 信号，计算每个信号的持有期统计（最大收益、最大回撤、至今收益）。同时用当前 CRI + 成本偏离分位的欧氏距离匹配历史最接近日期做对比回测。前端 `SignalBacktestPanel.tsx` 展示。信号检测逻辑与前端 K 线图严格对齐（底背离只标连续段最后一天、顶背离只标第一天、做空 S 信号逻辑）
- **季度财报数据预注入**:新增 `core/financial_data.py`，通过 akshare `stock_yjbb_em` 拉取最新季度财报（营收、净利润、同比/环比增速、毛利率、ROE），以 Markdown 格式注入 Bull/Bear/Preemption/Chair 的 prompt。LLM 严禁基于趋势推演猜测财报数据，必须使用已披露的实际数字
- **个股决策卡先不入 memory.db**:`generate_stock_card` 只写文件,不持久化到衰减记忆。原因:个股卡和市场卡的 `claim_type` 体系还没统一,先存盘观察
- **api_server 决策卡解析**:Chair 报告生成后，`_generate_stock_decision_card` 从 Markdown 内容正则提取 decision/conviction/thesis/kill_switch 等字段，写入 `data/stock_decisions/<code>_<date>.json`，供 `recent_decisions` 和前端历史报告接口使用
- **市场 anomaly 走 `AnomalySignal` dataclass**:新增触发器在 `core/anomaly_trigger.py` 加分支,严重程度走 `severity = "high"|"medium"`,cooldown 走 `last_trigger_by_type` 字典
- **个股级走四步链，Bull/Bear 并行 + Preemption/Sentiment 并行**:Bull 和 Bear 无相互依赖，通过 `_inner_pool` 并行执行；Preemption 和 Sentiment 均依赖 Bull+Bear 报告，并行执行；Chair 依赖四者，串行。总耗时 ~3-4min。`_LLMProxy` 为每个任务临时覆盖 `reasoning_effort`，避免 `_bg_pool` 多线程共享 LLM 单例导致配置互相覆盖
- **报告缓存按 date+code 分文件名**:orchestrator.py 在 `run_analyst` 中读取 `context["code"]`，生成 `{date_str}_{code}_{slug}.md`，避免同日多票串缓存
- **个股角色纯 YAML 配置，不硬编码**:新增分析师只需在 `roles/` 下放 YAML，ResearchInstitute 自动加载。依赖关系走 `dependencies` 字段，orchestrator 自动按拓扑排序注入上游报告
- **`.env` 本地配置**：`api_server.py` / `main.py` / `main_stock.py` 启动时加载项目根目录 `.env`，配置 LLM 端点。`LLMClient` 默认连 LM Studio (localhost:1234)，必须通过 `.env` 覆盖为实际端点。`_get_institute()` 用双检锁防止 FastAPI 多线程并发重复初始化
- **个股 Bull/Bear/Preemption/Chair 复用 `roles/*.yaml` 的 persona**:`config/rebel.yaml` 里那对通用 prompt 对市场级够用；个股级角色单独在 `roles/` 下维护 YAML，不混用
- **指标计算**:`calculate_all_indicators` 接受 DataFrame 或 List[Dict] 都行,内部统一转 List[Dict] 处理,返回 List[Dict],每行一天
- **新闻注入辩论**:`core/news_fetcher.py` 提供 `fetch_stock_news` / `fetch_stock_notices` / `fetch_macro_news`,失败走 mock。`analyze_stock` / `analyze_bull` / `analyze_bear` 接 `news=` 参数透传到 prompt;`generate_*_card` 接 `news=` 把原文落盘到卡的 `news_context` 字段。**news 是可选参数**(None 时降级为纯指标 prompt),老调用点不传不会断

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
- **AgentLoop 已移除，所有角色单轮调用**：`institute/mind/` 从 FamilyMind 移植的 16 个文件（agent_loop.py、tools.py、todo_store.py 等）已全部删除，只保留 `llm_client.py` + `agent_message.py`。个股分析链（Bull/Bear/Preemption/Sentiment/Chair）统一走 `LLMClient.chat_messages()` 单轮调用。如未来需要多轮 tool calling，直接基于 `openai` SDK 原生实现，不再维护自定义框架。
