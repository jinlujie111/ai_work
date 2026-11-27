/* 拼车狂飙 · 车阶与技能（V1～V8 实装，其后模板） */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  var LIST = [
    {
      tier: 1, name: '自行车', seats: 1, baseWidth: 0.85, baseLength: 0.9, baseSpeedMul: 0.95,
      color: '#6b8f71',
      skill: {
        id: 'bell_dash', name: '铃响闪身', desc: '短暂穿过一个非致命障碍',
        cooldown: 12, chargesPerRun: 3,
        effectType: 'iframe', effectParams: { duration: 0.8 }
      }
    },
    {
      tier: 2, name: '电动车', seats: 1, baseWidth: 0.9, baseLength: 0.95, baseSpeedMul: 1.05,
      color: '#4cc9f0',
      skill: {
        id: 'e_boost', name: '电门催速', desc: '短时加速',
        cooldown: 14, chargesPerRun: 0,
        effectType: 'speedburst', effectParams: { duration: 3, mul: 1.35 }
      }
    },
    {
      tier: 3, name: '摩托车', seats: 1, baseWidth: 0.88, baseLength: 1.0, baseSpeedMul: 1.12,
      color: '#ff5c5c',
      skill: {
        id: 'lean_lane', name: '压弯变道', desc: '瞬移变道并短暂缩窄',
        cooldown: 10, chargesPerRun: 0,
        effectType: 'lane_slim', effectParams: { duration: 1.2, widthMul: 0.7 }
      }
    },
    {
      tier: 4, name: '三轮摩托车', seats: 2, baseWidth: 1.05, baseLength: 1.05, baseSpeedMul: 1.0,
      color: '#e8a54b',
      skill: {
        id: 'stable', name: '稳坨', desc: '短暂忽略变宽惩罚',
        cooldown: 16, chargesPerRun: 0,
        effectType: 'stable', effectParams: { duration: 2.5 }
      }
    },
    {
      tier: 5, name: '微型轿车', seats: 2, baseWidth: 1.1, baseLength: 1.1, baseSpeedMul: 1.08,
      color: '#60a5fa',
      skill: {
        id: 'horn_clear', name: '喇叭清道', desc: '弹开前方小型障碍',
        cooldown: 18, chargesPerRun: 2,
        effectType: 'clear_small', effectParams: { range: 420 }
      }
    },
    {
      tier: 6, name: '轿车', seats: 3, baseWidth: 1.15, baseLength: 1.15, baseSpeedMul: 1.1,
      color: '#a78bfa',
      skill: {
        id: 'seatbelt', name: '安全带', desc: '抵消下一次非致命猛撞',
        cooldown: 20, chargesPerRun: 0,
        effectType: 'next_shield', effectParams: {}
      }
    },
    {
      tier: 7, name: 'SUV', seats: 4, baseWidth: 1.22, baseLength: 1.2, baseSpeedMul: 1.06,
      color: '#34d399',
      skill: {
        id: 'offroad', name: '越野胎', desc: '短时可走路肩绕行',
        cooldown: 22, chargesPerRun: 0,
        effectType: 'offroad', effectParams: { duration: 5 }
      }
    },
    {
      tier: 8, name: '皮卡', seats: 4, baseWidth: 1.2, baseLength: 1.25, baseSpeedMul: 1.04,
      color: '#f59e0b',
      skill: {
        id: 'dump', name: '卸货', desc: '丢掉一个货箱并前冲',
        cooldown: 15, chargesPerRun: 0,
        effectType: 'dump_crate', effectParams: { boost: 1.25, duration: 1.2 }
      }
    }
  ];

  /* V9～30 模板填充，保证有技能可查 */
  var TEMPLATES = [
    { name: '面包车', seats: 5, effectType: 'speedburst', skillName: '冲刺', params: { duration: 2.5, mul: 1.3 } },
    { name: '巴士', seats: 6, effectType: 'iframe', skillName: '让行', params: { duration: 1.0 } },
    { name: '卡车', seats: 2, effectType: 'clear_small', skillName: '开道', params: { range: 500 } },
    { name: '牵引车', seats: 2, effectType: 'next_shield', skillName: '挂钩盾', params: {} }
  ];
  for (var t = 9; t <= 30; t++) {
    var tpl = TEMPLATES[(t - 9) % TEMPLATES.length];
    LIST.push({
      tier: t,
      name: tpl.name + t,
      seats: Math.min(8, tpl.seats + Math.floor((t - 9) / 4)),
      baseWidth: 1.05 + t * 0.012,
      baseLength: 1.05 + t * 0.01,
      baseSpeedMul: 1 + t * 0.008,
      color: '#94a3b8',
      skill: {
        id: 'auto_' + t,
        name: tpl.skillName,
        desc: tpl.skillName,
        cooldown: 12 + (t % 5) * 2,
        chargesPerRun: 0,
        effectType: tpl.effectType,
        effectParams: tpl.params
      }
    });
  }

  var BY = {};
  for (var i = 0; i < LIST.length; i++) BY[LIST[i].tier] = LIST[i];

  LY.Vehicles = {
    list: LIST,
    maxTier: 30,
    get: function (tier) { return BY[tier] || BY[1]; },

    /** 从 V 升到 V+1 消耗 */
    upgradeCost: function (fromTier) {
      var next = (fromTier | 0) + 1;
      if (next > 30) return null;
      return { level: Math.min(30, next), count: 2 };
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LY.Vehicles;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
