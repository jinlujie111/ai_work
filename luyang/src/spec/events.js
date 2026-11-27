/* 路养 · MVP 事件池（12 条，配置驱动） */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  /**
   * choices[].effects / costs：直接改 RunState 数值
   * require_item：背包有该道具才显示更优选项（仍可点其他）
   * weight + conditions：触发权重
   */
  var LIST = [
    {
      id: 'E01',
      category: 'service',
      weight: 10,
      title: '加油站',
      body: '油表晃了晃。要不要停下来加满？',
      choices: [
        { label: '加满（金币-12，耐久+10）', costs: { gold: 12 }, effects: { durability: 10, mood: 2 } },
        { label: '加一半（金币-6，耐久+5）', costs: { gold: 6 }, effects: { durability: 5 } },
        { label: '不加，赶路', effects: { fatigue: 4 } }
      ]
    },
    {
      id: 'E02',
      category: 'service',
      weight: 10,
      title: '便利店',
      body: '24 小时灯还亮着。买点吃的，还是只逛逛？',
      choices: [
        { label: '买泡面（金币-8，入包）', costs: { gold: 8 }, effects: { add_item: 'instant_noodles' } },
        { label: '买咖啡（金币-6，入包）', costs: { gold: 6 }, effects: { add_item: 'coffee' } },
        { label: '只逛逛（心情+4）', effects: { mood: 4 } }
      ]
    },
    {
      id: 'E03',
      category: 'service',
      weight: 9,
      title: '修车铺',
      body: '师傅敲了敲引擎盖：「大修还是小修？」',
      choices: [
        { label: '大修（金币-20，耐久+35）', costs: { gold: 20 }, effects: { durability: 35 } },
        { label: '小修（金币-10，耐久+15）', costs: { gold: 10 }, effects: { durability: 15 } },
        { label: '自己用扳手', require_item: 'wrench', effects: { use_item: 'wrench', durability: 18 } },
        { label: '先不开修', effects: { fatigue: 3 } }
      ]
    },
    {
      id: 'E04',
      category: 'service',
      weight: 9,
      title: '路边旅馆',
      body: '霓虹「住宿」在闪。睡一觉会耽误路程。',
      choices: [
        { label: '住一晚（金币-15，大降疲劳）', costs: { gold: 15 }, effects: { fatigue: -55, stamina: 25, sleep_pause: 3 } },
        { label: '眯一会（金币-6）', costs: { gold: 6 }, effects: { fatigue: -25, stamina: 10, sleep_pause: 1.5 } },
        { label: '不住，继续开', effects: { fatigue: 6 } }
      ]
    },
    {
      id: 'E07',
      category: 'weather',
      weight: 8,
      title: '前方修路',
      body: '锥桶占了半幅车道。绕、闯，还是等？',
      choices: [
        { label: '绕路（耗时，疲劳+8）', effects: { fatigue: 8, distance: -80 } },
        { label: '硬闯（耐久-14）', effects: { durability: -14 } },
        { label: '等一等（疲劳+12）', effects: { fatigue: 12, stamina: -4 } }
      ]
    },
    {
      id: 'E08',
      category: 'weather',
      weight: 8,
      title: '暴雨',
      body: '雨刷拼命甩，视野发糊。',
      choices: [
        { label: '降速忍着', effects: { speed_temp: -1, duration: 10, fatigue: 5 } },
        { label: '硬开（耐久-10）', effects: { durability: -10 } },
        { label: '找屋檐睡一会', effects: { fatigue: -20, sleep_pause: 2.5, distance: -40 } }
      ]
    },
    {
      id: 'E10',
      category: 'weather',
      weight: 7,
      title: '浓雾',
      body: '白茫茫一片，路标都看不清。',
      choices: [
        { label: '开灯慢行', effects: { speed_temp: -2, duration: 12 } },
        { label: '盲开赌运气', effects: { durability: -12, fatigue: 6 } },
        { label: '等雾散（疲劳+10）', effects: { fatigue: 10, sleep_pause: 2 } }
      ]
    },
    {
      id: 'E13',
      category: 'social',
      weight: 8,
      title: '有人搭车',
      body: '路边有人招手。载不载？',
      choices: [
        { label: '载一程（心情+8，疲劳+5）', effects: { mood: 8, fatigue: 5, gold: 6 } },
        { label: '只送到下个口（心情+3）', effects: { mood: 3, fatigue: 2 } },
        { label: '拒载', effects: { mood: -2 } }
      ]
    },
    {
      id: 'E14',
      category: 'social',
      weight: 7,
      title: '流浪猫',
      body: '一只瘦瘦的猫蹲在护栏边盯着你。',
      choices: [
        { label: '喂点吃的', require_item: 'instant_noodles', effects: { use_item: 'instant_noodles', mood: 12 } },
        { label: '摸摸就走', effects: { mood: 5 } },
        { label: '无视', effects: {} }
      ]
    },
    {
      id: 'E17',
      category: 'social',
      weight: 9,
      conditions: [{ key: 'hunger', op: '>=', value: 55 }],
      title: '肚子抗议',
      body: '咕噜——再不吃东西，方向盘都要发飘了。',
      choices: [
        { label: '立刻吃背包食物', require_item_any: ['instant_noodles', 'burger', 'energy_drink'], effects: { use_any_food: true } },
        { label: '忍到下一店', effects: { hunger: 8, stamina: -6 } },
        { label: '硬开', effects: { hunger: 15, stamina: -10, fatigue: 5 } }
      ]
    },
    {
      id: 'E19',
      category: 'car',
      weight: 8,
      title: '爆胎隐患',
      body: '方向有点发飘，轮胎气压不对劲。',
      choices: [
        { label: '立刻换备胎', require_item: 'spare_tire', effects: { use_item: 'spare_tire', durability: 8 } },
        { label: '慢开到铺', effects: { speed_temp: -2, duration: 15, fatigue: 4 } },
        { label: '无视（赌）', effects: { pending_blowout: true } }
      ]
    },
    {
      id: 'E22',
      category: 'car',
      weight: 7,
      title: '刮蹭小事故',
      body: '变道时蹭到护栏，漆面花了一道。',
      choices: [
        { label: '赔钱修（金币-14，耐久+8）', costs: { gold: 14 }, effects: { durability: 8, mood: -2 } },
        { label: '自己补', require_item: 'wrench', effects: { use_item: 'wrench', durability: 5, mood: -1 } },
        { label: '不管', effects: { durability: -8, mood: -6 } }
      ]
    }
  ];

  var BY_ID = {};
  for (var i = 0; i < LIST.length; i++) BY_ID[LIST[i].id] = LIST[i];

  function matchCond(state, cond) {
    var v = state[cond.key];
    if (cond.key.indexOf('.') >= 0) {
      var parts = cond.key.split('.');
      v = state;
      for (var i = 0; i < parts.length; i++) v = v ? v[parts[i]] : undefined;
    }
    if (cond.key === 'hunger') v = state.person && state.person.hunger;
    if (cond.key === 'fatigue') v = state.person && state.person.fatigue;
    if (cond.key === 'durability') v = state.car && state.car.durability;
    if (v === undefined) return true;
    if (cond.op === '>=') return v >= cond.value;
    if (cond.op === '>') return v > cond.value;
    if (cond.op === '<=') return v <= cond.value;
    if (cond.op === '<') return v < cond.value;
    if (cond.op === '==') return v === cond.value;
    return true;
  }

  LY.Events = {
    list: LIST,
    byId: BY_ID,
    get: function (id) { return BY_ID[id] || null; },

    pick: function (state, rng, seen) {
      var allow = state && state.level && state.level.eventPool;
      var allowMap = null;
      if (allow && allow.length) {
        allowMap = {};
        for (var a = 0; a < allow.length; a++) allowMap[allow[a]] = true;
      }
      var pool = [];
      for (var i = 0; i < LIST.length; i++) {
        var ev = LIST[i];
        if (allowMap && !allowMap[ev.id]) continue;
        if (seen && seen[ev.id]) continue;
        var ok = true;
        if (ev.conditions) {
          for (var c = 0; c < ev.conditions.length; c++) {
            if (!matchCond(state, ev.conditions[c])) { ok = false; break; }
          }
        }
        if (!ok) continue;
        pool.push({ ev: ev, w: ev.weight || 1 });
      }
      if (!pool.length) {
        for (i = 0; i < LIST.length; i++) {
          if (allowMap && !allowMap[LIST[i].id]) continue;
          pool.push({ ev: LIST[i], w: LIST[i].weight || 1 });
        }
      }
      if (!pool.length) {
        for (i = 0; i < LIST.length; i++) pool.push({ ev: LIST[i], w: LIST[i].weight || 1 });
      }
      var total = 0;
      for (i = 0; i < pool.length; i++) total += pool[i].w;
      var roll = rng() * total;
      for (i = 0; i < pool.length; i++) {
        roll -= pool[i].w;
        if (roll <= 0) return pool[i].ev;
      }
      return pool[pool.length - 1].ev;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LY.Events;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
