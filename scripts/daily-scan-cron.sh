#!/bin/bash
# 每日股票信号扫描定时任务脚本
# 运行时间: 周一到周五 12:00

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/.."

# 进入应用目录
cd "$APP_DIR" || exit 1

# 日志文件
LOG_DIR="$APP_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/daily-scan-$(date +%Y%m%d).log"

# 写入开始时间
echo "========================================" >> "$LOG_FILE"
echo "Daily Scan Started: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"

# 检查是否是工作日 (周一到周五)
DAY_OF_WEEK=$(date +%u)
if [ "$DAY_OF_WEEK" -gt 5 ]; then
    echo "今天是周末，跳过扫描" >> "$LOG_FILE"
    exit 0
fi

# 检查是否是节假日（简单检查，可以扩展）
# 如果需要更复杂的节假日检测，可以在这里添加逻辑

echo "今天是工作日，开始扫描..." >> "$LOG_FILE"

# 运行扫描脚本
npx tsx scripts/daily-scan.ts >> "$LOG_FILE" 2>&1

EXIT_CODE=$?

# 记录结束时间
echo "" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"
echo "Daily Scan Finished: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "Exit Code: $EXIT_CODE" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

exit $EXIT_CODE
