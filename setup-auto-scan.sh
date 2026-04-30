#!/bin/bash
# 自动设置股票扫描定时任务

echo "📊 股票信号自动扫描设置"
echo "========================"
echo ""

# 检查 .env 配置
ENV_FILE="/Users/cpp/Downloads/app/.env"
if ! grep -q "your_qq@qq.com" "$ENV_FILE" 2>/dev/null; then
    echo "✅ 检测到已配置邮箱"
else
    echo "⚠️  请先编辑 .env 文件配置邮箱信息："
    echo "   EMAIL_USER=你的邮箱@qq.com"
    echo "   EMAIL_PASS=邮箱授权码（不是密码）"
    echo "   EMAIL_TO=接收邮箱"
    echo ""
    echo "获取QQ邮箱授权码："
    echo "1. 登录QQ邮箱网页版"
    echo "2. 设置 → 账户 → 开启SMTP服务"
    echo "3. 发送短信获取授权码"
    exit 1
fi

# 找到 npx 路径
NPX_PATH=$(which npx)
if [ -z "$NPX_PATH" ]; then
    echo "❌ 错误：找不到 npx，请先安装 Node.js"
    exit 1
fi

echo "✅ npx 路径: $NPX_PATH"
echo ""

# CSV 文件路径
CSV_FILE="/Users/cpp/xueqiu_tracker/data/大V共同关注股票分析.csv"

# 检查CSV文件是否存在
if [ ! -f "$CSV_FILE" ]; then
    echo "⚠️  警告：找不到默认CSV文件: $CSV_FILE"
    echo "   请确认股票列表文件路径"
    exit 1
fi

echo "✅ 股票列表: $CSV_FILE"
echo ""

# 创建定时任务
echo "📝 创建定时任务（工作日16:00执行）..."

# 先删除旧任务（如果有）
crontab -l 2>/dev/null | grep -v "scan-and-email" | crontab - 2>/dev/null

# 添加新任务
(crontab -l 2>/dev/null; echo "0 16 * * 1-5 cd /Users/cpp/Downloads/app && $NPX_PATH tsx scripts/scan-and-email.ts $CSV_FILE >> /Users/cpp/Downloads/app/scan.log 2>&1") | crontab -

echo ""
echo "✅ 定时任务设置成功！"
echo ""
echo "========================"
echo "📋 任务信息"
echo "========================"
echo "执行时间: 每个工作日 16:00"
echo "扫描对象: 大V共同关注股票（171只）"
echo "通知方式: 邮件推送"
echo "日志文件: /Users/cpp/Downloads/app/scan.log"
echo ""
echo "========================"
echo "🔧 常用命令"
echo "========================"
echo "查看任务: crontab -l"
echo "查看日志: tail -f /Users/cpp/Downloads/app/scan.log"
echo "手动运行: npx tsx scripts/scan-and-email.ts $CSV_FILE"
echo "删除任务: crontab -r"
echo ""
echo "⚠️  注意：电脑需要保持开机才能执行定时任务"
echo "   建议：系统设置 → 电池 → 防止电脑自动进入睡眠"
