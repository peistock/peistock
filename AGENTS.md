# Peter趋势交易系统 - 开发规范

## 核心规则

### 部署规则
- **rebel_research**：用户说「push 到 git」时，自动执行 `./deploy.sh` 部署到 JD Cloud，无需二次确认
  - `deploy.sh` 已改用 systemd 管理：rsync 排除 `.env` → 同步 `LLM_*` / `MODEL_*` 到远程 → `systemctl restart rebel-research`
  - 远程 `.env` 独立维护，不被 rsync 覆盖；LLM 环境变量通过 systemd `EnvironmentFile` 持久化
- **peistock 前端**：代码同步到 `github.com/peistock/peistock` 后 push，EdgeOne Pages 自动构建部署
- 大改动前先本地测试验证（`npm run build`、`tsc --noEmit`、Python 烟测）

## 项目架构

### 技术栈
- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- ECharts (K线图)
- 东方财富API (主) / 新浪API (备)

### 核心功能模块

#### 1. 指标计算 (src/utils/indicators.ts)
- **MAHS/EMAHS**: 换手成本计算
- **CRI**: 恐慌指数 (0-100)
- **GSI**: 贪婪指数 (0-100)
- **斜率因子**: MA20/60/225未来5日斜率
- **趋势强度**: 5级分类 (strong_bull/bull/neutral/bear/strong_bear)
- **BOLL**: 布林带上轨/下轨（MA20 ± 2σ），始终显示，与 MA 开关独立
- **OBV**: 换手能量潮，基于换手率累积计算，收阳累加、收阴累减、平盘不变，叠加 OBV_MA20

#### K 线图开关默认状态（2026-06-08）
| 开关 | 默认 | 说明 |
|------|------|------|
| MAHS | 关 | 红色虚线 |
| EMAHS | 开 | 绿色虚线 |
| MA | 关 | 白/黄/紫/绿/红五条均线 |
| 成交量趋势 | 关 | 灰色面积折线 |
| OBV | 开 | 灰靛实线 + 虚线 MA20 |
| PVT | 开 | 量价趋势，独立开关 |
| BOLL | 始终显示 | 黄色虚线，不受任何开关控制 |

#### 1.0 EMAHS 穿越 MAHS 目标价（2026-06-24 新增）
- **计算**：`src/utils/indicators.ts` 新增 `calculateEmaHsCrossTarget(closes, dd, mahs, emahs)`，假设明天 DD 与今天相同，倒算使明天 `EMAHS = MAHS` 的收盘价
  - 公式：`p = MAHS × d × (d+1)/(d−1) − EMAHS × d − c_{n−d} × (d+1)/(d−1)`
  - 历史数据不足时按 `effectivePeriod = min(d, i+1)` 近似
  - 目标价 ≤0 或偏离当前价 10 倍以上时置为 null
- **展示**：
  - 日 K 线头部 `DD: x` 后显示「穿越目标: xx.x」，精度 1 位小数
  - 目标价落在当前 K 线可见范围（最高/最低价 ±10%）内时，在今日 K 线上用紫色 `markPoint` 标注「金叉目标 xx.x」或「死叉目标 xx.x」
  - tooltip  hover 今日 K 线时同步显示「穿越目标: xx.x」
- **同步**：`rebel_research/src/utils/indicators.ts` 与 `src/components/StockChart.tsx` 需保持 1:1 同步

#### 1.1 市场宽度（2026-06-23 新增）
- **位置**：`src/components/MarketBreadthPanel.tsx`，挂载在 `SectorView.tsx` 顶部
- **数据**：`GET /api/market/breadth/above-ma?index=000300&days=200`
- **口径**：沪深300成分股收盘价站上 40 周均线（200 日等效）的占比，双 Y 轴叠加沪深300收盘价
- **状态**：默认展开，加载中显示 spinner

#### 1.2 ETF 资金流向（2026-06-23 新增，2026-06-24 标签优化）
- **走势/板块**：`src/components/ETFMarketFlowPanel.tsx`（走势）+ `ETFSectorFlowPanel.tsx`（板块轮动）
  - `GET /api/etf/fund-flow/market?days=` 每日净流入柱状图 + 累计净流入折线；面板顶部显示价格最新数据日期 `latest_date`
  - `GET /api/etf/fund-flow/sector?days=` 左右对称板块轮动条形图；时间窗口标签统一为 `1日/7日/14日/30日/90日/180日/1年`
