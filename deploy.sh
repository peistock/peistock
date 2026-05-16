#!/bin/bash
# deploy.sh — 同步本地 rebel_research 到 JD Cloud 服务器
# 用法: ./deploy.sh

set -e

HOST="root@36.151.144.153"
REMOTE_DIR="/opt/rebel_research"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> 同步代码到 ${HOST}:${REMOTE_DIR}"
rsync -avz \
  --exclude='.git' \
  --exclude='.venv' \
  --exclude='__pycache__' \
  --exclude='data' \
  --exclude='storage/vector_index' \
  --exclude='.DS_Store' \
  --exclude='deploy-*.tar.gz' \
  "${LOCAL_DIR}/" "${HOST}:${REMOTE_DIR}/"

echo "==> 检查远程 .env"
ssh "${HOST}" "test -f ${REMOTE_DIR}/.env || echo 'WARN: 远程缺少 .env 文件'"

echo "==> 重启 API 服务"
ssh "${HOST}" "
  cd ${REMOTE_DIR}
  pkill -f 'uvicorn api_server:app' 2>/dev/null || true
  sleep 1
  PYTHONPATH=/opt/family-mind:/opt/rebel_research nohup .venv/bin/uvicorn api_server:app --host 0.0.0.0 --port 8000 > logs/api.log 2>&1 &
  echo 'API 服务已重启'
"

echo "==> 部署完成"
