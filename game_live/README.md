# 森林求生 · Nightfall Forest

单指拖动，在森林里活到天亮。

一款按 [`doc/game-design-spec.md`](doc/game-design-spec.md) 实现的 H5 + 微信小游戏双端游戏；海外切面定位为 **cozy-lite survival**（舒服的轻度生存关卡）。**零依赖、零构建**，双击 `index.html` 就能玩。

![平台](https://img.shields.io/badge/platform-H5%20%7C%20WeChat%20mini--game-informational)

---

## 核心体验

| | |
| --- | --- |
| **一句话** | 单指拖动，在森林里活到天亮 |
| **品类切面** | cozy-lite survival：短局、可控压力、温暖气质（详见 [`doc/cozy-lite-survival-design.md`](doc/cozy-lite-survival-design.md)） |
| **唯一操作** | 屏幕任意位置按住拖动，角色朝手指移动（最大偏移 120 像素），松手停下 |
| **唯一目标** | 活到天亮。资源不是并列目标，是活下去的手段 |
| **界面** | 顶部常驻：第 N 夜与夜名、目标、星星、温暖条、倒计时、分数；底部是目标进度 |
| **单局时长** | 60 到 120 秒（含黄昏过渡，禁止硬切入夜） |
| **三处深度** | 模式识别（动物行为可预测）、风险定价（好资源在危险区）、时间压力（昼夜改变同一动作的难度） |

### 隐藏耦合

首版只启用一条：**兔子可以引开熊**。不解释规则，玩家被熊追时慌乱跑向兔子，熊转身去追兔子——玩家会自己愣一下，然后试第二次。

---

## 玩法元素

| 元素 | 规格 |
| --- | --- |
| 玩家 | 半径 14，移动 180 像素每秒，转向加速度 900，体温上限 100 |
| 熊 | 巡逻→警觉→追击→搜索，感知 260，视锥 90 度，接触 34 即被抓 |
| 蛇 | 静止伏击，触发半径 46，咬击延迟 0.4 秒，中毒扣 30 体温持续 3 秒 |
| 兔 | 300 像素内逃跑，捕获 26，捕获后成为诱饵，可引开追击中的熊 4 秒 |
| 浆果 | 1 分，回温 15 |
| 金浆果 | 3 分，回温 40，仅刷在危险区 |
| 木头 | 唯一燃料，送达火堆后每 10 秒烧掉 1 根 |
| 药草 | 解除中毒 |
| 火堆 | 半径 180 内夜间回温 +6/秒，熄灭后不再回温 |

昼夜：白天 60 秒全视野，夜晚 30 秒视野缩到 320 像素圆形（外侧亮度 25%），熊提速到 88，资源刷新间隔翻倍。

---

## 关卡规则

每关的规则、目标、星星条件和教学目的写在 [`doc/level-design.md`](doc/level-design.md)，**由 `src/spec/levels.js` 自动生成**，改关卡改代码再重新生成，文档不会和代码脱节。

游戏内顶部也会常驻显示：**第 N 夜 · 夜名 · 本夜目标**，右上角三颗星实时反映达成状态，结算页列出每条星星条件的达成与否（成功「天亮了」/ 失败「今晚没撑住」）。

| 章 | 名称 | 关卡 | 主题 |
| --- | --- | --- | --- |
| 一 | 林缘 | 1 到 10 | 移动、采集、昼夜、火堆、风险定价、兔子诱饵 |
| 二 | 深处 | 11 到 20 | 蛇出场，药草解毒，机制两两叠加 |
| 三 | 水岸 | 21 到 30 | 水潭地形决定路线，绕路与夜渡 |
| 四 | 猎场 | 31 到 40 | 熊的领地，多熊巡逻，熊的视线与火堆 |
| 五 | 深冬 | 41 到 50 | 综合与约束，长夜、无火堆、药草稀缺 |

---

## 运行

### H5

```bash
start index.html
# 或
python -m http.server 8080
```

### 微信小游戏

1. 微信开发者工具 → 导入项目 → 目录选本仓库根目录 → 项目类型选「小游戏」
2. 填自己的小游戏 AppID（没有就点「测试号」）
3. 点工具栏「**预览**」→ 弹出二维码 → 手机微信「扫一扫」

> ⚠️ 别点「真机调试」，那是要在手机上装调试 APK 用来看日志的。

### 手机试玩

```bash
node tools\build-standalone.js    # 产出 dist\deep-forest-standalone.html（单文件，零依赖）
node tools\serve.js 8080          # 局域网服务，手机访问 http://<电脑IP>:8080
```

---

## 工程结构

```
index.html              H5 页面骨架
styles.css              H5 界面样式
game.js                 微信小游戏入口
game.json                小游戏配置
project.config.json      微信开发者工具配置
src/
  util.js               数学、可播种随机、噪声、事件总线、平台适配层
  audio.js              WebAudio 合成音效（无外部音频文件）
  input.js              拖动输入（最大偏移 120）与键盘等价输入
  spec/params.js        数值总表（对应设计文档第六章）
  spec/levels.js        五个地图模板与关卡配置
  game/entities.js      玩家、熊、蛇、兔、资源、火堆
  game/level.js         关卡运行时：昼夜、体温、采集、目标与三星判定
  game/render.js        扁平几何 2.5D 渲染、动态光照、程序化动效
  game/core.js          固定步长主循环、摄像机、存档
  ui/dom.js             H5 界面层
  ui/canvas.js          小游戏 Canvas 界面层
  boot/web.js           H5 启动
  boot/minigame.js      小游戏启动
test/
  forest-sim.js         关卡逻辑模拟（Node，30 项断言）
  soak-script.js        H5 浏览器冒烟测试
  minigame-script.js    小游戏端测试
  wx-mock.js            微信 API 模拟器
  bundle-minigame.js    小游戏源码打包（仅测试用）
  gen-test-pages.js     从 index.html 生成测试页
  run-tests.js / .cmd   无头测试驱动
tools/
  serve.js              局域网静态服务器
  build-standalone.js   单文件打包
```

### 实现要点

- **固定步长**：主循环 1/60 秒定步长 + 累加器，单帧最多 5 步，避免掉帧后物理爆炸。
- **750 × 1334 基准**：等比缩放居中 letterbox，两端共用同一套像素数值。
- **动态光照**：离屏画布 `destination-out` 挖出视野圆，320 半径 + 40 羽化，视野外压到 25% 亮度。
- **2.5D 伪深度**：Y 轴压缩 0.85、接地阴影、按 y 排序、树冠遮挡角色。
- **动画全程序化**：玩家浮动、熊追击前倾、蛇弹起 15 度、兔高频跳动、采集缩小上飘、火苗双层交替。
- **确定性随机**：关卡由编号派生的种子生成，同一关每次进入布局一致。
- **目标系统不写死玩家**：动物的追击目标可指向其他动物，这是后续生态耦合的扩展基础。

---

## 测试

```bash
test\run-tests.cmd
```

三套一起跑：关卡逻辑模拟 30 项、H5 浏览器冒烟、微信小游戏端触摸链路。全部基于 Chrome DevTools Protocol，无头无依赖。

---

## 设计文档

- [`doc/game-design-spec.md`](doc/game-design-spec.md) 纯设计规格（数值总表、验收清单）
- [`doc/cozy-lite-survival-design.md`](doc/cozy-lite-survival-design.md) cozy-lite 气质改造与 Steam 包装
- [`doc/level-design.md`](doc/level-design.md) 50 夜逐关规则与教学目的（自动生成）
- [`doc/ecology-coupling-design.md`](doc/ecology-coupling-design.md) 生态耦合清单
- [`doc/hyper-casual-forest-design.md`](doc/hyper-casual-forest-design.md) 商业与市场判断
- [`doc/implementation-roadmap.md`](doc/implementation-roadmap.md) 实施进度