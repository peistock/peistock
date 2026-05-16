# 自动扫描 + 远程通知配置指南

## 方案一：邮件推送（最稳定）

### 1. 配置邮箱

编辑 `.env` 文件：

```bash
cd "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock"
```

```bash
# 必盈数据 API Licence Key
VITE_BIYING_LICENCE=73445DDD-FE59-4709-8D0F-4E2270C9FAD5

# 邮件配置（以QQ邮箱为例）
EMAIL_HOST=smtp.qq.com
EMAIL_PORT=465
EMAIL_USER=你的QQ邮箱@qq.com
EMAIL_PASS=你的邮箱授权码
EMAIL_TO=接收邮箱@example.com
```

**获取邮箱授权码：**
- QQ邮箱：设置 → 账户 → 开启SMTP服务 → 获取授权码
- 163邮箱：设置 → POP3/SMTP/IMAP → 开启服务 → 获取授权码
- Gmail：需要开启两步验证，使用应用专用密码

### 2. 测试邮件发送

```bash
cd "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock"
npx tsx scripts/daily-watchlist-scan.ts \
  "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/xueqiu_tracker/data/大V共同关注股票分析.csv"
```

### 3. 设置定时任务（macOS）

**方式A：使用 cron（简单）**

```bash
# 编辑定时任务
crontab -e

# 添加以下行（工作日 12:00 运行）
0 12 * * 1-5 cd "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock" && /opt/homebrew/bin/npx tsx scripts/daily-watchlist-scan.ts "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/xueqiu_tracker/data/大V共同关注股票分析.csv" >> "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock/logs/daily-scan.log" 2>&1
```

**方式B：使用 launchd（推荐，更稳定）**

详见 [scripts/README.md](README.md) 中的 launchd 配置示例。

---

## 方案二：企业微信/钉钉/飞书推送（更及时）

如果需要手机即时通知，可以使用群机器人。

### 飞书机器人

1. 在飞书群中添加自定义机器人
2. 获取 Webhook URL
3. 添加到 `.env`：

```bash
FEISHU_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxxx
```

### 企业微信群机器人

1. 在企业微信群 → 群设置 → 添加群机器人
2. 获取 Webhook 地址
3. 添加到 `.env`：

```bash
WECHAT_WEBHOOK=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxxx
```

---

## 方案三：云服务器运行（7×24小时）

如果你有一台云服务器（阿里云/腾讯云/AWS等），可以将程序部署到服务器上运行。

### Docker 部署

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npx", "tsx", "scripts/daily-watchlist-scan.ts", "stocks.csv"]
```

---

## 方案四：GitHub Actions（免费）

在 GitHub 上设置定时任务，每天自动运行扫描并发送邮件。

**优点：** 免费、不需要自己的电脑一直开机
**缺点：** 需要代码公开或购买 GitHub Pro

---

## 常见问题

### Q: 电脑睡眠时还能运行吗？
**A:** 不能。电脑睡眠时所有程序都会暂停。建议：
1. 保持电脑插电且不休眠
2. 使用云服务器
3. 使用支持唤醒的 Mac（可以设置定时唤醒）

### Q: 扫描频率有限制吗？
**A:** 腾讯财经 API 没有明确限制，但建议：
- 每个股票间隔 300-500ms
- 一天内不要频繁重复扫描

### Q: 邮件进垃圾箱怎么办？
**A:** 
1. 将发件邮箱添加到通讯录
2. 检查邮件主题和内容，避免敏感词
3. 使用企业邮箱发送更可靠

### Q: 可以同时发送给多个人吗？
**A:** 可以，修改 `EMAIL_TO`：
```bash
EMAIL_TO=aaa@qq.com,bbb@163.com,ccc@gmail.com
```
