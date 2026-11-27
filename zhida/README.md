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
| [`doc/`](./doc/) | 产品与可行性文档 |
| [`.env`](./.env) | **服务端环境与密钥**（LLM / MySQL / WX_SECRET / JWT；勿提交） |

配置分工：客户端只改 `wx/utils/config.js`；密钥与数据库只改 `.env`。

## 进度

| 阶段 | 状态 |
|------|------|
| P0 执行闭环 | 已通（模块草案 → 确认排期、今日任务、延期重规划、周复盘、版本回滚） |
| P1 | 已通：技能档案落库/确认写入/建目标读档、日复盘、会员与多目标、订阅偏好、语音建目标、学习资源与可视化 |
| P2 核心 | 已通：技能图谱与导出、学习日历/ICS、任务依赖、云端同步标记 |

## 本地启动

```powershell
# 后端
cd d:\code\ai_work
.\scripts\start.ps1 zhida
# 或
cd d:\code\ai_work\zhida\server
.\run.ps1
```

微信开发者工具打开 **`zhida/wx`**（`apiBase` 默认 `http://127.0.0.1:8001`，需勾选不校验合法域名）。

## 文档

| 文档 | 说明 |
|------|------|
| [`doc/product-design.md`](./doc/product-design.md) | PRD |
| [`doc/market-analysis.md`](./doc/market-analysis.md) | 竞品 |
| [`doc/feasibility.md`](./doc/feasibility.md) | 可执行性 |

## 推广要点

- 名：**学习目标规划**
- 口号：拆模块，日日推进
