# 学习目标规划

> **拆模块，日日推进**  
> 微信小程序：AI 理解学习目标 → 拆技能模块 → 确认后排期 → 每日执行 → 偏差重规划 → 周期复盘

工程目录仍为 `zhida`（与 [`../piaoqi`](../piaoqi)、[`../luyang`](../luyang)、[`../game_live`](../game_live) **相互独立**）。

> 原「日清 / `riqing`」项目已取消，由本产品接替。

## 目录

| 路径 | 说明 |
|------|------|
| [`wx/`](./wx/) | 微信小程序 |
| [`wx/utils/config.js`](./wx/utils/config.js) | **小程序公开配置**（api 地址、AppID、开关） |
| [`server/`](./server/) | FastAPI 后端（MySQL + LLM） |
| [`web/`](./web/) | 运营看板（挂载于 `/ops`） |
| [`doc/`](./doc/) | 产品与可行性文档 |
| [`deploy/aliyun-dev/`](./deploy/aliyun-dev/) | 阿里云开发版部署包 |
| [`.env`](./.env) | **服务端环境与密钥**（勿提交） |

配置分工：客户端只改 `wx/utils/config.js`；密钥与数据库只改 `.env`。

## 进度

| 阶段 | 状态 |
|------|------|
| P0 执行闭环 | 已通（模块草案 → 确认排期、今日任务、延期重规划、周复盘、版本回滚） |
| P1 | 已通：技能档案落库/确认写入/建目标读档、日复盘、会员与多目标、订阅偏好、语音建目标、学习资源与可视化 |
| P2 核心 | 已通：技能图谱与导出、学习日历/ICS、任务依赖、云端同步标记 |

## 本地启动

```powershell
cd d:\code\ai_work
.\scripts\start.ps1 zhida
# 或
cd d:\code\ai_work\zhida\server
.\run.ps1
```

微信开发者工具打开 **`zhida/wx`**。

---

## 阿里云开发版运维

| 项 | 值 |
|----|-----|
| 服务器目录 | `/opt/ai_work/zhida` |
| 对外地址 | `https://instockdetail.com/ai_work/xuexi` |
| 内网端口 | `7102` |
| 环境 | `APP_ENV=dev` |
| systemd | `zhida-api` |
| 配置 | `/opt/ai_work/zhida/.env` |
| 部署包 | [`deploy/aliyun-dev/`](./deploy/aliyun-dev/) |

### 服务启动 / 停止 / 重启

首次安装：

```bash
cd /opt/ai_work/zhida
sudo bash deploy/aliyun-dev/install.sh
sudo nano /opt/ai_work/zhida/.env
sudo mysql < deploy/aliyun-dev/mysql-init.sql
sudo systemctl start zhida-api
```

日常：

```bash
sudo systemctl start zhida-api
sudo systemctl stop zhida-api
sudo systemctl restart zhida-api
sudo systemctl status zhida-api
```

健康检查：

```bash
curl -s http://127.0.0.1:7102/health
curl -s https://instockdetail.com/ai_work/xuexi/health
# {"ok":true,"service":"zhida","app_env":"dev"}
```

### 日志定位

```bash
sudo journalctl -u zhida-api -f
sudo journalctl -u zhida-api -n 200 --no-pager
sudo journalctl -u zhida-api --since "1 hour ago"
sudo journalctl -u zhida-api -g "ERROR|Traceback|LLM|intent" -n 100 --no-pager
```

Nginx：`/var/log/nginx/access.log`、`/var/log/nginx/error.log`

### Web 运营后端

| 项 | 地址 |
|----|------|
| 看板 | https://instockdetail.com/ai_work/xuexi/ops/ |
| 登录 API | `POST /api/admin/ops/login` |
| 业务 API | `/api/admin/ops/*` |

账号在 `.env`：`ADMIN_USERNAME` / `ADMIN_PASSWORD`（可选 `ADMIN_TOKEN`）。

### Nginx

```nginx
location /ai_work/xuexi/ {
    proxy_pass http://127.0.0.1:7102/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 小程序

```js
// wx/utils/config.js
apiBase: 'https://instockdetail.com/ai_work/xuexi'
```

微信 request 合法域名：`https://instockdetail.com`。

### 排障

| 现象 | 处理 |
|------|------|
| health 不通 | `systemctl status zhida-api`；确认 `.env` 路径 |
| 502 | API 未起或 Nginx 未指到 7102 |
| 小程序 Not Found | `apiBase` 是否含 `/ai_work/xuexi` |
| 流式卡住 | Nginx 需 `proxy_buffering off` |
| 看板进不去 | 检查 `ADMIN_*` 与 `/ops/` 路径 |
| MySQL 报错 | `DATABASE_URL` / 账号 / 安全组 |

---

## 文档

| 文档 | 说明 |
|------|------|
| [`doc/product-design.md`](./doc/product-design.md) | PRD |
| [`doc/market-analysis.md`](./doc/market-analysis.md) | 竞品 |
| [`doc/feasibility.md`](./doc/feasibility.md) | 可执行性 |
| [`deploy/aliyun-dev/README.md`](./deploy/aliyun-dev/README.md) | 阿里云开发版部署细节 |

## 推广要点

- 名：**学习目标规划**
- 口号：拆模块，日日推进
