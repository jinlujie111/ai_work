/* 路养 · 道具表（MVP ≤12） */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  /**
   * type: instant | equip | risk
   * category: food | repair | boost
   * target: person | car
   * effects: 数值增量（正加负减）
   */
  var LIST = [
    {
      id: 'instant_noodles',
      name: '泡面',
      category: 'food',
      type: 'instant',
      target: 'person',
      color: '#e8a54b',
      desc: '立刻回一点体力，压压饿',
      effects: { stamina: 18, hunger: -22, mood: 2 }
    },
    {
      id: 'energy_drink',
      name: '能量饮料',
      category: 'food',
      type: 'instant',
      target: 'person',
      color: '#5ec8ff',
      desc: '提神，但稍后疲劳会回来一点',
      effects: { stamina: 12, spirit: 10, fatigue: -8 },
      side_effects: { fatigue: 6, delay: 8 }
    },
    {
      id: 'burger',
      name: '汉堡',
      category: 'food',
      type: 'instant',
      target: 'person',
      color: '#d4a017',
      desc: '管饱，心情也好点',
      effects: { hunger: -35, stamina: 10, mood: 6 }
    },
    {
      id: 'coffee',
      name: '咖啡',
      category: 'food',
      type: 'instant',
      target: 'person',
      color: '#8b5a2b',
      desc: '降疲劳，精神↑',
      effects: { fatigue: -20, spirit: 12 }
    },
    {
      id: 'sleeping_bag',
      name: '睡袋',
      category: 'food',
      type: 'instant',
      target: 'person',
      color: '#6b8f71',
      desc: '原地睡一会：大幅降疲劳，但耗时停开',
      effects: { sleep: true }
    },
    {
      id: 'wrench',
      name: '扳手',
      category: 'repair',
      type: 'instant',
      target: 'car',
      color: '#9aa0a6',
      desc: '小修耐久',
      effects: { durability: 18 }
    },
    {
      id: 'spare_tire',
      name: '备胎',
      category: 'repair',
      type: 'equip',
      target: 'car',
      color: '#444',
      desc: '装上后下一回爆胎可免伤一次',
      effects: { spare: 1, durability: 6 }
    },
    {
      id: 'armor_plate',
      name: '防护板',
      category: 'repair',
      type: 'equip',
      target: 'car',
      color: '#708090',
      desc: '障碍伤害略降',
      effects: { armor: 0.25, durability: 8 }
    },
    {
      id: 'engine_oil',
      name: '机油',
      category: 'repair',
      type: 'instant',
      target: 'car',
      color: '#2f4f4f',
      desc: '车速属性微升 + 修一点',
      effects: { speed: 1, durability: 10 }
    },
    {
      id: 'nitro',
      name: '氮气罐',
      category: 'boost',
      type: 'risk',
      target: 'car',
      color: '#ff5c5c',
      desc: '短时极速，但更伤车',
      effects: { boostSec: 4, boostMul: 1.55 },
      side_effects: { durability: -6 }
    },
    {
      id: 'turbo_chip',
      name: '涡轮芯片',
      category: 'boost',
      type: 'equip',
      target: 'car',
      color: '#ff8c42',
      desc: '永久微提速',
      effects: { speed: 2 }
    },
    {
      id: 'stim',
      name: '提神片',
      category: 'boost',
      type: 'risk',
      target: 'person',
      color: '#c084fc',
      desc: '强提精神，疲劳涨更快',
      effects: { spirit: 20, stamina: 8, fatigueGainMul: 1.6, duration: 12 }
    }
  ];

  var BY_ID = {};
  for (var i = 0; i < LIST.length; i++) BY_ID[LIST[i].id] = LIST[i];

  LY.Items = {
    list: LIST,
    byId: BY_ID,
    get: function (id) { return BY_ID[id] || null; },
    byCategory: function (cat) {
      return LIST.filter(function (it) { return it.category === cat; });
    },
    randomId: function (rng, cat) {
      var pool = cat ? LY.Items.byCategory(cat) : LIST;
      if (!pool.length) return null;
      return rng.pick(pool).id;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LY.Items;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
