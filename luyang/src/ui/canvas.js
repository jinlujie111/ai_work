/* 拼车狂飙 · 小游戏 Canvas UI（精简完整流程） */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  function CanvasUI(bus, game) {
    this.bus = bus;
    this.game = game;
    this.screen = 'menu';
    this.progress = LY.Save.get();
    this.result = null;
    this.state = null;
    this.paused = false;
    this.checkpoint = false;
    this.toastMsg = '';
    this.toastT = 0;
    this.buttons = [];
    var self = this;
    bus.on('screen', function (n) {
      self.screen = n;
      self.paused = false;
      self.checkpoint = false;
    });
    bus.on('progress', function (p) { self.progress = p; });
    bus.on('result', function (r) { self.result = r; });
    bus.on('hud', function (s) { self.state = s; });
    bus.on('pause', function (on) { self.paused = !!on; });
    bus.on('checkpoint', function (st) { self.checkpoint = !!st; });
    bus.on('toast', function (m) { self.toastMsg = m; self.toastT = 1.6; });
  }

  CanvasUI.prototype.hitTest = function (x, y) {
    for (var i = this.buttons.length - 1; i >= 0; i--) {
      var b = this.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  };

  CanvasUI.prototype.press = function (id) {
    var g = this.game;
    if (id === 'continue') g.startRun();
    else if (id === 'levels') g.openLevels();
    else if (id === 'bag') g.openBag();
    else if (id === 'shop') g.openShop();
    else if (id === 'garage') g.openGarage();
    else if (id === 'menu') g.backMenu();
    else if (id === 'again') g.retry();
    else if (id === 'next') g.nextLevel();
    else if (id === 'pause' || id === 'resume') g.togglePause();
    else if (id === 'left') g.lane(-1);
    else if (id === 'right') g.lane(1);
    else if (id === 'skill') g.skill();
    else if (id === 'rush') g.chooseCheckpoint('rush');
    else if (id === 'upgrade') g.upgradeVehicle();
    else if (id.indexOf('lv') === 0) g.startRun(parseInt(id.slice(2), 10));
    else if (id.indexOf('discard_') === 0) g.chooseCheckpoint('discard', id.slice(8));
    else if (id.indexOf('craft_') === 0) g.craft(parseInt(id.slice(6), 10));
    else if (id.indexOf('sell_') === 0) g.sell(parseInt(id.slice(5), 10));
    else if (id.indexOf('buy_') === 0) g.buy(parseInt(id.slice(4), 10));
  };

  CanvasUI.prototype.btn = function (id, x, y, w, h, label) {
    this.buttons.push({ id: id, x: x, y: y, w: w, h: h, label: label });
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  CanvasUI.prototype.drawBtn = function (ctx, b, fill) {
    ctx.fillStyle = fill || '#2b6cb0';
    roundRect(ctx, b.x, b.y, b.w, b.h, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
  };

  CanvasUI.prototype.draw = function (ctx) {
    this.buttons = [];
    var W = LY.Params.BASE_W;
    var H = LY.Params.BASE_H;
    var p = this.progress;
    var v = LY.Vehicles.get(p.vehicleTier || 1);

    if (this.screen === 'menu') {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#2a2010');
      g.addColorStop(0.45, '#141820');
      g.addColorStop(1, '#0c1018');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffb020';
      for (var sx = -40; sx < W + 40; sx += 28) {
        ctx.fillRect(sx, H * 0.22, 14, 10);
      }
      title(ctx, '拼车狂飙', W / 2, 300);
      sub(ctx, '越撞越大 · ' + v.name + ' · 金币' + (p.gold || 0), W / 2, 360);
      this.btn('continue', 175, 460, 400, 84, '继续闯关');
      this.btn('levels', 175, 570, 400, 70, '选择路段');
      this.btn('bag', 175, 660, 400, 70, '背包合成');
      this.btn('shop', 175, 750, 400, 70, '商城');
      this.btn('garage', 175, 840, 400, 70, '车库');
      for (var bi = 0; bi < this.buttons.length; bi++) {
        this.drawBtn(ctx, this.buttons[bi], bi === 0 ? '#e08900' : '#2a3140');
      }
    } else if (this.screen === 'levels') {
      fill(ctx, '#1a2332', W, H);
      title(ctx, '路段', W / 2, 140);
      var y = 200;
      for (var i = 0; i < Math.min(10, LY.Levels.list.length); i++) {
        var lv = LY.Levels.list[i];
        var unlocked = LY.Levels.isUnlocked(lv.id, p);
        if (unlocked) {
          this.btn('lv' + lv.id, 80, y, 590, 64, '第' + lv.id + '段 ' + lv.name);
          this.drawBtn(ctx, this.buttons[this.buttons.length - 1]);
        } else {
          sub(ctx, '第' + lv.id + '段 锁定', W / 2, y + 32);
        }
        y += 78;
      }
      this.btn('menu', 175, 1180, 400, 70, '返回');
      this.drawBtn(ctx, this.buttons[this.buttons.length - 1], '#334155');
    } else if (this.screen === 'bag') {
      fill(ctx, '#1a2332', W, H);
      title(ctx, '背包', W / 2, 140);
      sub(ctx, '金币 ' + (p.gold || 0), W / 2, 190);
      y = 240;
      for (var level = 1; level <= 30 && y < 1050; level++) {
        var c = LY.Save.getItemCount(level);
        if (!c) continue;
        sub(ctx, 'Lv' + level + ' ×' + c, 120, y + 30);
        if (c >= 2 && level < 30) {
          this.btn('craft_' + level, 280, y, 160, 56, '合成');
          this.drawBtn(ctx, this.buttons[this.buttons.length - 1]);
        }
        this.btn('sell_' + level, 460, y, 160, 56, '卖');
        this.drawBtn(ctx, this.buttons[this.buttons.length - 1], '#475569');
        y += 70;
      }
      this.btn('menu', 175, 1180, 400, 70, '返回');
      this.drawBtn(ctx, this.buttons[this.buttons.length - 1], '#334155');
    } else if (this.screen === 'shop') {
      fill(ctx, '#1a2332', W, H);
      title(ctx, '商城', W / 2, 160);
      sub(ctx, '卖出价=买入50% · 金币 ' + (p.gold || 0), W / 2, 220);
      var drop = LY.Params.dropLevel(p.maxLevel || 1);
      y = 300;
      for (level = Math.max(1, drop - 1); level <= Math.min(30, drop + 1); level++) {
        this.btn('buy_' + level, 125, y, 500, 70, '买 Lv' + level + ' · ' + LY.Params.buyPrice(level) + '金');
        this.drawBtn(ctx, this.buttons[this.buttons.length - 1]);
        y += 90;
      }
      this.btn('menu', 175, 1180, 400, 70, '返回');
      this.drawBtn(ctx, this.buttons[this.buttons.length - 1], '#334155');
    } else if (this.screen === 'garage') {
      fill(ctx, '#1a2332', W, H);
      title(ctx, '车库', W / 2, 200);
      sub(ctx, v.name + ' · ' + v.skill.name, W / 2, 280);
      sub(ctx, v.skill.desc, W / 2, 330);
      this.btn('upgrade', 175, 420, 400, 80, '升阶');
      this.btn('menu', 175, 530, 400, 70, '返回');
      this.flush(ctx);
    } else if (this.screen === 'play' && this.state) {
      this.drawPlayHud(ctx, this.state);
      if (this.paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, W, H);
        title(ctx, '暂停', W / 2, 480);
        this.btn('resume', 175, 560, 400, 80, '继续');
        this.btn('menu', 175, 670, 400, 70, '回菜单');
        this.flush(ctx);
      } else if (this.checkpoint) {
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(0, 0, W, H);
        title(ctx, '窄路', W / 2, 320);
        var d = LY.Run.derived(this.state);
        sub(ctx, '宽 ' + d.width.toFixed(2) + ' / 限 ' + (this.state.level.checkpointMaxWidth || 1.2).toFixed(2), W / 2, 380);
        y = 440;
        var seen = {};
        for (i = 0; i < this.state.tempParts.length; i++) {
          var pid = this.state.tempParts[i];
          if (seen[pid]) continue;
          seen[pid] = true;
          var part = LY.Parts.get(pid);
          this.btn('discard_' + pid, 125, y, 500, 64, '丢掉 ' + ((part && part.name) || pid));
          this.drawBtn(ctx, this.buttons[this.buttons.length - 1], '#334155');
          y += 80;
        }
        this.btn('rush', 175, y + 20, 400, 70, '硬闯');
        this.drawBtn(ctx, this.buttons[this.buttons.length - 1], '#b45309');
      } else {
        this.btn('pause', 580, 20, 140, 56, '暂停');
        this.btn('left', 40, 1180, 160, 80, '←');
        this.btn('skill', 230, 1180, 290, 80, this.state.vehicle.skill.name);
        this.btn('right', 550, 1180, 160, 80, '→');
        this.flush(ctx);
      }
    } else if (this.screen === 'result' && this.result) {
      fill(ctx, 'rgba(10,14,20,0.88)', W, H);
      title(ctx, this.result.survived ? '到站了' : '翻车了', W / 2, 300);
      sub(ctx, '★'.repeat(this.result.stars || 0) + '☆'.repeat(3 - (this.result.stars || 0)), W / 2, 370);
      sub(ctx, '金币 +' + this.result.gold, W / 2, 430);
      sub(ctx, '掉落 ' + ((this.result.drops && this.result.drops.length) || 0) + ' 件', W / 2, 480);
      y = 560;
      if (this.result.survived && this.result.nextLevelId) {
        this.btn('next', 175, y, 400, 80, '下一路段');
        y += 100;
      }
      this.btn('again', 175, y, 400, 70, '重试');
      this.btn('menu', 175, y + 90, 400, 70, '回菜单');
      this.flush(ctx);
    }

    if (this.toastT > 0) {
      this.toastT -= 1 / 60;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      roundRect(ctx, 150, 170, 450, 60, 12);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.toastMsg, W / 2, 208);
    }
  };

  CanvasUI.prototype.drawPlayHud = function (ctx, state) {
    var W = LY.Params.BASE_W;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, state.teach ? 210 : 150);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('第' + state.levelId + '段 · ' + state.level.name, 24, 40);
    var ratio = LY.Run.progressRatio(state);
    ctx.fillStyle = '#222';
    ctx.fillRect(24, 55, W - 48, 14);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(24, 55, (W - 48) * ratio, 14);
    var d = LY.Run.derived(state);
    var maxW = state.level.checkpointMaxWidth || 1.2;
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '18px sans-serif';
    ctx.fillText(Math.floor(state.distance) + 'm  宽' + d.width.toFixed(2) + '/' + maxW.toFixed(2) + '  拼' + state.tempParts.length, 24, 100);
    ctx.fillText(state.vehicle.skill.name + (state.skillCd > 0 ? (' CD' + Math.ceil(state.skillCd)) : ''), 24, 130);
    if (state.teach && state.teach.tip) {
      ctx.fillStyle = 'rgba(180,83,9,0.92)';
      roundRect(ctx, 24, 148, W - 48, 48, 10);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.teach.tip.length > 28 ? state.teach.tip.slice(0, 28) + '…' : state.teach.tip, W / 2, 178);
    }
  };

  CanvasUI.prototype.flush = function (ctx) {
    var self = this;
    this.buttons.forEach(function (b) { self.drawBtn(ctx, b); });
  };

  function fill(ctx, c, w, h) { ctx.fillStyle = c; ctx.fillRect(0, 0, w, h); }
  function title(ctx, t, x, y) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t, x, y);
  }
  function sub(ctx, t, x, y) {
    ctx.fillStyle = '#9fb0c3';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t, x, y);
  }

  LY.CanvasUI = CanvasUI;
  if (typeof module !== 'undefined' && module.exports) module.exports = LY.CanvasUI;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
