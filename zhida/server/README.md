# 学习目标规划 · 后端

FastAPI + MySQL（本机 `ai_work_zd`）+ 大模型（`.env`）。

## 启动

```powershell
cd d:\code\ai_work\zhida\server
.\.venv\Scripts\activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

或工作区：

```powershell
cd d:\code\ai_work
.\scripts\start.ps1 zhida
```

健康检查：`http://127.0.0.1:8000/health`

## 说明

- 配置读取上级目录 `zhida/.env`
- MySQL 5.5 兼容：JSON 字段用 TEXT 存字符串
- `APP_ENV=dev` 且 `AUTH_DEV_MODE=true`：可用 `/api/auth/dev-login` 与开发态会员开通
- `APP_ENV=prod`：启动自检（强 JWT、关 dev 登录、必填微信、显式 `CORS_ORIGINS`）；开发接口返回 403
- AI 规划两阶段：**模块草案**（技能分类/学习模块）→ **确认后展开任务并排期**
- LLM 失败时规划/重规划自动回落本地模板

## 测试

```powershell
cd d:\code\ai_work\zhida\server
.\.venv\Scripts\activate
pip install -r requirements.txt
pytest -q
```
