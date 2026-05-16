# 每日股票信号扫描系统

## 📋 系统概述

自动扫描关注股票池，检测**严格 B/S 交易信号**，工作日中午自动运行并推送邮件。

**只发送满足严格 B/S 信号条件的股票**，无信号时不打扰。

---

## 🎯 信号说明（严格 B/S 标准）

| 信号 | 条件 | 含义 |
|------|------|------|
| **B(底背离)** | 连续≥2天底背离 + CRI≥60有2天 + 成本偏离<15%有2天 | 底部结构形成，买入机会 |
| **B(恐慌)** | 成本偏离<5% + BIAS<5% + CRI>90 | 极度恐慌，逆势买入 |
| **S(顶背离)** | 连续≥2天顶背离 + BIAS>50% | 顶部结构形成，卖出信号 |
| **S(贪婪)** | 贪婪>95% + BIAS>90% | 市场过热，考虑止盈 |

> 严格信号标准与前端K线图B/S标记口径完全一致，过滤掉前端展示的分析性提示（如"BIAS低于历史80%"等），只保留满足完整条件的 B/S 信号。

---

## ⚙️ 配置说明

### 1. 邮件通知

如需邮件接收信号，编辑 `.env` 文件：

```bash
cd "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock"
```

```bash
# 邮件配置
EMAIL_TO=your-email@example.com
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-pass
```

---

## 🚀 使用方法

### 模式一：扫描默认关注列表（154只）

```bash
cd "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock"
npx tsx scripts/daily-watchlist-scan.ts
```

### 模式二：从 CSV 扫描（大V共同关注股票）

```bash
cd "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock"
npx tsx scripts/daily-watchlist-scan.ts \
  "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/xueqiu_tracker/data/大V共同关注股票分析.csv"
```

### 查看定时任务日志

```bash
tail -f "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock/logs/daily-scan.log"
```

### 查看历史结果

扫描结果保存在：
```
daily-results/signals_YYYY-MM-DD.xlsx
```

---

## 📁 文件结构

```
peistock/
├── src/data/watchlist.ts          # 默认154只股票列表
├── src/utils/signals.ts           # 严格B/S信号检测逻辑
├── scripts/
│   ├── daily-watchlist-scan.ts    # 主扫描脚本 ⭐
│   ├── scan-signals.ts            # 通用扫描脚本（Excel输入）
│   ├── test-scan-quick.ts         # 快速测试脚本
│   └── daily-scan-cron.sh         # 定时任务脚本
├── logs/                          # 扫描日志
├── daily-results/                 # 每日信号结果 (Excel)
├── DAILY_SCAN.md                  # 本文档
└── AGENTS.md                      # 开发规范
```

---

## 🔗 与雪球大V追踪系统集成

`xueqiu_tracker` 项目每天 11:55 更新大V共同关注股票列表，导出为 CSV。本系统 12:00 读取该 CSV 进行扫描，形成闭环：

```
11:55  xueqiu_tracker: 获取大V数据 → 导出 大V共同关注股票分析.csv
12:00  peistock: 读取 CSV → 严格B/S信号扫描 → 邮件推送
```

---

## ⏰ 定时任务

已配置到系统 crontab（工作日运行）：

```
# xueqiu_tracker 数据更新（提前5分钟）
55 11 * * 1-5 cd .../xueqiu_tracker && python3 tracker.py && python3 export_excel.py

# peistock 信号扫描
0 12 * * 1-5 cd .../peistock && npx tsx scripts/daily-watchlist-scan.ts .../大V共同关注股票分析.csv
```

查看/修改：
```bash
crontab -e
```

---

## 🔧 修改股票列表

编辑 `src/data/watchlist.ts`：

```typescript
export const WATCHLIST = [
  { code: "601117", name: "中国化学", market: "SH", category: "能源化工" },
  // ... 添加或删除股票
];
```

---

## ⚠️ 注意事项

1. **数据长度** - 新股或上市不足225天的股票无法计算信号
2. **运行时间** - 扫描约150只股票约需 2-3 分钟
3. **节假日** - cron 已限制为工作日 1-5，无需手动禁用
4. **美股数据** - SKM 等美股需 Yahoo Finance API，当前可能无法获取

---

## 📝 更新日志

- 2026-04-29: 信号过滤改为严格 B/S 标准（雪球大V同款），大幅减少误报
- 2026-04-29: 支持从 CSV 加载股票列表，与 xueqiu_tracker 集成
- 2026-04-29: 修复定时任务路径和邮件发送问题
- 2026-03-13: 初始化系统，配置154只股票定时扫描
