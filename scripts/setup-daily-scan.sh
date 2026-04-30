#!/bin/bash
# 设置每日股票信号扫描定时任务
# 运行: ./setup-daily-scan.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "  每日股票信号扫描 - 定时任务设置"
echo "========================================"
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/.."
CRON_SCRIPT="$SCRIPT_DIR/daily-scan-cron.sh"

echo "脚本目录: $SCRIPT_DIR"
echo "应用目录: $APP_DIR"
echo ""

# 检查脚本是否存在
if [ ! -f "$CRON_SCRIPT" ]; then
    echo -e "${RED}错误: 找不到定时任务脚本 $CRON_SCRIPT${NC}"
    exit 1
fi

# 确保脚本可执行
chmod +x "$CRON_SCRIPT"

# 检查 node_modules 是否存在
if [ ! -d "$APP_DIR/node_modules" ]; then
    echo -e "${YELLOW}警告: 未找到 node_modules，请先运行 npm install${NC}"
    echo "在 $APP_DIR 目录下运行: npm install"
    exit 1
fi

# 获取当前用户的 crontab
echo "检查现有定时任务..."
CURRENT_CRONTAB=$(crontab -l 2>/dev/null || true)

# 检查是否已存在相同的定时任务
if echo "$CURRENT_CRONTAB" | grep -q "daily-scan-cron.sh"; then
    echo -e "${YELLOW}警告: 已存在股票扫描定时任务${NC}"
    echo ""
    echo "现有任务:"
    echo "$CURRENT_CRONTAB" | grep "daily-scan-cron.sh"
    echo ""
    read -p "是否重新设置? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "取消设置"
        exit 0
    fi
    # 删除旧任务
    CURRENT_CRONTAB=$(echo "$CURRENT_CRONTAB" | grep -v "daily-scan-cron.sh")
fi

echo ""
echo "选择扫描时间:"
echo "1) 工作日 12:00 (默认 - 中午休市时)"
echo "2) 工作日 15:30 (收盘后)"
echo "3) 自定义时间"
echo ""
read -p "请选择 (1-3) [默认: 1]: " choice

choice=${choice:-1}

 case $choice in
    1)
        SCHEDULE="0 12 * * 1-5"
        TIME_DESC="工作日 12:00"
        ;;
    2)
        SCHEDULE="30 15 * * 1-5"
        TIME_DESC="工作日 15:30"
        ;;
    3)
        echo ""
        echo "请输入 cron 表达式 (例如: 0 12 * * 1-5 表示工作日12:00)"
        read -p "Cron表达式: " SCHEDULE
        TIME_DESC="自定义: $SCHEDULE"
        ;;
    *)
        echo -e "${RED}无效选择${NC}"
        exit 1
        ;;
esac

echo ""
echo "定时任务将设置为: $TIME_DESC"
echo ""

# 配置邮件通知
echo "邮件通知配置 (可选):"
read -p "接收邮箱地址 (直接回车跳过): " email_to

if [ -n "$email_to" ]; then
    read -p "SMTP服务器 (默认: smtp.gmail.com): " smtp_host
    smtp_host=${smtp_host:-smtp.gmail.com}
    
    read -p "SMTP端口 (默认: 587): " smtp_port
    smtp_port=${smtp_port:-587}
    
    read -p "SMTP用户名: " smtp_user
    
    read -s -p "SMTP密码/应用专用密码: " smtp_pass
    echo
    
    # 创建环境变量文件
    ENV_FILE="$APP_DIR/.env.local"
    echo "# 每日扫描邮件配置" > "$ENV_FILE"
    echo "EMAIL_TO=$email_to" >> "$ENV_FILE"
    echo "SMTP_HOST=$smtp_host" >> "$ENV_FILE"
    echo "SMTP_PORT=$smtp_port" >> "$ENV_FILE"
    echo "SMTP_USER=$smtp_user" >> "$ENV_FILE"
    echo "SMTP_PASS=$smtp_pass" >> "$ENV_FILE"
    
    echo -e "${GREEN}邮件配置已保存到 .env.local${NC}"
fi

# 创建新的 crontab 条目
NEW_CRON_ENTRY="$SCHEDULE cd \"$APP_DIR\" \u0026\u0026 ./scripts/daily-scan-cron.sh \u003e /dev/null 2\u003e\u00261"

# 合并 crontab
if [ -z "$CURRENT_CRONTAB" ]; then
    echo "$NEW_CRON_ENTRY" | crontab -
else
    (echo "$CURRENT_CRONTAB"; echo "$NEW_CRON_ENTRY") | crontab -
fi

echo ""
echo -e "${GREEN}✅ 定时任务设置成功!${NC}"
echo ""
echo "任务详情:"
echo "  时间: $TIME_DESC"
echo "  脚本: $CRON_SCRIPT"
echo "  日志: $APP_DIR/logs/daily-scan-YYYYMMDD.log"
echo ""
echo "查看当前定时任务:"
echo "  crontab -l"
echo ""
echo "手动运行测试:"
echo "  cd \"$APP_DIR\" \u0026\u0026 npx tsx scripts/daily-scan.ts"
echo ""
echo "========================================"

# 显示当前 crontab
echo "当前定时任务列表:"
crontab -l
