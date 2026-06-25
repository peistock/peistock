# PeiStock 趋势交易系统

React 前端，对接 RebelResearchOS 投研后端。

## 技术栈

- React 18 + TypeScript
- Vite（构建工具）
- Tailwind CSS
- ECharts（K 线图与技术指标）
- Lucide React（图标）

## 本地开发

```bash
npm install
npm run dev
```

Vite 开发服务器默认运行在 `http://localhost:5173`，API 请求通过 Vite 代理转发到 `http://localhost:8002`。

## 构建

```bash
npm run build
```

输出到 `dist/` 目录，用于 EdgeOne Pages 自动部署。

## 环境变量

| 文件 | 用途 |
|------|------|
| `.env.development` | 本地开发：`VITE_RESEARCH_API_BASE=/api/research`（经 Vite 代理到 localhost:8002） |
| `.env.production` | 生产环境：`VITE_RESEARCH_API_BASE=https://research.peistock.win` |

## 功能模块

### 股票池管理
- 按行业分类 Tab 展示
- 支持中文名称 / 拼音缩写搜索添加
- Star 标记关注
- 未登录走 localStorage，登录后同步后端账号隔离的股票池

### K 线图
- 日 K / 周 K / 月 K 切换
- 指标叠加：MA5/10/20/60、BOLL 上轨/下轨、成交量、MAHS/EMAHS、OBV、PVT
- B/S 信号标记（底背离、顶背离、恐慌、贪婪）
- **EMAHS 穿越目标价（2026-06-24，2026-06-25 升级为日线）**：倒算明天收盘价达到多少时 EMAHS = MAHS；主图新增紫色虚线展示相对当天收盘价的百分比偏离，挂载右侧独立 y 轴，主要观察拐点和极端偏离；今日 K 线仍用 `markPoint` 标注绝对目标价，tooltip 同步展示百分比和绝对价
- 抵扣价标注（MA20/MA60/MA225）

### 市场宽度（2026-06-23）
- 沪深300 成分股站上 40 周均线（200 日等效）的占比
- 双 Y 轴图：占比 + 沪深300 收盘价
- 数据来自 RebelResearchOS `/api/market/breadth/above-ma`

### ETF 资金流向（2026-06-23）
- 全市场 ETF 净流入趋势图（每日净流入 + 累计净流入），顶部显示价格最新数据日期
- ETF 板块资金轮动图（左右对称条形图），时间窗口统一为 `1日/7日/14日/30日/90日/180日/1年`
- 单只 ETF 多窗口（1/7/14/30/90/180/365 日）资金流向明细表，默认折叠
- 数据来自 RebelResearchOS `/api/etf/fund-flow/*`

### AI 投研分析
- 搜索股票触发五角色链分析（Bull / Bear / Preemption / Sentiment / Chair）
- 结果以卡片轮播展示，支持章节导航
- 3 天缓存：同一股票 3 天内已有 Chair 报告则直接返回
- **Tab 切换**：AI 分析 与 估值报告 在同一面板切换展示

### 估值报告
- 读取 RebelResearchOS 后端 `analysis/` 目录中的本地估值报告
- 支持 GROWTH-J 和 peter 框架报告，优先展示 HTML 版本
- 点击报告卡片弹出全屏阅读器（iframe 隔离样式）

### 历史报告对比
- 日期为行，Bull / Bear / Preemption / Sentiment / Chair 为列
- 支持点击展开完整报告

### 账号管理
- 静态账号体系：admin + guest1~guest5（密码同账号）
- 登录后股票池按账号隔离（后端 `data/watchlists.json` + 前端 localStorage）
- 未登录走纯 localStorage 模式

## 数据流

```
前端 (peistock)
  ├── 股票行情 → 东方财富 API（主）/ 腾讯财经 API（备）
  ├── AI 分析 → RebelResearchOS 后端 (/api/research)
  │              ├── 个股指标计算（peistock 指标引擎 Python 版）
  │              ├── 新闻/公告抓取
  │              ├── Bull vs Bear LLM 辩论
  │              └── Chair 裁决 → 决策卡 JSON
  ├── 估值报告 → RebelResearchOS 后端 (/api/analysis)
  │              └── 读取 analysis/ 目录中的 HTML/Markdown 报告
  └── 股票池 → 后端账号隔离存储 / localStorage
```

## 目录结构

```
src/
├── App.tsx                    主应用（路由 + 全局状态）
├── components/
│   ├── StockPool.tsx          股票池面板
│   ├── StockSearch.tsx        搜索 + AI 分析结果
│   ├── StockChart.tsx         K 线图（ECharts）
│   ├── StockChartsSection.tsx  多时间框架图表区
│   ├── MarketBreadthPanel.tsx  沪深300 市场宽度面板
│   ├── ETFMarketFlowPanel.tsx    ETF 全市场净流入趋势面板
│   ├── ETFSectorFlowPanel.tsx    ETF 板块资金轮动面板
│   ├── ETFFundFlowDetailTable.tsx  ETF 单只资金流向明细表（默认折叠）
│   ├── ReportHistory.tsx      历史 AI 报告对比表格
│   ├── SignalBacktestPanel.tsx 信号级回测看板
│   ├── ValuationReportPanel.tsx 估值报告面板（全屏阅读器）
│   └── ...
├── data/
│   └── watchlist.ts           股票池 localStorage CRUD
├── types/
│   └── index.ts               类型定义（K 线数据、信号、指标等）
└── utils/
    ├── eastmoneyApi.ts        东方财富 API 封装
    ├── researchApi.ts         RebelResearchOS 后端 API 封装
    └── indicators.ts          前端指标计算（MA、BOLL 等）
```

## License

MIT
