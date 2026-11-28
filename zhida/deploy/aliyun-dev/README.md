# 阿里云部署 · 开发版（APP_ENV=dev）

把「学习者」后端跑在阿里云 ECS 上，供微信开发者工具 / 真机调试使用。  
**开发版**特点：`APP_ENV=dev` + `AUTH_DEV_MODE=true`（可用开发登录、一键会员）；正式上线再切 `prod`。

## 架构

```text
微信小程序 / 开发者工具
        │  https://instockdetail.com/ai_work/xuexi
        ▼
  Nginx :80/443
  /ai_work/xuexi/  ──proxy_pass──►  uvicorn 127.0.0.1:7102
                                        │
                                        ▼
                                     MySQL (本机或 RDS)
```

- API 根：`https://instockdetail.com/ai_work/xuexi`
- 健康检查：`https://instockdetail.com/ai_work/xuexi/health`
- 运营看板：`https://instockdetail.com/ai_work/xuexi/ops/`

## 服务器准备

| 项 | 建议 |
|----|------|
| 系统 | Ubuntu 22.04 LTS |
| 规格 | 2 核 4G 起（LLM 调用主要耗外网） |
| 安全组 | 放行 22、80、443；**不要**对公网开放 7102 |
| 软件 | Python 3.10+、Nginx、MySQL 8（或阿里云 RDS） |

## 1. 代码位置（你已上传）

推荐目录：

```text
/opt/ai_work/          # 整个工作区
/opt/ai_work/zhida/    # 本项目（.env、server、wx、deploy）
```

就地安装：

```bash
cd /opt/ai_work/zhida
sudo bash deploy/aliyun-dev/install.sh
```

脚本会：装依赖、建 venv、生成 `.env`（若不存在）、注册 `zhida-api` systemd。

> 若本机改过 `deploy/` 后需再上传一次，再执行上述 `install.sh`。

## 2. 配置环境（开发版）

```bash
sudo nano /opt/ai_work/zhida/.env
```

对照 [`env.aliyun.dev.example`](./env.aliyun.dev.example) 填写：

- `APP_ENV=dev`、`AUTH_DEV_MODE=true`（保持开发版）
- `APP_PORT=7102`
- MySQL / `DATABASE_URL`
- `QWEN_PERSONAL_API_KEY`（或 DeepSeek）
- `WX_APPID` / `WX_SECRET`
- `JWT_SECRET`（开发版也建议换掉默认值）
- 运营看板 `ADMIN_USERNAME` / `ADMIN_PASSWORD`

初始化库（本机 MySQL）：

```bash
# 先改 mysql-init.sql 里的密码，与 .env 一致
sudo mysql < /opt/ai_work/zhida/deploy/aliyun-dev/mysql-init.sql
```

表结构在服务首次启动时由 SQLAlchemy `init_db()` 自动建。

## 3. 启动 API

```bash
sudo systemctl start zhida-api
sudo systemctl status zhida-api
curl -s http://127.0.0.1:7102/health
# 期望：{"ok":true,"service":"zhida","app_env":"dev"}
```

常用：

```bash
sudo journalctl -u zhida-api -f
sudo systemctl restart zhida-api
```

## 4. Nginx

```bash
# 若 instockdetail.com 已有站点配置，把 location /ai_work/xuexi/ 粘进现有 server
# 或独立 conf（注意不要与现有 server_name 冲突）：
sudo cp /opt/ai_work/zhida/deploy/aliyun-dev/nginx.zhida.dev.conf /etc/nginx/conf.d/zhida-dev.conf
sudo nginx -t && sudo systemctl reload nginx
```

验证：

```bash
curl -s http://127.0.0.1:7102/health
curl -s https://instockdetail.com/ai_work/xuexi/health
```

## 5. 小程序指向云端

`zhida/wx/utils/config.js` 已设为：

```js
apiBase: 'https://instockdetail.com/ai_work/xuexi',  // 无末尾斜杠
preferWxLogin: true,
allowDevLoginFallback: true,  // 云上开发版可开
```

微信公众平台 → 开发管理 → 开发设置 → **服务器域名**：

- request 合法域名：`https://instockdetail.com`
- 开发者工具阶段可先勾选不校验

## 6. 防火墙 / 安全组

- 开放：22、80、443  
- 关闭公网：3306、7102  

## 开发版 vs 正式版

| | 开发版（本目录） | 正式版 |
|--|------------------|--------|
| `APP_ENV` | `dev` | `prod` |
| `AUTH_DEV_MODE` | `true` | `false` |
| 开发登录 / 一键会员 | 可用 | 禁用 |
| CORS | `*` 可 | 必须显式域名 |
| JWT / 微信 | 建议填真 | 强制校验 |

正式上线：把 `.env` 改成 `APP_ENV=prod`、`AUTH_DEV_MODE=false`，换强 `JWT_SECRET`，收紧 `CORS_ORIGINS`，再 `systemctl restart zhida-api`。

## 排障

| 现象 | 处理 |
|------|------|
| `health` 不通 | `systemctl status zhida-api`、看 `.env` 路径是否在 `/opt/zhida/.env` |
| MySQL 连不上 | 检查安全组、账号 host、`DATABASE_URL` 密码编码 |
| 小程序 Not Found | `apiBase` 是否为 `https://instockdetail.com/ai_work/xuexi`，Nginx `location /ai_work/xuexi/` 的 `proxy_pass` 是否带尾斜杠 |
| 流式草案卡住 | Nginx 需 `proxy_buffering off`（模板已写） |
| 微信登录失败 | `WX_SECRET`、AppID 是否一致；开发版可暂开 `allowDevLoginFallback` |
