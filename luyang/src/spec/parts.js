/* 拼车狂飙 · 局内临时零件（撞装，不进商城） */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  var LIST = [
    {
      id: 'bumper',
      name: '防撞杠',
      color: '#9aa0a6',
      widthAdd: 0.04,
      lengthAdd: 0.08,
      steerMul: 1,
      speedMul: 1,
      scoreMul: 1.05,
      shield: 1,
      maxStacks: 2
    },
    {
      id: 'wide_tire',
      name: '宽轮胎',
      color: '#333',
      widthAdd: 0.22,
      lengthAdd: 0.02,
      steerMul: 0.92,
      speedMul: 0.98,
      scoreMul: 1.08,
      shield: 0,
      maxStacks: 2
    },
    {
      id: 'crate',
      name: '货箱',
      color: '#c4a574',
      widthAdd: 0.06,
      lengthAdd: 0.18,
      steerMul: 0.78,
      speedMul: 0.9,
      scoreMul: 1.2,
      shield: 0,
      maxStacks: 2
    }
  ];

  var BY = {};
  for (var i = 0; i < LIST.length; i++) BY[LIST[i].id] = LIST[i];

  LY.Parts = {
    list: LIST,
    get: function (id) { return BY[id] || null; },
    randomId: function (rng) { return rng.pick(LIST).id; },

    derive: function (tempParts, vehicle) {
      var width = (vehicle && vehicle.baseWidth) || 1;
      var length = (vehicle && vehicle.baseLength) || 1;
      var steer = 1;
      var speed = (vehicle && vehicle.baseSpeedMul) || 1;
      var score = 1;
      var shield = 0;
      var counts = {};
      for (var i = 0; i < (tempParts || []).length; i++) {
        var id = tempParts[i];
        var p = BY[id];
        if (!p) continue;
        var prev = counts[id] || 0;
        if (prev >= (p.maxStacks || 2)) continue;
        counts[id] = prev + 1;
        var fade = prev === 0 ? 1 : 0.55;
        width += p.widthAdd * fade;
        length += p.lengthAdd * fade;
        steer *= 1 - (1 - p.steerMul) * fade;
        speed *= 1 - (1 - p.speedMul) * fade;
        score *= 1 + (p.scoreMul - 1) * fade;
        if (p.shield) shield += Math.round(p.shield * fade);
      }
      return {
        width: width,
        length: length,
        steerMul: steer,
        speedMul: speed,
        scoreMul: score,
        shield: shield,
        integrity: tempParts && tempParts.length ? Math.min(1, tempParts.length / 3) : 0.3
      };
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LY.Parts;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
