/* 拼车狂飙 · 数值总表 */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  LY.Params = {
    BASE_W: 750,
    BASE_H: 1334,

    goalDistance: 5500,
    laneCount: 3,

    horizonY: 390,
    roadBottomY: 1180,
    camDepth: 280,
    viewDepth: 2200,
    roadWidthNear: 680,
    laneWorld: 220,
    carZ: 40,
    spawnZ: 2100,
    hitZ: 55,
    despawnZ: -90,
    carDrawW: 90,
    carDrawH: 130,
    segLength: 40,
    laneLerp: 10,

    baseSpeed: 170,
    speedPerPoint: 12,
    maxSpeedMul: 1.6,

    bagSlotsTemp: 4,
    maxPartStacks: 2,

    obstacleInterval: [3.0, 4.8],
    absorbInterval: [4.5, 7.0],
    dropInterval: [7, 11],

    /* 星级 / 金币：G = 20 + 8*N */
    goldBase: 20,
    goldPerStage: 8,
    starMul: { 3: 1.5, 2: 1.0, 1: 0.6, 0: 0.15 },
    starTime3: 55,
    starTime2: 75,
    starMinIntegrity3: 0.55,

    /* 商城：Lv1 起价，缓增（防爆炸） */
    shopBuyLv1: 40,
    shopBuyGrowth: 1.55,
    shopSellRate: 0.5,

    dropBaseCount: 3
  };

  LY.Params.buyPrice = function (level) {
    var lv = Math.max(1, Math.min(30, level | 0));
    var p = LY.Params.shopBuyLv1;
    for (var i = 1; i < lv; i++) p = Math.floor(p * LY.Params.shopBuyGrowth);
    return p;
  };

  LY.Params.sellPrice = function (level) {
    return Math.floor(LY.Params.buyPrice(level) * LY.Params.shopSellRate);
  };

  LY.Params.dropLevel = function (stageId) {
    return Math.min(30, Math.ceil((stageId || 1) / 5));
  };

  LY.Params.stageGold = function (stageId, stars) {
    var g = LY.Params.goldBase + LY.Params.goldPerStage * (stageId || 1);
    var mul = LY.Params.starMul[stars] != null ? LY.Params.starMul[stars] : LY.Params.starMul[0];
    return Math.max(0, Math.floor(g * mul));
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LY.Params;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
