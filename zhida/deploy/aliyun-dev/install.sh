#!/usr/bin/env bash
# 阿里云 ECS · 学习者开发版安装
#
# 代码已在 /opt/ai_work 时（就地安装，推荐）：
#   cd /opt/ai_work/zhida
#   sudo bash deploy/aliyun-dev/install.sh
#
# 或指定目录：
#   sudo bash deploy/aliyun-dev/install.sh /opt/ai_work/zhida
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ZHIDA="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_ROOT="${1:-$REPO_ZHIDA}"

echo "==> 安装目录: $APP_ROOT"
echo "==> 脚本所在工程: $REPO_ZHIDA"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请使用 root 或 sudo 执行"
  exit 1
fi

if [[ ! -d "$APP_ROOT/server" ]]; then
  echo "未找到 $APP_ROOT/server ，请确认路径是 zhida 工程根目录"
  exit 1
fi

apt-get update -y
apt-get install -y python3 python3-venv python3-pip nginx mysql-client curl rsync

# 仅当目标目录与当前工程不同时才同步；/opt/ai_work 已上传则跳过
if [[ "$(cd "$APP_ROOT" && pwd)" != "$(cd "$REPO_ZHIDA" && pwd)" ]]; then
  mkdir -p "$APP_ROOT"
  rsync -a \
    --exclude '.venv' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    --exclude 'wx/node_modules' \
    "$REPO_ZHIDA/" "$APP_ROOT/"
  echo "==> 已同步到 $APP_ROOT"
else
  echo "==> 就地安装，跳过 rsync"
fi

if [[ ! -f "$APP_ROOT/.env" ]]; then
  cp "$APP_ROOT/deploy/aliyun-dev/env.aliyun.dev.example" "$APP_ROOT/.env"
  chmod 600 "$APP_ROOT/.env"
  echo "==> 已生成 $APP_ROOT/.env ，请编辑填入 MySQL / LLM / 微信密钥"
else
  echo "==> 已存在 $APP_ROOT/.env ，保留不覆盖"
fi

cd "$APP_ROOT/server"
python3 -m venv .venv
# shellcheck disable=SC1091
. .venv/bin/activate
pip install -U pip
pip install -r requirements.txt

UNIT=/etc/systemd/system/zhida-api.service
cp "$APP_ROOT/deploy/aliyun-dev/zhida-api.service" "$UNIT"
# 把 unit 里的占位路径换成实际 APP_ROOT
sed -i "s|/opt/ai_work/zhida|$APP_ROOT|g" "$UNIT"
sed -i "s|/opt/zhida|$APP_ROOT|g" "$UNIT"

id www-data >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin www-data
chown -R www-data:www-data "$APP_ROOT"
# .env 仅运行用户可读
chmod 600 "$APP_ROOT/.env" 2>/dev/null || true

systemctl daemon-reload
systemctl enable zhida-api

echo ""
echo "安装完成（开发版）。接下来："
echo "  1) sudo nano $APP_ROOT/.env"
echo "  2) 初始化 MySQL：sudo mysql < $APP_ROOT/deploy/aliyun-dev/mysql-init.sql"
echo "  3) sudo systemctl start zhida-api && sudo systemctl status zhida-api"
echo "  4) curl -s http://127.0.0.1:7102/health"
echo "  5) Nginx：参考 $APP_ROOT/deploy/aliyun-dev/nginx.zhida.dev.conf"
echo "  6) 小程序 apiBase → https://instockdetail.com/ai_work/xuexi"
echo ""
