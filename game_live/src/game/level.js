/* 森林求生｜关卡运行时
   负责地图构建、昼夜、体温、资源采集、动物行为、目标与三星判定。 */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};
  var U = DF.Util;
  var P = DF.Params;
  var E = DF.Entities;
  var Levels = DF.Levels;

  /* ══════════════ 世界（地形与碰撞） ══════════════ */
  function World(map) {
    this.map = map;
    this.trees = map.trees;
    this.waters = map.waters;
    this.w = map.w; this.h = map.h;
  }

  /* 圆与树、水域的碰撞 */
  World.prototype.resolveCircle = function (e) {
    for (var i = 0; i < this.trees.length; i++) {
      var t = this.trees[i];
      var dx = e.x - t.x, dy = e.y - t.y;
      var d = Math.hypot(dx, dy);
      var min = e.r + t.r;
      if (d < min && d > 0.0001) {
        e.x = t.x + dx / d * min;
        e.y = t.y + dy / d * min;
      }
    }
  };

  World.prototype.clampToBounds = function (e) {
    var b = P.map.border;
    if (e.x < b + e.r) { e.x = b + e.r; e.vx = 0; }
    if (e.y < b + e.r) { e.y = b + e.r; e.vy = 0; }
    if (e.x > this.w - b - e.r) { e.x = this.w - b - e.r; e.vx = 0; }
    if (e.y > this.h - b - e.r) { e.y = this.h - b - e.r; e.vy = 0; }
  };

  World.prototype.inWater = function (x, y) {
    for (var i = 0; i < this.waters.length; i++) {
      var w = this.waters[i];
      if (U.dist(x, y, w.x, w.y) < w.r) return true;
    }
    return false;
  };

  /* ══════════════ 关卡 ══════════════ */
  function Level(cfg, bus) {
    this.cfg = cfg;
    this.bus = bus;
    this.id = cfg.id;
    this.seed = cfg.seed;
    this.map = Levels.buildMap(cfg.template, cfg.seed);
    this.world = new World(this.map);

    this.time = 0;
    this.duration = cfg.duration;
    this.dayLength = cfg.dayLength;
    this.night = false;
    this.status = 'playing';        // playing / won / lost
    this.result = null;

    this.player = new E.Player(this.map.spawn.x, this.map.spawn.y);
    this.animals = [];
    this.resources = [];
    this.fires = [];

    this.stats = {
      score: 0, berry: 0, gold: 0, wood: 0, herb: 0, rabbit: 0,
      damaged: false, damagedNight: false, decoysUsed: 0,
      collect: 0, maxScore: 0
    };

    this.spawnAnimals();
    this.spawnResources();
    this.spawnFires();
    this.applyGoalState();
  }

  /* 动物布置：熊带巡逻路径，蛇藏草丛，兔在开阔处 */
  Level.prototype.spawnAnimals = function () {
    var cfg = this.cfg, rng = U.rng(this.seed ^ 0x9e37);
    var self = this;
    var map = this.map;

    function freePoint(minD) {
      for (var i = 0; i < 200; i++) {
        var x = P.map.border + 80 + rng() * (map.w - P.map.border * 2 - 160);
        var y = P.map.border + 80 + rng() * (map.h - P.map.border * 2 - 160);
        var d = U.dist(x, y, map.spawn.x, map.spawn.y);
        if (d < (minD || P.map.spawnSafeDist)) continue;
        var bad = false;
        for (var j = 0; j < self.animals.length; j++) {
          if (U.dist(x, y, self.animals[j].x, self.animals[j].y) < 120) { bad = true; break; }
        }
        if (bad) continue;
        for (var k = 0; k < map.trees.length; k++) {
          if (U.dist(x, y, map.trees[k].x, map.trees[k].y) < 70) { bad = true; break; }
        }
        if (!bad) return { x: x, y: y };
      }
      return { x: map.spawn.x + 200, y: map.spawn.y };
    }

    (cfg.animals || []).forEach(function (spec) {
      for (var i = 0; i < spec.count; i++) {
        var pt = freePoint();
        if (spec.type === 'bear') {
          // 巡逻路径：出生点周围 3 个点
          var path = [];
          for (var k = 0; k < 3; k++) {
            var a = rng() * U.TAU, r = rng.range(120, 300);
            path.push({ x: pt.x + Math.cos(a) * r, y: pt.y + Math.sin(a) * r });
          }
          path.unshift({ x: pt.x, y: pt.y });
          var bear = new E.Bear(pt.x, pt.y, path, { aggressive: spec.aggressive });
          bear.phase = rng() * U.TAU;
          self.animals.push(bear);
          // 关卡 3：金浆果刷在熊的巡逻路线上
          if (cfg.resources && cfg.resources.goldOnBearPath) {
            var wp = path[1 + (i % (path.length - 1))];
            self.resources.push(new E.Resource('gold', wp.x, wp.y));
          }
        } else if (spec.type === 'snake') {
          var sp = freePoint(120);
          self.animals.push(new E.Snake(sp.x, sp.y));
        } else if (spec.type === 'rabbit') {
          var rp = freePoint(150);
          self.animals.push(new E.Rabbit(rp.x, rp.y));
        }
      }
    });
  };

  /* 资源布置：安全区浆果，危险区金浆果 */
  Level.prototype.spawnResources = function () {
    var cfg = this.cfg, rng = U.rng(this.seed ^ 0x51ed);
    var map = this.map, self = this;
    var res = cfg.resources || {};
    var free = [];

    function pickPoint() {
      for (var i = 0; i < 200; i++) {
        var x = P.map.border + 60 + rng() * (map.w - P.map.border * 2 - 120);
        var y = P.map.border + 60 + rng() * (map.h - P.map.border * 2 - 120);
        var d = U.dist(x, y, map.spawn.x, map.spawn.y);
        if (d < 100) continue;
        var bad = false;
        for (var j = 0; j < map.trees.length; j++) {
          if (U.dist(x, y, map.trees[j].x, map.trees[j].y) < 60) { bad = true; break; }
        }
        if (bad) continue;
        for (var k = 0; k < self.animals.length; k++) {
          if (self.animals[k].type === 'bear' && U.dist(x, y, self.animals[k].x, self.animals[k].y) < 90) { bad = true; break; }
        }
        if (!bad) return { x: x, y: y };
      }
      return { x: map.spawn.x + 120, y: map.spawn.y + 120 };
    }

    function place(type, n) {
      for (var i = 0; i < n; i++) {
        var p = pickPoint();
        self.resources.push(new E.Resource(type, p.x, p.y));
      }
    }
    place('berry', res.berry || 0);
    place('wood', res.wood || 0);
    place('herb', res.herb || 0);
    if (res.gold && !res.goldOnBearPath) place('gold', res.gold);
  };

  Level.prototype.spawnFires = function () {
    var n = this.cfg.fires || 0;
    if (!n) return;
    var rng = U.rng(this.seed ^ 0x7a11), map = this.map;
    for (var i = 0; i < n; i++) {
      var x = map.spawn.x + rng.range(-260, 260);
      var y = map.spawn.y + rng.range(-160, 320);
      this.fires.push(new E.Fire(x, y));
    }
  };

  /* ── 目标状态 ── */
  Level.prototype.applyGoalState = function () {
    var g = this.cfg.goal || { type: 'survive' };
    this.goal = g;
    this.goalValue = 0;
    this.goalTarget = g.target || 0;
  };

  Level.prototype.goalProgress = function () {
    var g = this.goal;
    if (g.type === 'collect') return this.stats.collect;
    if (g.type === 'score') return this.stats.score;
    if (g.type === 'gold') return this.stats.gold;
    if (g.type === 'herb') return this.stats.herb;
    return 0;
  };

  /* ── 主更新（固定步长） ── */
  Level.prototype.update = function (dt, ctx) {
    if (this.status !== 'playing') return;
    var self = this;
    this.time += dt;

    // 昼夜切换
    var wasNight = this.night;
    this.night = this.time >= this.dayLength;
    if (this.night && !wasNight) this.bus.emit('nightFall', {});
    if (!this.night && wasNight) this.bus.emit('dawn', {});

    // 玩家
    this.player.update(dt, ctx);
    if (this.player.poison > 0) {
      this.player.poison -= dt;
      if (this.player.poison <= 0) this.player.poison = 0;
    }

    // 火堆
    for (var f = 0; f < this.fires.length; f++) this.fires[f].update(dt, ctx);

    // 资源
    var startled = false;
    for (var a = 0; a < this.animals.length; a++) {
      var an = this.animals[a];
      if (an.type === 'bear' && (an.state === 'CHASE' || an.state === 'SUSPICIOUS')) startled = true;
    }
    for (var r = 0; r < this.resources.length; r++) this.resources[r].update(dt, ctx);

    // 动物
    for (var i = 0; i < this.animals.length; i++) this.animals[i].update(dt, ctx);

    // 捕获兔子
    this.tryCatchRabbit(dt, ctx);

    // 火堆熄灭记录
    this.trackFireState(dt);

    // 诱饵耦合：追击中的熊会被 220 内的兔子引开
    this.applyDecoy(dt, ctx);

    // 采集
    this.updateCollect(dt, ctx, startled);

    // 体温
    if (this.night) {
      var warm = false;
      for (var f2 = 0; f2 < this.fires.length; f2++) {
        var fire = this.fires[f2];
        if (fire.lit && U.dist(this.player.x, this.player.y, fire.x, fire.y) < P.fire.radius) { warm = true; break; }
      }
      this.player.addTemp((warm ? P.temp.fireGain : -P.temp.nightLoss) * dt);
    }
    if (this.player.temp <= P.player.tempFail) { this.finish(false, 'cold'); return; }

    // 目标判定
    this.checkGoal();
  };

  /* 兔子作诱饵：玩家抓到的兔子在熊附近释放；活的兔子在 220 内也会引开熊 */
  Level.prototype.applyDecoy = function (dt, ctx) {
    var b = P.animals.bear;
    for (var i = 0; i < this.animals.length; i++) {
      var bear = this.animals[i];
      if (bear.type !== 'bear' || bear.state !== 'CHASE' || bear.decoyT > 0) continue;
      // 活的兔子
      for (var j = 0; j < this.animals.length; j++) {
        var rab = this.animals[j];
        if (rab.type !== 'rabbit' || rab.caught) continue;
        if (U.dist(bear.x, bear.y, rab.x, rab.y) < b.decoyRange) {
          bear.lure(rab, b.decoyTime);
          this.bus.emit('decoy', { x: rab.x, y: rab.y });
          break;
        }
      }
    }
    // 玩家手里的诱饵
    var p = this.player;
    if (p.decoy) {
      for (var k = 0; k < this.animals.length; k++) {
        var b2 = this.animals[k];
        if (b2.type !== 'bear' || b2.state !== 'CHASE') continue;
        if (U.dist(b2.x, b2.y, p.x, p.y) < b2.decoyRange) {
          // 释放兔子
          var rel = new E.Rabbit(p.x + (Math.random() - 0.5) * 40, p.y + (Math.random() - 0.5) * 40);
          this.animals.push(rel);
          p.decoy = null;
          this.stats.decoysUsed++;
          b2.lure(rel, b.decoyTime);
          this.bus.emit('decoy', { x: rel.x, y: rel.y });
          break;
        }
      }
    }
  };

  /* 0.8 秒自动采集 */
  Level.prototype.updateCollect = function (dt, ctx, startled) {
    var p = this.player;
    var c = P.collect;
    var near = null, nd = c.radius * c.radius;
    for (var i = 0; i < this.resources.length; i++) {
      var res = this.resources[i];
      if (!res.alive) continue;
      var d = U.dist2(p.x, p.y, res.x, res.y);
      if (d < nd) { near = res; nd = d; }
    }
    if (!near) {
      p.collectTarget = null; p.collectT = 0;
      for (var j = 0; j < this.resources.length; j++) this.resources[j].collecting = 0;
      return;
    }
    if (p.collectTarget !== near) { p.collectTarget = near; p.collectT = 0; }
    if (startled) { p.collectT = 0; near.collecting = 0; return; }   // 被惊动则取消
    p.collectT += dt;
    near.collecting = U.clamp(p.collectT / c.time, 0, 1);
    if (p.collectT >= c.time) {
      this.collectResource(near, ctx);
      p.collectT = 0;
      p.collectTarget = null;
    }
  };

  Level.prototype.collectResource = function (res, ctx) {
    var p = this.player;
    res.alive = false;
    res.collecting = 0;
    res.cool = this.night ? P.collect.respawnNight : P.collect.respawnDay;
    var def = P.res(res.res);
    if (res.res === 'wood') {
      p.wood++;
      this.stats.wood++;
    } else if (res.res === 'herb') {
      p.poison = 0;
      this.stats.herb++;
    } else if (res.res === 'berry') {
      this.stats.berry++; this.stats.collect++; p.addTemp(def.temp);
    } else if (res.res === 'gold') {
      this.stats.gold++; this.stats.collect++; p.addTemp(def.temp);
    }
    this.stats.score += def.score;
    this.bus.emit('collect', { type: res.res, score: def.score, x: res.x, y: res.y });
  };

  /* 捕获兔子：加分并成为诱饵 */
  Level.prototype.tryCatchRabbit = function (dt, ctx) {
    var r = P.animals.rabbit;
    for (var i = 0; i < this.animals.length; i++) {
      var rab = this.animals[i];
      if (rab.type !== 'rabbit' || rab.caught) continue;
      if (U.dist2(this.player.x, this.player.y, rab.x, rab.y) < r.capture * r.capture) {
        rab.caught = true;
        this.stats.rabbit++;
        this.stats.score += r.score;
        this.player.decoy = rab;
        this.bus.emit('catch', { x: rab.x, y: rab.y });
      }
    }
  };

  /* ── 目标与结算 ── */
  Level.prototype.goalReached = function () {
    var g = this.goal;
    if (g.type === 'collect') return this.stats.collect >= g.target;
    if (g.type === 'score') return this.stats.score >= g.target;
    if (g.type === 'gold') return this.stats.gold >= g.target;
    if (g.type === 'herb') return this.stats.herb >= g.target;
    return this.time >= this.duration;          // survive
  };

  Level.prototype.checkGoal = function () {
    if (this.goalReached()) this.finish(true, this.goal.type);
  };

  /* 星星的实时达成状态（HUD 顶部显示） */
  Level.prototype.starStates = function () {
    var win = this.goalReached();
    var out = [];
    for (var i = 0; i < (this.cfg.stars || []).length; i++) out.push(this.checkStar(this.cfg.stars[i], win));
    while (out.length < 3) out.push(false);
    return out;
  };

  Level.prototype.finish = function (win, reason) {
    if (this.status !== 'playing') return;
    this.status = win ? 'won' : 'lost';
    this.result = {
      win: win, reason: reason,
      score: this.stats.score,
      time: this.time,
      stars: this.evaluateStars(win),
      stats: this.stats
    };
    this.bus.emit('finish', this.result);
  };

  /* 4.4 星级条件 */
  Level.prototype.evaluateStars = function (win) {
    var out = [];
    for (var i = 0; i < (this.cfg.stars || []).length; i++) {
      var c = this.cfg.stars[i];
      out.push(this.checkStar(c, win));
    }
    while (out.length < 3) out.push(false);
    return out.slice(0, 3);
  };

  Level.prototype.checkStar = function (c, win) {
    var s = this.stats;
    switch (c.id) {
      case 'complete': return win;
      case 'time': return this.time <= c.value;
      case 'undetected': {
        var seen = false;
        for (var i = 0; i < this.animals.length; i++) {
          if (this.animals[i].type === 'bear' && this.animals[i].seen) seen = true;
        }
        return !seen;
      }
      case 'no_damage': return !s.damaged;
      case 'no_damage_night': return !s.damagedNight;
      case 'gold': return s.gold >= c.value;
      case 'decoy_used': return s.decoysUsed >= c.value;
      case 'temp': return this.player.temp >= c.value;
      case 'herb_used': return s.herb >= c.value;
      case 'fire_alive': {
        if (!this.fires.length) return false;
        for (var f = 0; f < this.fires.length; f++) {
          if (!this.fires[f].everLit) return false;
          if (this.fires[f].burntOut) return false;
        }
        return true;
      }
      default: return false;
    }
  };

  /* 火堆熄灭记录（供 fire_alive 判定） */
  Level.prototype.trackFireState = function (dt) {
    for (var i = 0; i < this.fires.length; i++) {
      var f = this.fires[i];
      if (f.everLit && !f.lit) f.burntOut = true;
    }
  };

  Level.prototype.onCaught = function (bear) {
    this.stats.damaged = true;
    if (this.night) this.stats.damagedNight = true;
    this.player.dead = true;
    this.bus.emit('hit', { x: this.player.x, y: this.player.y, kind: 'caught' });
    this.finish(false, 'caught');
  };

  DF.Level = Level;
  DF.World = World;
  if (typeof module !== 'undefined' && module.exports) { module.exports = Level; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));