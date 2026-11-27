# 学习目标规划 · 微信小程序

> 目录：`zhida/wx`  
> **后续小程序开发均在本目录进行。**

用微信开发者工具打开本目录（选择 `zhida/wx`）。

## 设计

- 形态：App Shell 四 Tab（概览 / 日历 / 目标 / 我的）  
- 色板：Teal & Clay（青绿主色 + 陶土辅色），避开默认蓝/紫  
- 规范：原生 JS 小程序 + finesse UI skill（h5 / product / AI 确认流）

## P0（已接后端）

1. 启动 `zhida/server`（开发常用 `http://127.0.0.1:8001`）  
2. 开发者工具打开本目录，勾选「不校验合法域名」  
3. **学习** → 新建 → AI 拆模块 → 勾选确认并排期 → **今日** 执行 / 延期 → **周复盘**

前端配置统一在 [`utils/config.js`](./utils/config.js)（`apiBase`、公开 `wxAppId` 等）。  
服务端密钥在上级 [`../.env`](../.env)（`WX_SECRET`、大模型、MySQL）。未配 Secret 或登录失败时可回落开发登录。

## 结构

```text
wx/
  app.js / app.json / app.wxss
  custom-tab-bar/
  services/          # store · planner · id
  pages/
    today(概览)/ calendar/ goals(目标)/ mine/
    goal-create/ plan-confirm/ goal-detail/
    replan/ review/
  utils/
```

产品文档：[`../doc/product-design.md`](../doc/product-design.md)

## 配置

- `appid`：默认 `touristappid`，正式环境自行替换  
- `app.js` → `globalData.apiBase`：后端就绪后填写  
