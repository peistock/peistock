# Peter趋势交易系统 - 开发规范

## 核心规则

### 部署规则
- **rebel_research**：用户说「push 到 git」时，自动执行 `./deploy.sh` 部署到 JD Cloud，无需二次确认
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

#### 2. 股票池 (src/data/watchlist.ts + src/components/StockPool.tsx)
- **持久化股票池**: localStorage 存储（key: `rros_stock_pool`），首次访问用硬编码 `DEFAULT_WATCHLIST` 初始化并写入 localStorage，后续支持增删改/star/分类切换
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
| `/health` | GET | 健康检查 |

供前端（peistock）调用，支持查询任意股票（不限股票池）。

## 部署信息

- **前端**: 腾讯云 EdgeOne Pages
- **构建命令**: `npm run build`
- **构建输出**: `dist/` 目录
- **自动部署**: GitHub push 后自动触发 EdgeOne 构建
- **构建配置**: `edgeone.json`
- **AI 分析后端**: RebelResearchOS (`research.peistock.win`)，部署在 JD Cloud 服务器，通过 Cloudflare Tunnel 代理
  - 本地开发时 Vite 代理 `/api/research` → `http://localhost:8000`
  - 生产环境直接请求 `research.peistock.win`

## 已知问题

### HK 个股流通股索引（2026-05-16 修正）

腾讯 API qt 数组中：
- `qt[70]` = 流通股本（float 字符串，如 `'95912.000'`）
- `qt[69]` = 总股本

曾误用 `qt[69]` 导致 DD 值计算为 ~500（应为 ~80）。`src/utils/tencentApi.ts` 已修正为 `qt[70]`。

`src/utils/stockCapital.ts` 已硬编码主要 HK 龙头流通股本作为本地兜底。
