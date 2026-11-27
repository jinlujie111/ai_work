/* 拼车狂飙 · 路段关卡（前 10 关可玩，其后可按公式扩） */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  function makeStage(id, name, blurb, goal, extras) {
    extras = extras || {};
    return {
      id: id,
      name: name,
      blurb: blurb,
      goalDistance: goal,
      dropLevel: Math.min(30, Math.ceil(id / 5)),
      dropCount: extras.dropCount || 3,
      checkpointAt: extras.checkpointAt != null ? extras.checkpointAt : 0.55,
      checkpointMaxWidth: extras.checkpointMaxWidth != null ? extras.checkpointMaxWidth : 1.25,
      absorbInterval: extras.absorbInterval || [4.5, 7],
      hazardInterval: extras.hazardInterval || [3.2, 5],
      teachAbsorb: !!extras.teachAbsorb,
      starTime3: extras.starTime3 || 55,
      starTime2: extras.starTime2 || 75
    };
  }

  var LIST = [
    makeStage(1, '废铁直道', '撞第一块废铁试试', 4800, {
      teachAbsorb: true,
      checkpointAt: 0.62,
      checkpointMaxWidth: 1.35,
      absorbInterval: [5.5, 8],
      hazardInterval: [5.5, 8],
      starTime3: 70,
      starTime2: 95
    }),
    makeStage(2, '第一次变宽', '宽了就难过窄路', 5600, { checkpointMaxWidth: 1.15 }),
    makeStage(3, '贪分货箱', '货箱很香也很钝', 6000, { absorbInterval: [4, 6] }),
    makeStage(4, '防撞考验', '致命障碍变多', 6200, { hazardInterval: [2.4, 4.0] }),
    makeStage(5, '组合关', '丢还是硬闯', 6500, { checkpointMaxWidth: 1.1, dropCount: 4 }),
    makeStage(6, '二级料场', '开始掉 Lv2', 6800, { dropCount: 4 }),
    makeStage(7, '雨后路肩', '障碍更密', 7000, { hazardInterval: [2.2, 3.8] }),
    makeStage(8, '窄桥', '必须瘦身', 7200, { checkpointMaxWidth: 1.05 }),
    makeStage(9, '高速汇入', '节奏加快', 7500, {}),
    makeStage(10, '十关验收', '刷满三星', 7800, { dropCount: 5, checkpointMaxWidth: 1.08 })
  ];

  for (var n = 11; n <= 30; n++) {
    LIST.push(makeStage(n, '路段' + n, '掉落 Lv' + Math.ceil(n / 5), 5000 + n * 280, {
      dropCount: 4,
      checkpointMaxWidth: Math.max(0.95, 1.3 - n * 0.01)
    }));
  }

  var BY = {};
  for (var i = 0; i < LIST.length; i++) BY[LIST[i].id] = LIST[i];

  LY.Levels = {
    list: LIST,
    count: LIST.length,
    get: function (id) { return BY[id] || LIST[0]; },
    nextId: function (id) {
      var n = (id | 0) + 1;
      return BY[n] ? n : null;
    },
    isUnlocked: function (id, progress) {
      var max = (progress && progress.maxLevel) || 1;
      return id <= max;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LY.Levels;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
