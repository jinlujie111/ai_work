/* 拼车狂飙 · 主循环 */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  function Game(opts) {
    this.bus = opts.bus;
    this.renderer = opts.renderer;
    this.ui = null;
    this.screen = 'menu';
    this.state = null;
    this.rng = LY.Util.rng(Date.now() & 0xffffffff);
    this._acc = 0;
    this._last = LY.Util.now();
    this._running = false;
    this.progress = LY.Save.init();
    this.lastResult = null;
  }

  Game.prototype.start = function () {
    var self = this;
    this._running = true;
    this._last = LY.Util.now();
    LY.Save.pullFromCloud(function () {
      self.progress = LY.Save.get();
      self.bus.emit('progress', self.progress);
    });
    var loop = function (t) {
      if (!self._running) return;
      var now = typeof t === 'number' ? t : LY.Util.now();
      var dt = Math.min(0.05, (now - self._last) / 1000);
      self._last = now;
      self._acc += dt;
      var step = 1 / 60;
      var n = 0;
      while (self._acc >= step && n < 5) {
        self.tick(step);
        self._acc -= step;
        n++;
      }
      self.draw();
      LY.Util.raf(loop);
    };
    LY.Util.raf(loop);
    this.bus.emit('screen', this.screen);
    this.bus.emit('progress', this.progress);
  };

  Game.prototype.tick = function (dt) {
    if (this.screen !== 'play' || !this.state) return;
    var prev = this.state.status;
    LY.Run.update(this.state, dt, this.rng);
    if (this.state.status === 'checkpoint' && prev !== 'checkpoint') {
      this.bus.emit('checkpoint', this.state);
    }
    if (this.state.status === 'ended') this.onEnded();
    this.bus.emit('hud', this.state);
  };

  Game.prototype.draw = function () {
    var r = this.renderer;
    var dt = 1 / 60;
    if (LY.Util.isMiniGame() && this.ui && this.ui.draw) {
      r.begin();
      if (this.screen === 'play' && this.state) r.drawWorld(this.state, dt);
      this.ui.draw(r.ctx);
      return;
    }
    if (this.screen === 'play' && this.state) {
      r.begin();
      r.drawWorld(this.state, dt);
    }
  };

  Game.prototype.openLevels = function () {
    this.screen = 'levels';
    this.bus.emit('screen', 'levels');
    this.bus.emit('progress', LY.Save.get());
  };

  Game.prototype.openBag = function () {
    this.screen = 'bag';
    this.bus.emit('screen', 'bag');
    this.bus.emit('progress', LY.Save.get());
  };

  Game.prototype.openShop = function () {
    this.screen = 'shop';
    this.bus.emit('screen', 'shop');
    this.bus.emit('progress', LY.Save.get());
  };

  Game.prototype.openGarage = function () {
    this.screen = 'garage';
    this.bus.emit('screen', 'garage');
    this.bus.emit('progress', LY.Save.get());
  };

  Game.prototype.startRun = function (levelId) {
    this.progress = LY.Save.get();
    var id = levelId || this.progress.selectedLevel || 1;
    if (!LY.Levels.isUnlocked(id, this.progress)) {
      this.bus.emit('toast', '尚未解锁');
      return;
    }
    LY.Save.selectLevel(id);
    this.progress = LY.Save.get();
    var lv = LY.Levels.get(id);
    this.state = LY.Run.create(this.progress, lv);
    this.rng = LY.Util.rng((Date.now() ^ (id * 7919)) >>> 0);
    this.screen = 'play';
    this.lastResult = null;
    this.bus.emit('screen', 'play');
    this.bus.emit('hud', this.state);
    if (this.state.teach) {
      this.bus.emit('toast', '第1关教学：撞发光废铁！');
    } else {
      this.bus.emit('toast', lv.name + ' · ' + this.state.vehicle.name);
    }
  };

  Game.prototype.onEnded = function () {
    var result = this.state.result;
    this.lastResult = result;
    this.progress = LY.Save.recordRun(result);
    this.screen = 'result';
    this.bus.emit('result', result);
    this.bus.emit('screen', 'result');
    this.bus.emit('progress', this.progress);
  };

  Game.prototype.retry = function () {
    this.startRun((this.lastResult && this.lastResult.levelId) || 1);
  };

  Game.prototype.nextLevel = function () {
    var id = this.lastResult && this.lastResult.nextLevelId;
    if (!id) {
      this.bus.emit('toast', '已经是最后一段');
      return;
    }
    this.startRun(id);
  };

  Game.prototype.backMenu = function () {
    this.screen = 'menu';
    this.state = null;
    this.bus.emit('checkpoint', null);
    this.bus.emit('screen', 'menu');
  };

  Game.prototype.togglePause = function () {
    if (!this.state || this.screen !== 'play') return;
    if (this.state.status === 'checkpoint') return;
    var st = LY.Run.togglePause(this.state);
    this.bus.emit('hud', this.state);
    this.bus.emit('pause', st === 'paused');
  };

  Game.prototype.lane = function (dir) {
    if (this.state && this.state.status === 'paused') return;
    if (this.state) LY.Run.changeLane(this.state, dir);
  };

  Game.prototype.skill = function () {
    if (!this.state) return;
    var r = LY.Run.useSkill(this.state);
    this.bus.emit('hud', this.state);
    this.bus.emit('toast', r.ok ? this.state.vehicle.skill.name : (r.reason || '无法释放'));
  };

  Game.prototype.chooseCheckpoint = function (action, partId) {
    if (!this.state) return;
    var r = LY.Run.chooseCheckpoint(this.state, action, partId);
    if (!r.ok) {
      this.bus.emit('toast', r.reason || '无法选择');
      return;
    }
    this.bus.emit('checkpoint', null);
    this.bus.emit('hud', this.state);
    if (this.state.status === 'ended') this.onEnded();
  };

  Game.prototype.craft = function (level) {
    var r = LY.Save.craft(level);
    this.progress = LY.Save.get();
    this.bus.emit('progress', this.progress);
    this.bus.emit('toast', r.ok ? ('合成 Lv' + (level + 1)) : (r.reason || '失败'));
  };

  Game.prototype.buy = function (level) {
    var r = LY.Save.buy(level, 1);
    this.progress = LY.Save.get();
    this.bus.emit('progress', this.progress);
    this.bus.emit('toast', r.ok ? '已购买' : (r.reason || '失败'));
  };

  Game.prototype.sell = function (level) {
    var r = LY.Save.sell(level, 1);
    this.progress = LY.Save.get();
    this.bus.emit('progress', this.progress);
    this.bus.emit('toast', r.ok ? ('卖出 +' + r.gold) : (r.reason || '失败'));
  };

  Game.prototype.upgradeVehicle = function () {
    var r = LY.Save.upgradeVehicle();
    this.progress = LY.Save.get();
    this.bus.emit('progress', this.progress);
    this.bus.emit('toast', r.ok ? ('升到 ' + LY.Vehicles.get(this.progress.vehicleTier).name) : (r.reason || '失败'));
  };

  LY.Game = Game;
  if (typeof module !== 'undefined' && module.exports) module.exports = LY.Game;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
