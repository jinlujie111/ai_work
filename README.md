# ai_work

个人副业作品集工作区。各子项目**相互独立**（代码、文档、端口、AppID 均分开），仅在本目录做集中索引与启动。

## 产品一览

| 目录 | 产品名 | 推广语 | 类型 | 状态 |
|------|--------|--------|------|------|
| [`piaoqi`](./piaoqi/) | **票齐** | 票一拍，齐入表 | 微信小程序 | 产品文档 |
| [`zhida`](./zhida/) | **学习目标规划** | 拆模块，日日推进 | 微信小程序 + API | P0 可跑 |
| [`luyang`](./luyang/) | **路养** | 边开边养，开到更远 | 微信小游戏 / H5 | 产品文档 |
| [`game_live`](./game_live/) | **森林求生** | 单指拖动，活到天亮 | H5 / 微信小游戏 | 可玩原型 |

> 原 [`riqing`](./riqing/)（日清）已取消，由 **学习目标规划**（工程 `zhida`）接替端口 `7102`。

## 命名（方便推广）

| 产品 | 名 | 为何好推 |
|------|----|----------|
| 发票单据 → 表 | **票齐** | 两字好记；口号「票一拍，齐入表」 |
| 学习目标规划 | **学习目标规划** | 口号「拆模块，日日推进」；工程 id 仍为 `zhida` |
| 公路双养成 | **路养** | 两字好记；口号「边开边养，开到更远」 |

文件夹对应：`piaoqi` / `zhida` / `luyang` / `game_live`。项目间不共享业务库。

## 集中启动

注册表：[`scripts/projects.json`](./scripts/projects.json)

```powershell
cd d:\code\ai_work

.\scripts\start.ps1              # 列出
.\scripts\start.ps1 game_live    # 启动有服务的项目
.\scripts\start.ps1 all
```

- `game_live`：静态服务（默认 8080）  
- `zhida`：FastAPI（默认 8000）+ 小程序 `zhida/wx`  
- `piaoqi`：当前仅文档；`luyang` / `game_live` 可启动

## 文档入口

| 项目 | 产品文档 |
|------|----------|
| 票齐 | [`piaoqi/doc/product-design.md`](./piaoqi/doc/product-design.md) |
| 学习目标规划 | [`zhida/doc/product-design.md`](./zhida/doc/product-design.md) |
| 路养 | [`luyang/doc/product-design.md`](./luyang/doc/product-design.md) |
| 森林求生 | [`game_live/doc/game-design-spec.md`](./game_live/doc/game-design-spec.md) |

## 独立约定

1. 各项目自有 `README.md` + `doc/`  
2. 端口：票齐 `7101`，学习目标规划 API `8000`，路养 `7103`，森林求生 `8080`  
3. 线上路径按项目隔离  
4. 微信侧各产品独立 AppID  
