/* 森林求生｜数值总表
   全部数值来自 doc/game-design-spec.md 第六章「数值总表」与第二、三章的规格表。
   改数值只改这里，不要散落到逻辑代码里。 */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};

  /* ── 基准分辨率（spec 0. 文档约定） ── */
  var P = {
    BASE_W: 750,
    BASE_H: 1334,

    /* ── 6.1 玩家 ── */
    player: {
      radius: 14,
      speed: 180,
      accel: 900,          // 转向加速度
      decel: 1400,         // 停止减速度
      tempMax: 100,
      tempFail: 0
    },

    /* ── 6.2 动物 ── */
    animals: {
      bear: {
        radius: 20,
        patrolSpeed: 62,
        chaseSpeed: 88,
        nightSpeed: 88,
        senseDist: 260,
        coneDeg: 90,
        alertPause: 0.8,    // 警觉停顿，头顶感叹号
        loseTargetTime: 2,  // 丢失目标后转 SEARCH
        searchTime: 3,      // 搜索时长
        contact: 34,        // 接触判定，玩家被抓
        decoyRange: 220,    // 诱饵：兔在此范围内则改追兔
        decoyTime: 4
      },
      snake: {
        radius: 16,
        speed: 0,
        senseDist: 70,
        trigger: 46,        // 触发半径
        biteDelay: 0.4,     // 咬击延迟，有嘶声预警
        poisonTemp: -30,
        poisonTime: 3
      },
      rabbit: {
        radius: 12,
        speed: 120,
        senseDist: 300,     // 逃跑触发
        capture: 26,        // 捕获判定
        score: 2,
        wanderSpeed: 26
      }
    },

    /* ── 6.3 资源与状态 ── */
    resource: {
      berry:  { score: 1, temp: 15 },
      gold:   { score: 3, temp: 40 },
      wood:   { score: 0, temp: 0 },
      herb:   { score: 0, temp: 0 }
    },
    temp: {
      dayChange: 0,        // 白天体温不变
      fireGain: 6,         // 夜晚火堆内
      nightLoss: 2.5       // 夜晚火堆外
    },
    fire: {
      radius: 180,         // 保暖半径
      woodPerBurn: 10,     // 每 10 秒消耗 1 个木头
      burnTime: 10,
      woodStock: 3         // 初始木头存量
    },

    /* ── 6.4 采集 ── */
    collect: {
      time: 0.8,           // 采集耗时
      radius: 28,          // 拾取半径
      respawnDay: 6,       // 资源刷新间隔
      respawnNight: 12
    },

    /* ── 2.3 昼夜 ── */
    dayNight: {
      dayLength: 60,
      nightLength: 30,
      nightVision: 320,    // 夜晚视野半径
      visionFeather: 40,
      outsideBrightness: 0.25,
      nightResourceScale: 0.5
    },

    /* ── 5.2 输入 ── */
    input: {
      maxDragOffset: 120   // 拖动最大偏移
    },

    /* ── 5.3 摄像机 ── */
    camera: {
      deadZone: 40,
      lerp: 0.12,
      zoom: 1.0
    },

    /* ── 2.2 地图通用规则 ── */
    map: {
      border: 80,          // 四周不可达边界
      spawnSafeDist: 260,  // 出生点距危险物至少
      squashY: 0.85        // 7.2 垂直压缩
    },

    /* ── 3.1 采集后行为 ── */
    poison: {
      cureByHerb: true
    }
  };

  /* 便捷取值 */
  P.animal = function (type) { return P.animals[type]; };
  P.res = function (type) { return P.resource[type]; };

  DF.Params = P;
  if (typeof module !== 'undefined' && module.exports) { module.exports = P; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));