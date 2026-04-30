# Peter 趋势交易系统 (peistock)

基于量价均线分析的股票趋势交易系统，包含前端可视化 + 后端信号扫描。

## 功能概览

- **K线图表**：React + ECharts，集成多种技术指标
- **股票池**：154只关注股票分类面板，支持按行业筛选和快速跳转
- **信号检测**：严格 B/S 交易信号（底背离/顶背离/恐慌/贪婪）
- **每日扫描**：工作日自动扫描股票池，邮件推送信号
- **大V追踪**：与 xueqiu_tracker 联动，扫描雪球大V共同关注股票

## 快速开始

```bash
cd "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock"
npm install
npm run dev      # 本地开发服务器 http://localhost:5173
npm run build    # 生产构建
```

## 每日扫描

```bash
# 扫描默认股票池（154只）
npx tsx scripts/daily-watchlist-scan.ts

# 扫描大V共同关注股票（从 xueqiu_tracker CSV）
npx tsx scripts/daily-watchlist-scan.ts \
  "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/xueqiu_tracker/data/大V共同关注股票分析.csv"
```

详见 [DAILY_SCAN.md](DAILY_SCAN.md)。

## 项目结构

```
src/
  data/watchlist.ts       # 默认股票池（154只，按行业分类）
  components/StockPool.tsx # 股票池分类筛选面板
  components/StockSearch.tsx # 股票搜索组件
  utils/indicators.ts     # 指标计算（CRI/贪婪/BIAS等）
  utils/signals.ts        # 严格B/S信号检测
  App.tsx                 # 主界面
scripts/
  daily-watchlist-scan.ts # 每日扫描主脚本
```

## 技术栈

- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- ECharts
