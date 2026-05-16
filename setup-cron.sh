#!/bin/bash
# 设置定时任务脚本

echo "设置每日16:00自动扫描股票信号..."

# 找到 npx 路径
NPX_PATH=$(which npx)
echo "npx 路径: $NPX_PATH"

# 创建 cron 任务
(crontab -l 2>/dev/null; echo "0 16 * * 1-5 cd /Users/cpp/Downloads/app && $NPX_PATH tsx scripts/scan-and-email.ts /Users/cpp/xueqiu_tracker/data/大V共同关注股票分析.csv >> /Users/cpp/Downloads/app/scan.log 2>&1") | crontab -

echo "✅ 定时任务已设置！"
echo ""
echo "查看任务: crontab -l"
echo "查看日志: tail -f /Users/cpp/Downloads/app/scan.log"
echo "删除任务: crontab -r"
