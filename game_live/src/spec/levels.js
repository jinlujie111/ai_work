/* 森林求生｜地图模板与关卡配置
   模板规则见 spec 2.2，前四关配置见 spec 4.5，章节划分见 spec 4.2，
   难度曲线见 spec 4.3。每关的教学目的与关卡规则见 doc/level-design.md。 */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};
  var U = DF.Util;
  var P = DF.Params;

  /* ── 2.2 地图模板 ──────────────────────────────── */
  var TEMPLATES = {
    clearing: { w: 1600, h: 1200, trees: 0, layout: 'scatter' },
    grove:    { w: 1400, h: 1200, trees: 28, layout: 'cluster' },
    pond:     { w: 1500, h: 1300, trees: 10, layout: 'water' },
    corridor: { w: 1800, h: 900,  trees: 22, layout: 'corridor' },
    den:      { w: 1500, h: 1500, trees: 16, layout: 'ring' }
  };

  var TREE_R = 34;          // 树干碰撞半径
  var TREE_VIS = 46;        // 视觉半径（含树冠）

  /* 生成地图：障碍物、水域、出生点 */
  function buildMap(template, seed) {
    var t0 = TEMPLATES[template] || TEMPLATES.clearing;
    // 规格给的尺寸是按较扁的视口定的，这里等比放大到不小于 750×1334 视口
    var need = Math.max((P.BASE_W + 260) / t0.w, (P.BASE_H + 260) / t0.h, 1);
    var t = { w: Math.round(t0.w * need), h: Math.round(t0.h * need), trees: t0.trees, layout: t0.layout };
    var rng = U.rng(seed);
    var map = {
      template: template, w: t.w, h: t.h,
      trees: [], waters: [], spawn: { x: t.w / 2, y: t.h * 0.36 }
    };

    function freeSpot(r, minTreeDist) {
      for (var i = 0; i < 80; i++) {
        var x = P.map.border + rng() * (t.w - P.map.border * 2);
        var y = P.map.border + rng() * (t.h - P.map.border * 2);
        var ok = true;
        for (var j = 0; j < map.trees.length; j++) {
          var tr = map.trees[j];
          var d = U.dist(x, y, tr.x, tr.y);
          if (d < r + TREE_R + (minTreeDist || 0)) { ok = false; break; }
        }
        if (ok) return { x: x, y: y };
      }
      return { x: rng.range(P.map.border, t.w - P.map.border), y: rng.range(P.map.border, t.h - P.map.border) };
    }

    if (t.layout === 'cluster') {
      var clusters = Math.max(3, Math.round(t.trees / 3));
      for (var c = 0; c < clusters; c++) {
        var cx = P.map.border + rng() * (t.w - P.map.border * 2);
        var cy = P.map.border + rng() * (t.h - P.map.border * 2);
        var n = rng.int(2, 4);
        for (var k = 0; k < n && map.trees.length < t.trees; k++) {
          var a = rng() * U.TAU, d = rng.range(30, 90);
          map.trees.push({
            x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
            r: TREE_R, vis: TREE_VIS, seed: rng.int(0, 9999)
          });
        }
      }
    } else if (t.layout === 'water') {
      map.waters.push({ x: t.w / 2, y: t.h / 2, r: 210 });
      for (var wq = 0; wq < 3; wq++) {
        var a2 = rng() * U.TAU, d2 = rng.range(280, 420);
        map.waters.push({
          x: t.w / 2 + Math.cos(a2) * d2,
          y: t.h / 2 + Math.sin(a2) * d2,
          r: rng.range(70, 120)
        });
      }
      for (var tw = 0; tw < t.trees; tw++) {
        var s = freeSpot(TREE_R, 0);
        map.trees.push({ x: s.x, y: s.y, r: TREE_R, vis: TREE_VIS, seed: rng.int(0, 9999) });
      }
    } else if (t.layout === 'corridor') {
      for (var i2 = 0; i2 < t.trees; i2++) {
        var top = i2 % 2 === 0;
        var x2 = P.map.border + 60 + (i2 / 2) * ((t.w - P.map.border * 2 - 120) / 11);
        var gap = rng.chance(0.3);
        var y2 = gap ? (top ? P.map.border + 120 : t.h - P.map.border - 120)
                     : (top ? P.map.border + rng.range(0, 50) : t.h - P.map.border - rng.range(0, 50));
        map.trees.push({ x: x2, y: y2, r: TREE_R, vis: TREE_VIS, seed: rng.int(0, 9999) });
      }
    } else if (t.layout === 'ring') {
      var ringR = Math.min(t.w, t.h) * 0.36;
      for (var r2 = 0; r2 < t.trees; r2++) {
        var ang = (r2 / t.trees) * U.TAU;
        var rr = ringR + rng.range(-40, 60);
        map.trees.push({
          x: t.w / 2 + Math.cos(ang) * rr,
          y: t.h / 2 + Math.sin(ang) * rr,
          r: TREE_R, vis: TREE_VIS, seed: rng.int(0, 9999)
        });
      }
    }

    // 出生点：地图中心偏上，且不压在树上
    for (var tr2 = 0; tr2 < 40; tr2++) {
      var ok2 = true;
      for (var i3 = 0; i3 < map.trees.length; i3++) {
        if (U.dist(map.spawn.x, map.spawn.y, map.trees[i3].x, map.trees[i3].y) < TREE_R + 40) { ok2 = false; break; }
      }
      if (ok2) break;
      map.spawn.x = t.w / 2 + rng.range(-160, 160);
      map.spawn.y = t.h * 0.36 + rng.range(-120, 120);
    }
    return map;
  }

  /* ── 章节（4.2） ────────────────────────────────── */
  var CHAPTERS = [
    { name: '林缘', templates: ['clearing', 'grove'], theme: '森林边缘，基础动作与昼夜' },
    { name: '深处', templates: ['grove', 'corridor'], theme: '树更密，出现蛇' },
    { name: '水岸', templates: ['pond'], theme: '水潭环绕，地形决定路线' },
    { name: '猎场', templates: ['den', 'grove'], theme: '熊的领地，多熊巡逻' },
    { name: '深冬', templates: ['corridor', 'den'], theme: '综合与约束' }
  ];

  /* ── 关卡配置 ────────────────────────────────────
     字段：name 关卡名 / template 模板 / dur 总时长 / day 白天时长
           animals 动物 / res 资源 / fires 火堆数
           goal 目标 / goalText 目标文案 / stars 星星条件 / teach 教学点
     动物写法：'bear:1:always' 熊一只总是追击 | 'bear:1:night' 仅夜间追击
               'bear:1:patrol' 只巡逻不追击 | 'snake:2' | 'rabbit:3'
     星星写法：complete time:秒 undetected no_damage no_damage_night
               gold:个 decoy:次 fire_alive temp:体温 herb:株              */

  var LEVELS = [
    /* ── 第一章 林缘：基础动作与昼夜（1 到 10） ── */
    { name: '学会移动', template: 'clearing', dur: 60, day: 60,
      animals: ['bear:1:patrol'], res: { berry: 5 }, fires: 0,
      goal: { type: 'collect', target: 3 }, goalText: '采集 3 个浆果',
      stars: ['complete', 'time:30', 'undetected'], teach: '单指拖动与自动采集' },
    { name: '学会夜晚', template: 'clearing', dur: 90, day: 60,
      animals: ['bear:1:night'], res: { berry: 6, wood: 3 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'no_damage_night'], teach: '昼夜切换、视野收缩与火堆' },
    { name: '学会风险定价', template: 'grove', dur: 90, day: 60,
      animals: ['bear:1:always'], res: { berry: 3, gold: 1, goldOnBearPath: true }, fires: 0,
      goal: { type: 'score', target: 6 }, goalText: '达到 6 分',
      stars: ['complete', 'gold:1', 'no_damage'], teach: '好资源刷在熊的路线上' },
    { name: '学会发现', template: 'grove', dur: 90, day: 60,
      animals: ['bear:1:always', 'rabbit:2'], res: { berry: 6 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'decoy_used:1', 'no_damage'], teach: '兔子可以引开熊，不做教学' },
    { name: '学会采集', template: 'grove', dur: 75, day: 75,
      animals: ['bear:1:patrol'], res: { berry: 8 }, fires: 0,
      goal: { type: 'collect', target: 6 }, goalText: '采集 6 个浆果',
      stars: ['complete', 'time:40', 'no_damage'], teach: '采集耗时 0.8 秒，走过去就够' },
    { name: '学会温度', template: 'clearing', dur: 90, day: 55,
      animals: ['bear:1:night'], res: { berry: 4 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'temp:40', 'fire_alive'], teach: '体温会掉，火堆里会回' },
    { name: '学会备柴', template: 'grove', dur: 90, day: 55,
      animals: ['bear:1:always'], res: { berry: 4, wood: 4 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'temp:30'], teach: '木头要送到火堆才会生效' },
    { name: '学会藏身', template: 'grove', dur: 90, day: 55,
      animals: ['bear:1:night'], res: { berry: 6 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'undetected', 'no_damage'], teach: '树丛挡住熊的视线' },
    { name: '学会贪心', template: 'grove', dur: 90, day: 60,
      animals: ['bear:1:always'], res: { berry: 3, gold: 2 }, fires: 0,
      goal: { type: 'gold', target: 1 }, goalText: '拿到 1 个金浆果',
      stars: ['complete', 'gold:2', 'no_damage'], teach: '金浆果 3 分且回温 40' },
    { name: '林缘的夜', template: 'clearing', dur: 100, day: 55,
      animals: ['bear:1:night'], res: { berry: 8, wood: 3 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'no_damage'], teach: '章节综合：采集、夜晚与火堆' },

    /* ── 第二章 深处：蛇出场（11 到 20） ── */
    { name: '学会蛇', template: 'grove', dur: 90, day: 60,
      animals: ['snake:2'], res: { berry: 6 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'no_damage', 'time:60'], teach: '蛇完全静止，靠近才触发' },
    { name: '学会药草', template: 'grove', dur: 90, day: 60,
      animals: ['snake:2', 'bear:1:always'], res: { berry: 5, herb: 2 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'herb_used:1', 'no_damage'], teach: '药草解除中毒' },
    { name: '蛇与熊', template: 'grove', dur: 100, day: 60,
      animals: ['bear:1:always', 'snake:2'], res: { berry: 6 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'no_damage', 'undetected'], teach: '机制叠加：伏击加巡逻' },
    { name: '夜路', template: 'corridor', dur: 100, day: 50,
      animals: ['bear:1:night', 'snake:1'], res: { berry: 6, wood: 3 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'no_damage'], teach: '狭窄通道里的长夜' },
    { name: '双熊', template: 'grove', dur: 100, day: 60,
      animals: ['bear:2:always'], res: { berry: 8 }, fires: 0,
      goal: { type: 'score', target: 10 }, goalText: '达到 10 分',
      stars: ['complete', 'time:60', 'no_damage'], teach: '两只熊的巡逻路线不同' },
    { name: '采药行', template: 'grove', dur: 100, day: 60,
      animals: ['snake:3'], res: { berry: 6, herb: 3 }, fires: 0,
      goal: { type: 'herb', target: 3 }, goalText: '采集 3 株药草',
      stars: ['complete', 'time:40', 'no_damage'], teach: '药草也算采集目标' },
    { name: '火堆陷阱', template: 'clearing', dur: 100, day: 55,
      animals: ['bear:1:always'], res: { berry: 4, wood: 4 }, fires: 1,
      goal: { type: 'score', target: 8 }, goalText: '达到 8 分',
      stars: ['complete', 'fire_alive', 'no_damage'], teach: '火堆连熊也挡得住' },
    { name: '走廊', template: 'corridor', dur: 90, day: 60,
      animals: ['bear:1:always', 'snake:2'], res: { berry: 7 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'time:55', 'no_damage'], teach: '通道里没有绕路余地' },
    { name: '捕食', template: 'grove', dur: 100, day: 60,
      animals: ['bear:1:always', 'rabbit:3'], res: { berry: 6 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'decoy_used:2', 'no_damage'], teach: '把兔子赶向熊来脱身' },
    { name: '深处的夜', template: 'den', dur: 110, day: 55,
      animals: ['bear:2:night', 'snake:2'], res: { berry: 8, wood: 3 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'no_damage'], teach: '章节综合：多熊加蛇加火堆' },

    /* ── 第三章 水岸：地形决定路线（21 到 30） ── */
    { name: '水边', template: 'pond', dur: 90, day: 60,
      animals: ['bear:1:always'], res: { berry: 6 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'undetected', 'no_damage'], teach: '水潭把地图切成两条路' },
    { name: '浅滩', template: 'pond', dur: 100, day: 60,
      animals: ['bear:1:always', 'snake:2'], res: { berry: 7, wood: 3 }, fires: 0,
      goal: { type: 'collect', target: 4 }, goalText: '采集 4 个浆果',
      stars: ['complete', 'time:50', 'no_damage'], teach: '水域能走但会拖慢脚步' },
    { name: '绕远', template: 'pond', dur: 100, day: 60,
      animals: ['bear:1:always'], res: { berry: 8 }, fires: 0,
      goal: { type: 'score', target: 8 }, goalText: '达到 8 分',
      stars: ['complete', 'time:55', 'no_damage'], teach: '绕路比直穿更安全' },
    { name: '水中', template: 'pond', dur: 100, day: 60,
      animals: ['snake:2'], res: { berry: 6, herb: 2 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'undetected', 'no_damage'], teach: '水边的蛇最容易撞见' },
    { name: '岸火', template: 'pond', dur: 110, day: 55,
      animals: ['bear:1:night'], res: { berry: 6, wood: 4 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'no_damage'], teach: '火堆要放在安全的一侧' },
    { name: '诱饵', template: 'pond', dur: 110, day: 60,
      animals: ['bear:1:always', 'rabbit:2'], res: { berry: 7 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'decoy_used:1', 'no_damage'], teach: '诱饵加地形' },
    { name: '夜渡', template: 'pond', dur: 110, day: 50,
      animals: ['snake:2'], res: { berry: 8, wood: 3 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'no_damage'], teach: '夜里水边最危险' },
    { name: '猎场边缘', template: 'grove', dur: 110, day: 60,
      animals: ['bear:2:always', 'snake:1'], res: { berry: 9 }, fires: 0,
      goal: { type: 'score', target: 12 }, goalText: '达到 12 分',
      stars: ['complete', 'time:70', 'no_damage'], teach: '资源密度上升' },
    { name: '群蛇', template: 'pond', dur: 100, day: 60,
      animals: ['snake:4'], res: { berry: 6, herb: 3 }, fires: 0,
      goal: { type: 'herb', target: 3 }, goalText: '采集 3 株药草',
      stars: ['complete', 'herb_used:2', 'no_damage'], teach: '密集伏击，药草要省着用' },
    { name: '水岸的夜', template: 'pond', dur: 110, day: 55,
      animals: ['bear:2:night', 'snake:2'], res: { berry: 8, wood: 3 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'no_damage'], teach: '章节综合：水加夜加双熊' },

    /* ── 第四章 猎场：熊的领地（31 到 40） ── */
    { name: '领地', template: 'den', dur: 100, day: 60,
      animals: ['bear:1:always'], res: { berry: 8 }, fires: 0,
      goal: { type: 'score', target: 10 }, goalText: '达到 10 分',
      stars: ['complete', 'undetected', 'no_damage'], teach: '环形地图只有一条安全路' },
    { name: '双猎', template: 'den', dur: 110, day: 60,
      animals: ['bear:2:always'], res: { berry: 10 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'undetected', 'no_damage'], teach: '两只熊的视锥会重叠' },
    { name: '熊的视线', template: 'grove', dur: 100, day: 60,
      animals: ['bear:1:always'], res: { berry: 8 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'undetected', 'no_damage'], teach: '熊只有 90 度视锥' },
    { name: '藏与走', template: 'grove', dur: 110, day: 60,
      animals: ['bear:1:always'], res: { berry: 10, gold: 1 }, fires: 0,
      goal: { type: 'gold', target: 1 }, goalText: '拿到 1 个金浆果',
      stars: ['complete', 'undetected', 'gold:1'], teach: '躲开视线也能贪一点' },
    { name: '熊与蛇', template: 'den', dur: 110, day: 60,
      animals: ['bear:2:always', 'snake:2'], res: { berry: 9 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'no_damage', 'no_damage_night'], teach: '两个原型同时压过来' },
    { name: '猎场金果', template: 'den', dur: 110, day: 60,
      animals: ['bear:2:always'], res: { berry: 6, gold: 2 }, fires: 0,
      goal: { type: 'gold', target: 2 }, goalText: '拿到 2 个金浆果',
      stars: ['complete', 'gold:2', 'no_damage'], teach: '高风险高收益' },
    { name: '火与熊', template: 'den', dur: 110, day: 55,
      animals: ['bear:1:always'], res: { berry: 6, wood: 5 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'no_damage'], teach: '火堆半径是熊的禁区' },
    { name: '引熊出洞', template: 'den', dur: 120, day: 60,
      animals: ['bear:1:always', 'rabbit:3'], res: { berry: 8 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'decoy_used:2', 'no_damage'], teach: '连续使用诱饵' },
    { name: '夜猎', template: 'den', dur: 120, day: 60,
      animals: ['bear:2:night'], res: { berry: 9, wood: 3 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'no_damage'], teach: '夜里的熊更快' },
    { name: '猎场的夜', template: 'den', dur: 120, day: 60,
      animals: ['bear:2:always', 'snake:2'], res: { berry: 10, wood: 4 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'no_damage'], teach: '章节综合：多熊加蛇加火' },

    /* ── 第五章 深冬：综合与约束（41 到 50） ── */
    { name: '严寒', template: 'corridor', dur: 120, day: 55,
      animals: ['bear:1:night'], res: { berry: 8, wood: 4 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'temp:20'], teach: '长夜让体温成为硬约束' },
    { name: '长路', template: 'corridor', dur: 120, day: 60,
      animals: ['snake:3'], res: { berry: 8, herb: 3 }, fires: 0,
      goal: { type: 'collect', target: 5 }, goalText: '采集 5 个浆果',
      stars: ['complete', 'time:55', 'no_damage'], teach: '长距离采集' },
    { name: '窄门', template: 'corridor', dur: 120, day: 60,
      animals: ['bear:2:always', 'snake:2'], res: { berry: 10 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'no_damage', 'undetected'], teach: '狭窄空间没有闪避余地' },
    { name: '铁壁', template: 'den', dur: 120, day: 60,
      animals: ['bear:3:always'], res: { berry: 10 }, fires: 0,
      goal: { type: 'score', target: 14 }, goalText: '达到 14 分',
      stars: ['complete', 'time:70', 'no_damage'], teach: '三只熊' },
    { name: '无火', template: 'den', dur: 120, day: 60,
      animals: ['bear:2:night'], res: { berry: 12, gold: 2 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'time:75', 'no_damage'], teach: '没有火堆，靠浆果回温' },
    { name: '药尽', template: 'grove', dur: 120, day: 60,
      animals: ['snake:5'], res: { berry: 8, herb: 2 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'herb_used:2', 'no_damage'], teach: '药草不够用' },
    { name: '险中求', template: 'den', dur: 120, day: 60,
      animals: ['bear:2:always', 'snake:3'], res: { berry: 8, gold: 3 }, fires: 0,
      goal: { type: 'gold', target: 2 }, goalText: '拿到 2 个金浆果',
      stars: ['complete', 'gold:2', 'no_damage'], teach: '所有危险叠在一起' },
    { name: '极限', template: 'corridor', dur: 120, day: 60,
      animals: ['bear:2:always', 'snake:3'], res: { berry: 10, wood: 4 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'no_damage'], teach: '全要素同时出现' },
    { name: '深林', template: 'den', dur: 120, day: 60,
      animals: ['bear:3:always', 'snake:3'], res: { berry: 12, gold: 3 }, fires: 1,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'fire_alive', 'no_damage'], teach: '最高压力' },
    { name: '归途', template: 'den', dur: 120, day: 55,
      animals: ['bear:2:night', 'snake:2'], res: { berry: 10, gold: 2, wood: 4 }, fires: 1,
      goal: { type: 'gold', target: 2 }, goalText: '拿到 2 个金浆果',
      stars: ['complete', 'decoy_used:1', 'fire_alive'], teach: '终章：带着遗物走出去' }
  ];

  /* ── 解析配置 ────────────────────────────────────── */
  function parseAnimals(list) {
    var out = [];
    (list || []).forEach(function (s) {
      var p = s.split(':');
      var type = p[0], count = parseInt(p[1], 10) || 1;
      var mode = p[2] || 'always';
      for (var i = 0; i < count; i++) {
        out.push({
          type: type, count: count,
          aggressive: mode === 'always' ? true : (mode === 'night' ? 'night' : false)
        });
      }
    });
    return out;
  }

  function parseStars(list) {
    return (list || []).map(function (s) {
      var p = s.split(':');
      return { id: p[0], value: p[1] !== undefined ? parseFloat(p[1]) : 0 };
    });
  }

  function getLevel(id) {
    var cfg = LEVELS[id - 1];
    if (!cfg) return null;
    return {
      id: id,
      name: cfg.name,
      chapter: Math.floor((id - 1) / 10) + 1,
      template: cfg.template,
      duration: cfg.dur,
      dayLength: cfg.day,
      animals: parseAnimals(cfg.animals),
      __rawAnimals: cfg.animals,
      resources: cfg.res || {},
      fires: cfg.fires || 0,
      goal: cfg.goal,
      goalText: cfg.goalText,
      stars: parseStars(cfg.stars),
      teach: cfg.teach
    };
  }

  /* 4.4 星级条件的中文说明 */
  var STAR_LABEL = {
    complete: '完成主目标', time: '限时完成', undetected: '全程未被熊发现',
    no_damage: '全程零受伤', no_damage_night: '夜晚零受伤',
    gold: '拿到金浆果', decoy_used: '引开熊', fire_alive: '火堆全程不灭',
    temp: '体温不低于下限', herb_used: '用药草'
  };

  function starText(c) {
    var label = STAR_LABEL[c.id] || c.id;
    if (c.id === 'time') return label + '（' + c.value + ' 秒内）';
    if (c.id === 'gold') return label + '（' + c.value + ' 个）';
    if (c.id === 'decoy_used') return label + '（' + c.value + ' 次）';
    if (c.id === 'herb_used') return label + '（' + c.value + ' 株）';
    if (c.id === 'temp') return label + '（' + c.value + '）';
    return label;
  }

  DF.Levels = {
    TEMPLATES: TEMPLATES,
    CHAPTERS: CHAPTERS,
    LEVELS: LEVELS,
    TREE_R: TREE_R,
    TREE_VIS: TREE_VIS,
    buildMap: buildMap,
    get: getLevel,
    starText: starText,
    count: LEVELS.length
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = DF.Levels; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));