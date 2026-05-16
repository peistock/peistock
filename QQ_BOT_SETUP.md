# QQ Bot 配置说明

## 快速配置

编辑 `.env` 文件：

```bash
cd "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock"
```

```bash
# QQ Bot API 地址 (根据你的 Bot 类型填写)
QQ_BOT_API=http://localhost:3000/send_msg

# Bot 类型: gocqhttp | onebot | custom
QQ_BOT_TYPE=gocqhttp

# 发送目标类型: private (私聊) | group (群聊)
QQ_TARGET_TYPE=private

# 目标 QQ 号或群号
QQ_TARGET_ID=123456789

# 可选: API Token/密钥
QQ_BOT_TOKEN=your-token
```

---

## 支持的 Bot 类型

### 1. go-cqhttp (推荐)

如果你使用 go-cqhttp：

```bash
QQ_BOT_API=http://127.0.0.1:5700/send_msg
QQ_BOT_TYPE=gocqhttp
QQ_TARGET_TYPE=private    # 或 group
QQ_TARGET_ID=123456789
```

### 2. OneBot 标准

如果你使用 OneBot 兼容的 Bot：

```bash
QQ_BOT_API=http://127.0.0.1:3000/
QQ_BOT_TYPE=onebot
QQ_TARGET_TYPE=group      # 或 private
QQ_TARGET_ID=987654321
```

### 3. 自定义 API

如果你有自定义的消息推送 API：

```bash
QQ_BOT_API=https://your-api.com/push
QQ_BOT_TYPE=custom
QQ_TARGET_TYPE=private
QQ_TARGET_ID=your-user-id
```

---

## 常见 Bot 部署方案

### 方案 A: go-cqhttp (本地部署)

1. 下载 go-cqhttp: https://github.com/Mrs4s/go-cqhttp
2. 配置 config.yml 启用 HTTP API
3. 启动后使用 API 发送消息

config.yml 关键配置：
```yaml
servers:
  - http:
      host: 127.0.0.1
      port: 5700
      max-row-concurrency: 1000
```

### 方案 B: 使用 OpenClaw 的消息通道

如果你的 OpenClaw 已配置消息通道（如 Discord、Telegram），可以直接使用：

```bash
# 在定时任务脚本中修改，使用 OpenClaw CLI 发送
openclaw message send --target qq --content "消息内容"
```

### 方案 C: 第三方推送服务

使用如 Server 酱、PushPlus 等服务：

```bash
QQ_BOT_API=https://pushplus.plus/send
QQ_BOT_TYPE=custom
QQ_TARGET_TYPE=private
QQ_TARGET_ID=your-pushplus-token
```

---

## 测试 QQ 发送

配置完成后，手动运行测试：

```bash
cd "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock"

# 设置环境变量并运行
export QQ_BOT_API=http://localhost:5700/send_msg
export QQ_BOT_TYPE=gocqhttp
export QQ_TARGET_TYPE=private
export QQ_TARGET_ID=你的QQ号

npx tsx scripts/daily-watchlist-scan.ts
```

---

## 消息格式示例

扫描完成后，QQ 会收到如下消息：

```
📊 股票信号报告 2026-04-29
共扫描 147 只，发现 34 只信号股
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 卖出信号 (28只)
  601117 中国化学
    [SH] ¥8.52 | S(顶背离)
    BIAS:98.7% 贪婪:75.2

🟢 买入信号 (6只)
  600900 长江电力
    [SH] ¥28.35 | B(恐慌)
    BIAS:2.1% CRI:92.5

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏱️ 12:00:35
```

---

## 故障排查

### QQ 消息未收到

1. **检查 API 地址**: 确保 QQ_BOT_API 可访问
   ```bash
   curl http://localhost:5700/get_version_info
   ```

2. **检查目标 ID**: 确认 QQ_TARGET_ID 正确

3. **查看日志**: 
   ```bash
   tail -f logs/daily-scan.log
   ```

4. **网络问题**: 如果 Bot 在远程服务器，确保网络可达

### 配置不生效

确保环境变量已正确导出：
```bash
cd "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/操作系统/peistock"
source .env
npx tsx scripts/daily-watchlist-scan.ts
```

或在运行前显式设置：
```bash
QQ_BOT_API=xxx QQ_TARGET_ID=xxx npx tsx scripts/daily-watchlist-scan.ts
```

---

## 安全提示

⚠️ **不要**将 `.env` 文件提交到 Git！

已在 `.gitignore` 中添加：
```
.env
.env.local
```