- **明细表**：`src/components/ETFFundFlowDetailTable.tsx`
  - 默认折叠，点击展开才请求 `GET /api/etf/fund-flow/detail?sector=`
  - 支持按 1/7/14/30/90/180/365 日窗口排序，显示净流入（亿元）和份额变化率
- **分类映射**：由后端 `config/etf_categories.json` 维护

#### 2. 股票池 (src/data/watchlist.ts + src/components/StockPool.tsx)
- **持久化股票池**: localStorage 存储（key: `${account}_rros_stock_pool`，按账号隔离），首次访问用硬编码 `DEFAULT_WATCHLIST` 初始化并写入 localStorage，后续支持增删改/star/分类切换
- **分类管理**: 分类列表也持久化（key: `rros_stock_pool_categories`），支持自定义添加/删除空分类
- **StockPool 组件**: 支持按分类 tab 筛选、添加股票（名称/拼音自动解析代码）、删除（hover 显示×）、star 标记（☆/★）、inline 分类切换下拉
- **搜索集成**: 搜索框支持中文名称/拼音搜索，自动解析为股票代码。搜索框右侧按钮为"加入股票池"（替代旧收藏系统）
- **旧收藏迁移**: 首次加载时自动将 `localStorage` 中的 `peter_stock_favorites` 迁移到股票池并标记 star

#### 3. 信号系统

**前端展示信号** (`src/App.tsx` → `detectSignalsFrontend`):
- 机会信号：基于低位分位数/趋势回调
- 风险信号：基于高位分位数/CRI/斜率压力
- 状态机：panic/trend_down/overbought/normal
- 产生分析性提示（如"BIAS低于历史80%"、"CRI高位"等），**不直接用于交易决策**

**严格 B/S 信号** (`src/utils/signals.ts` → `detectSignals`):
- **B(底背离)**: 连续≥2天底背离 + CRI≥60有2天 + 成本偏离<15%有2天
- **B(恐慌)**: 成本偏离<5% + BIAS<5% + CRI>90
- **S(顶背离)**: 连续≥2天顶背离 + BIAS>50%
- **S(贪婪)**: 贪婪>95% + BIAS>90%
- **与前端K线图B/S标记口径完全一致，邮件/扫描报告只使用此信号**

#### 4. 动态阈值机制（2025-02-26更新）
```
超买阈值 (风险信号分级):
- 强多头: 95%
- 普通多头: 87%
- 其他: 80%

超买阈值 (机会信号否决):
- 固定: 80% (无论趋势如何)

设计原理:
- 风险信号分级使用动态阈值，强趋势中需要更高分位才触发"极端超买"
- 机会信号否决使用固定阈值，确保在任意趋势中，BIAS≥80%都关闭买入信号
- 避免强趋势牛股中反复出现"高位钝化"vs"关注反弹"的矛盾信号
```

#### 5. 趋势强度评估（2025-02-26新增）
- **指标**: `trendStrength` + `trendScore`
- **计算依据**: 均线排列(MA5>MA20>MA60>MA225) + 各周期斜率方向
- **5级分类**: 
  - strong_bull (≥70分): 多头排列+斜率向上
  - bull (40-69分): 部分多头排列
  - neutral (-40~39分): 震荡
  - bear (-70~-41分): 空头排列
  - strong_bear (≤-71分): 全面空头

#### 6. 趋势回调买入信号（2025-02-26新增）
触发条件:
- 趋势为strong_bull或bull
- 价格回踩MA20或MA60的±2%范围内
- CRI分位<70%（未极端恐慌）
- 成交量萎缩（VR<0.8）
- 显示: "趋势回调·MA20支撑 - 关注买入"

### 每日扫描脚本 (scripts/daily-watchlist-scan.ts)

**核心逻辑**: 使用 `detectSignals`（严格B/S），**不使用** `detectSignalsFrontend`。

**输入模式**:
- 无参数：扫描默认 `getUniqueWatchlist()`（154只）
- CSV路径：扫描 CSV 中的股票（如 xueqiu_tracker 导出的大V共同关注股票）

**输出过滤**: 只有 `strictSignalType !== null` 的股票才会进入邮件/Excel/控制台输出。

### 关键设计原则

#### 信号冲突处理
1. **风险优先**: 当风险信号和机会信号冲突时，风险信号优先
2. **高位否决机会**: BIAS或成本偏离度≥80%时，关闭机会信号
3. **趋势调节**: 强趋势中提高风险阈值，避免频繁误报

#### 分位数计算
- 使用**全部历史数据**（非滚动窗口）
- 线性插值法计算排名
- 至少需要30个历史数据点

