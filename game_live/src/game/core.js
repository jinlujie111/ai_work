/* 森林求生｜核心循环
   CODE-102 固定步长主循环（1/60 秒），CODE-104 摄像机跟随与死区，
   10.2 存档：每关最高星级与最高分。 */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};
  var U = DF.Util;
  var P = DF.Params;
  var Levels = DF.Levels;

  var STEP = 1 / 60;
  var SAVE_KEY = 'forest-survival.save';
  var SAVE_VERSION = 1;

  function Game(opts) {
    opts = opts || {};
    this.bus = opts.bus || U.emitter();
    this.renderer = opts.renderer;
    this.ui = opts.ui;
    this.input = opts.input || DF.Input;
    this.storage = opts.storage || U.storage;

    this.state = 'menu';          // menu / playing / result
    this.level = null;
    this.camera = { x: 0, y: 0 };
    this.acc = 0;
    this.lastT = 0;
    this.progress = this.loadProgress();
    this.bindAudio();
  }

  /* ── 存档 ─────────────────────────────────────── */
  Game.prototype.loadProgress = function () {
    var raw = null;
    try { raw = this.storage.get(SAVE_KEY, null); } catch (e) { raw = null; }
    var data = null;
    if (raw) { try { data = JSON.parse(raw); } catch (e) { data = null; } }
    if (!data || data.v !== SAVE_VERSION) data = { v: SAVE_VERSION, levels: {}, settings: { sfx: 1, music: 1 } };
    if (!data.levels) data.levels = {};
    return data;
  };

  Game.prototype.saveProgress = function () {
    try { this.storage.set(SAVE_KEY, JSON.stringify(this.progress)); } catch (e) {}
  };

  Game.prototype.levelRecord = function (id) {
    return this.progress.levels[String(id)] || { stars: 0, score: 0 };
  };

  Game.prototype.unlocked = function (id) {
    if (id <= 1) return true;
    return this.levelRecord(id - 1).stars > 0;
  };

  /* ── 关卡流程 ─────────────────────────────────── */
  Game.prototype.startLevel = function (id) {
    var cfg = Levels.get(id);
    if (!cfg) return;
    cfg = Object.assign({}, cfg);
    cfg.id = id;
    cfg.seed = (id * 2654435761) >>> 0;
    this.level = new DF.Level(cfg, this.bus);
    this.state = 'playing';
    this.camera.x = this.level.player.x;
    this.camera.y = this.level.player.y;
    this.input.clear();
    this.bus.emit('levelStart', { id: id, name: cfg.name });
  };

  Game.prototype.restart = function () {
    if (this.level) this.startLevel(this.level.id);
  };

  Game.prototype.nextLevel = function () {
    var id = this.level ? this.level.id : 1;
    if (id < Levels.count) this.startLevel(id + 1);
    else this.toMenu();
  };

  Game.prototype.toMenu = function () {
    this.state = 'menu';
    this.level = null;
    this.input.clear();
    this.bus.emit('menu', {});
  };

  /* ── 固定步长循环 ─────────────────────────────── */
  Game.prototype.start = function () {
    var self = this;
    this.lastT = U.now();
    U.raf(function (t) { self.frame(t); });
  };

  Game.prototype.frame = function (now) {
    var self = this;
    var dt = Math.min(0.25, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    this.acc += dt;
    var steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 5) this.acc = 0;

    try {
      this.renderer.render(this, dt);
      if (this.ui && this.ui.draw) this.ui.draw(this, dt);
    } catch (err) {
      // 单帧异常不应中断整局
      if (global.console) console.error('[forest-survival] frame error', err);
    }
    U.raf(function (t) { self.frame(t); });
  };

  Game.prototype.step = function (dt) {
    this.input.update();
    if (this.input.consumePause() && this.state === 'playing') this.bus.emit('pause', {});
    if (this.state !== 'playing' || !this.level) return;

    var level = this.level;
    var player = level.player;
    var dragActive = this.input.drag.active;
    var dragPoint = { x: this.input.drag.x, y: this.input.drag.y };

    // 桌面端键盘作为拖动的等价输入
    var ax = this.input.axis.x, ay = this.input.axis.y;
    if (ax || ay) {
      dragActive = true;
      dragPoint = { x: player.x + ax * 400, y: player.y + ay * 400 };
    }

    var self = this;
    var ctx = {
      dragActive: dragActive,
      dragPoint: dragPoint,
      world: level.world,
      player: player,
      night: level.night,
      bus: this.bus,
      onCaught: function (bear) { level.onCaught(bear); }
    };

    level.update(dt, ctx);
    this.updateCamera(dt);
  };

  /* CODE-104：死区 40 像素，插值 0.12，限制在地图内
     约定：camera.x/y 是视野中心，角色位于屏幕中心附近。 */
  Game.prototype.updateCamera = function (dt) {
    var level = this.level;
    if (!level) return;
    var cam = this.camera, p = level.player;
    var halfW = P.BASE_W / 2, halfH = P.BASE_H / 2;
    var dead = P.camera.deadZone;
    var k = 1 - Math.pow(1 - P.camera.lerp, dt * 60);
    var dx = p.x - cam.x, dy = p.y - cam.y;
    if (Math.abs(dx) > dead) cam.x += (dx - Math.sign(dx) * dead) * k;
    if (Math.abs(dy) > dead) cam.y += (dy - Math.sign(dy) * dead) * k;
    cam.x = clampCam(cam.x, level.map.w, halfW);
    cam.y = clampCam(cam.y, level.map.h, halfH);
  };

  /* 地图比视口小的那一轴，镜头居中 */
  function clampCam(v, mapSize, half) {
    if (mapSize <= half * 2) return mapSize / 2;
    return U.clamp(v, half, mapSize - half);
  }

  /* ── 结算入库 ─────────────────────────────────── */
  Game.prototype.commitResult = function (result) {
    var id = this.level ? this.level.id : 1;
    var key = String(id);
    var rec = this.progress.levels[key] || { stars: 0, score: 0 };
    var stars = 0;
    for (var i = 0; i < result.stars.length; i++) if (result.stars[i]) stars++;
    rec.stars = Math.max(rec.stars, stars);
    rec.score = Math.max(rec.score, result.score);
    this.progress.levels[key] = rec;
    this.saveProgress();
  };

  /* ── 音频接线（spec 第八章） ───────────────────── */
  Game.prototype.bindAudio = function () {
    var bus = this.bus, self = this;
    bus.on('collect', function (e) { DF.Audio.collect(e.score); });
    bus.on('catch', function () { DF.Audio.catchRabbit(); });
    bus.on('bearAlert', function () { DF.Audio.bearAlert(); });
    bus.on('bearStep', function () { DF.Audio.bearStep(); });
    bus.on('snakeHiss', function () { DF.Audio.snakeHiss(); });
    bus.on('nightFall', function () { DF.Audio.nightFall(); });
    bus.on('dawn', function () { DF.Audio.dawn(); });
    bus.on('hit', function () { DF.Audio.hurt(); self.renderer.hitFlash = 1; self.renderer.shake = 10; });
    bus.on('decoy', function () { DF.Audio.decoy(); });
    bus.on('fireStoke', function () { DF.Audio.fire(); });
    bus.on('finish', function (r) { if (r.win) DF.Audio.dawn(); else DF.Audio.lose(); self.commitResult(r); });
  };

  DF.Game = Game;
  DF.Game.STEP = STEP;
  DF.Game.SAVE_KEY = SAVE_KEY;
  if (typeof module !== 'undefined' && module.exports) { module.exports = Game; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));