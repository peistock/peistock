# 股票信号扫描工具

批量扫描股票列表，自动检测严格 B/S 交易信号，输出 Excel 报告。

## 使用方法

### 1. 准备股票列表

模式 A - 使用默认关注列表（154只）：
直接运行脚本，无需准备文件。

模式 B - 从 Excel 扫描：
创建一个 Excel 文件，格式如下：

| code | name |
|------|------|
| 600519 | 贵州茅台 |
| 000001 | 平安银行 |
| 300308 | 中际旭创 |
| 00700 | 腾讯控股 |

- **第一列**: 股票代码（5位港股或6位A股）
- **第二列**: 股票名称（可选）

模式 C - 从 CSV 扫描（推荐，用于 xueqiu_tracker 集成）：
CSV 格式：第一列为 `code` 列，支持 `SH600519`、`600519` 等格式。

```bash
npx tsx scripts/daily-watchlist-scan.ts /path/to/stocks.csv
```

### 2. 运行扫描

**daily-watchlist-scan.ts**（推荐，支持邮件/QQ推送）：
```bash
# 扫描默认关注列表
npx tsx scripts/daily-watchlist-scan.ts

# 扫描 CSV 文件
npx tsx scripts/daily-watchlist-scan.ts stocks.csv
```

**scan-signals.ts**（通用扫描，Excel输入）：
```bash
npx tsx scripts/scan-signals.ts input.xlsx [output.xlsx]
```

### 3. 查看结果

输出 Excel 包含以下列：

| 列名 | 说明 |
|------|------|
| 股票代码 | 股票代码 |
| 股票名称 | 股票名称 |
| 日期 | 最新数据日期 |
| 收盘价 | 最新收盘价 |
| 信号 | 检测到的信号（S顶背离/S贪婪/B底背离/B恐慌）|
| 信号详情 | 信号的具体条件满足情况 |
| BIAS225分位 | BIAS225历史分位数 |
| CRI | 恐慌指数 |
| 贪婪指数 | 贪婪指数 |
| 错误信息 | 如有错误显示于此 |

## 信号说明（严格 B/S 标准）

| 信号 | 条件 | 颜色 | 标记位置 |
|------|------|------|----------|
| S(顶背离) | 连续≥2天顶背离 + BIAS>50% | 🟢 绿色 | 第一天 |
| S(贪婪) | 贪婪>95% + BIAS>90% | 🟠 橙色 | DI拐点 |
| B(底背离) | 连续≥2天底背离 + 2×CRI≥60 + 2×成本偏离<15% | 🔴 红色 | 最后一天 |
| B(恐慌) | 成本偏离<5% + BIAS<5% + CRI>90 | 🟣 紫色 | DI拐点 |

> 这是雪球大V同款严格标准。`daily-watchlist-scan.ts` 只输出满足上述条件的股票，过滤掉前端展示的分析性提示。

## 定时自动运行（macOS/Linux）

### 使用 cron 每天自动扫描

1. 编辑 crontab：
```bash
crontab -e
```

2. 添加定时任务（每天 12:00 运行）：
```bash
# 扫描默认列表
0 12 * * 1-5 cd "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock" && /opt/homebrew/bin/npx tsx scripts/daily-watchlist-scan.ts >> logs/daily-scan.log 2>&1

# 扫描大V CSV
0 12 * * 1-5 cd "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock" && /opt/homebrew/bin/npx tsx scripts/daily-watchlist-scan.ts "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/xueqiu_tracker/data/大V共同关注股票分析.csv" >> logs/daily-scan.log 2>&1
```

**注意**: 
- macOS 上 npx 路径可能不同，可用 `which npx` 查看
- 工作日 1-5 表示周一到周五

### 使用 launchd（macOS 推荐）

创建 `~/Library/LaunchAgents/com.user.stockscan.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.stockscan</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/npx</string>
        <string>tsx</string>
        <string>/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock/scripts/daily-watchlist-scan.ts</string>
        <string>/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/xueqiu_tracker/data/大V共同关注股票分析.csv</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock</string>
    <key>StartCalendarInterval</key>
    <array>
        <dict>
            <key>Hour</key>
            <integer>12</integer>
            <key>Minute</key>
            <integer>0</integer>
            <key>Weekday</key>
            <integer>1</integer>
        </dict>
        <dict>
            <key>Hour</key>
            <integer>12</integer>
            <key>Minute</key>
            <integer>0</integer>
            <key>Weekday</key>
            <integer>2</integer>
        </dict>
        <dict>
            <key>Hour</key>
            <integer>12</integer>
            <key>Minute</key>
            <integer>0</integer>
            <key>Weekday</key>
            <integer>3</integer>
        </dict>
        <dict>
            <key>Hour</key>
            <integer>12</integer>
            <key>Minute</key>
            <integer>0</integer>
            <key>Weekday</key>
            <integer>4</integer>
        </dict>
        <dict>
            <key>Hour</key>
            <integer>12</integer>
            <key>Minute</key>
            <integer>0</integer>
            <key>Weekday</key>
            <integer>5</integer>
        </dict>
    </array>
    <key>StandardOutPath</key>
    <string>/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock/logs/daily-scan.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock/logs/daily-scan-error.log</string>
</dict>
</plist>
```

加载并启动：
```bash
launchctl load ~/Library/LaunchAgents/com.user.stockscan.plist
```

## 数据源

- **腾讯财经 API**：免费，支持 A 股和港股
- 无需 API Key
- 数据延迟约 15 分钟

## 注意事项

1. 首次运行可能需要安装依赖：`npm install`
2. 扫描频率不要过高，避免被封 IP（每个股票间隔 500ms）
3. 需要约 300 天历史数据才能准确计算指标
4. 扫描结果仅供参考，不构成投资建议
