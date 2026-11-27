# 拼车狂飙

> **别人撞车 Game Over，你撞车越撞越大**  
> 公路伪 2.5D + 撞装临时件 + 窄路丢件 + 车型技能 + 星级/商城/合成/车阶

工程目录 id：`luyang`

## 文档

| 文档 | 说明 |
|------|------|
| [`doc/product-design.md`](./doc/product-design.md) | 产品设计 |
| [`cloudfunctions/README.md`](./cloudfunctions/README.md) | 云开发 |

## 本地试玩

```powershell
cd d:\code\ai_work
.\scripts\start.ps1 luyang
```

打开 `http://localhost:7103`

操作：`←→` 变道，`空格`/`F` 技能，`Esc` 暂停。

## 已实现（对照文档 §18）

1. 局内撞装：防撞杠 / 宽轮胎 / 货箱 + 窄路检查点  
2. 三星结算 + 金币公式  
3. 关卡掉落（每 5 关升一阶）+ 背包  
4. 合成 2→1；商城买/卖 50%  
5. 开局赠送自行车 + 技能「铃响闪身」  
6. 车库升阶换车换技能（V1→更高）

## 微信小游戏

导入本目录 → 填 AppID → 配 `cloudEnvId` → 部署云函数。
