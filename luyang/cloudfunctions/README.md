# 路养 · 微信云开发

## 一次性开通

1. 微信开发者工具打开本项目根目录（小游戏）
2. 把 `project.config.json` 的 `appid` 改成你的小游戏 AppID
3. 顶部「云开发」→ 开通 → 创建环境（免费额度即可）
4. 把环境 ID 填进 `src/config.js` 的 `cloudEnvId`
5. 云开发控制台 → 数据库 → 新建集合 `user_progress`
6. 右键 `cloudfunctions/saveProgress`、`getProgress` → 上传并部署（云端安装依赖）

## 集合字段（示例）

| 字段 | 说明 |
|------|------|
| gold | 累计金币 |
| unlocked.appearance | 已解锁外观 id 列表 |
| appearance | 当前外观 |
| runs | 局数 |
| bestDistance | 最远距离 |
| updatedAt | 毫秒时间戳 |

## 说明

- H5 本地试玩只用 `localStorage`，不连云
- 小游戏端：本地先写，再异步 `callFunction` 同步
- 个人主体首发以广告为主；云开发只做存档，不做支付校验