## 测试脚本

### 分位数测试
```bash
node test-scripts/test_percentile.mjs
```

### 常用验证场景
1. **300308**: BIAS高位回落场景
2. **600900**: 价格低位+CRI高位场景
3. **00883.HK**: 强趋势+高位钝化场景
4. **603605**: 斜率微负场景

## API 限制

### 东方财富
- 有CORS限制，浏览器端可能失败
- 失败时自动切换到新浪API

### 新浪API
- 作为fallback使用
- 数据格式与东方财富略有不同

## HTTP API Server (api_server.py)

启动：`.venv/bin/uvicorn api_server:app --port 8000`（项目已自包含，不再需要 PYTHONPATH）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/analyze/stock/:code` | POST | 提交 AI 分析任务，返回 task_id |
| `/api/tasks/:task_id` | GET | 轮询查询分析状态 |
| `/api/decisions/recent` | GET | 最近决策列表 |
| `/api/signals/latest` | GET | 最新异常信号 |
| `/api/memory/active` | GET | 活跃观点（衰减后 >30%） |
| `/api/roles` | GET | 列出所有加载的角色 |
| `/api/search/stock?q=` | GET | 代理东方财富搜索（名称/拼音 → 代码） |
| `/api/stock/:code/report-history` | GET | 查询个股历史 AI 分析报告摘要 |
| `/api/backtest/signals/:code` | GET | 信号级回测：逐日 B/S 信号持有统计 + 当前条件最相似历史日期回测 |
| `/api/backtest/summary` | GET | 全局回测统计（按置信度/Preemption 条件分组） |
| `/api/backtest/stock/:code` | GET | 单股票回测统计和最近交易记录 |
| `/api/watchlist` | GET | 获取当前账号股票池（需 `X-Account` + `X-Password` header） |
| `/api/watchlist` | POST | 保存当前账号股票池（需认证 header） |
| `/api/analysis/list` | GET | 列出所有本地估值分析报告，按股票代码分组 |
| `/api/analysis/:code` | GET | 读取某股票的估值分析报告内容（支持 `?type=` 过滤） |
| `/api/dividend/:code` | GET | 获取个股股息率（最近一年累计现金分红 / 当前股价） |
| `/api/proxy/klines` | GET | 代理个股 K 线（东方财富 / 腾讯 / Sina），避免前端 CORS/限流 |
| `/api/etf/fund-flow/market?days=` | GET | 全市场 ETF 净流入趋势（亿元） |
| `/api/etf/fund-flow/sector?days=` | GET | ETF 板块资金轮动（亿元） |
| `/api/etf/fund-flow/detail?sector=` | GET | 单只 ETF 多窗口资金流向明细（1/7/14/30/90/180/365 日） |
| `/api/etf/list` | GET | 热门 ETF 列表及当前行情 |
| `/api/market/breadth/above-ma?index=&days=` | GET | 市场宽度：指数成分股站上 N 日均线的占比 |
| `/health` | GET | 健康检查 |

供前端（peistock）调用，支持查询任意股票（不限股票池）。**认证**：watchlist 和 analysis 端点需 `X-Account` 和 `X-Password` header，账号密码在 `config/accounts_hashed.json` 静态配置（bcrypt 哈希格式，由 `scripts/migrate_passwords.py` 从旧版 `accounts.json` 迁移生成）。其他端点公开访问。

## 部署信息

- **前端**: 腾讯云 EdgeOne Pages
- **构建命令**: `npm run build`
- **构建输出**: `dist/` 目录
- **自动部署**: GitHub push 后自动触发 EdgeOne 构建
- **构建配置**: `edgeone.json`
- **AI 分析后端**: RebelResearchOS (`research.peistock.win`)，部署在 JD Cloud 服务器，通过 Cloudflare Tunnel 代理
  - 本地开发时 Vite 代理 `/api/research` → `http://localhost:8002`
  - 生产环境直接请求 `research.peistock.win`

## 已知问题

### HK 个股流通股索引（2026-05-16 修正）

腾讯 API qt 数组中：
- `qt[70]` = 流通股本（float 字符串，如 `'95912.000'`）
- `qt[69]` = 总股本

曾误用 `qt[69]` 导致 DD 值计算为 ~500（应为 ~80）。`src/utils/tencentApi.ts` 已修正为 `qt[70]`。

`src/utils/stockCapital.ts` 已硬编码主要 HK 龙头流通股本作为本地兜底。
