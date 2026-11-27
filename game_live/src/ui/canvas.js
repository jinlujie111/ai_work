/* 森林求生｜小游戏 Canvas 界面层
   与 H5 DOM 版同接口：draw(game, dt) 每帧调用；触摸命中在设计坐标里做。 */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};
  var U = DF.Util;
  var P = DF.Params;

  var FONT_SANS = '"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif';
  var FONT_SERIF = '"Songti SC","STSong","Noto Serif SC",serif';
  var FONT_MONO = 'ui-monospace,"SF Mono",Consolas,monospace';

  var C = {
    bone: '#ece5d6', amber: '#f0b45c', leaf: '#8ad09a', blood: '#d4543f',
    panel: 'rgba(20,32,22,.95)', line: 'rgba(236,229,214,.14)', dim: 'rgba(236,229,214,.45)'
  };

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function fillRR(ctx, x, y, w, h, r, style) { rr(ctx, x, y, w, h, r); ctx.fillStyle = style; ctx.fill(); }
  function strokeRR(ctx, x, y, w, h, r, style, lw) { rr(ctx, x, y, w, h, r); ctx.strokeStyle = style; ctx.lineWidth = lw || 2; ctx.stroke(); }
  function star(ctx, x, y, r, on) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var rad = i % 2 === 0 ? r : r * 0.45;
      var px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = on ? C.amber : 'rgba(236,229,214,.2)';
    ctx.fill();
  }

  function CanvasUI(bus, game, renderer) {
    this.bus = bus;
    this.game = game;
    this.renderer = renderer;
    this.buttons = [];
    this.scroll = 0; this.scrollMax = 0;
    this.screen = 'menu';
    this.last = {};
    this.toast = null; this.toastT = 0;
    this.gridRect = null;
    this.bind();
  }

  CanvasUI.prototype.bind = function () {
    var self = this, game = this.game;
    this.bus.on('finish', function (r) { self.screen = 'result'; self.result = r; });
    this.bus.on('levelStart', function () { self.screen = 'play'; });
    this.bus.on('menu', function () { self.screen = 'menu'; self.scroll = 0; });
  };

  CanvasUI.prototype.startLevel = function (id) {
    var game = this.game;
    if (!game.unlocked(id)) { this.say('先通过前一关'); return; }
    DF.Audio.init();
    DF.Audio.click();
    game.startLevel(id);
  };

  CanvasUI.prototype.say = function (text) {
    this.toast = text;
    this.toastT = 1.6;
  };

  /* 命中测试：设计坐标 */
  CanvasUI.prototype.hitTest = function (x, y) {
    for (var i = this.buttons.length - 1; i >= 0; i--) {
      var b = this.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  };

  CanvasUI.prototype.press = function (id) {
    var game = this.game;
    if (id === 'sound') { DF.Audio.init(); var m = DF.Audio.toggle(); this.soundMuted = m; this.say(m ? '音效 关' : '音效 开'); return; }
    if (id === 'retry') { game.restart(); return; }
    if (id === 'next') { game.nextLevel(); return; }
    if (id === 'menu') { game.toMenu(); return; }
    if (id === 'share') { this.say('成绩 ' + (game.level ? game.level.result.score : 0) + ' 分'); return; }
    if (id && id.indexOf('lv') === 0) this.startLevel(parseInt(id.slice(2), 10));
  };

  CanvasUI.prototype.scrollBy = function (dy) {
    this.scroll = U.clamp(this.scroll + dy, 0, this.scrollMax);
  };

  /* ══════════ 绘制 ══════════ */
  CanvasUI.prototype.draw = function (game, dt) {
    var r = game.renderer;
    var ctx = r.ctx;
    // 界面也用 750×1334 设计坐标绘制，与世界同一套缩放
    ctx.setTransform(r.ratio * r.scale, 0, 0, r.ratio * r.scale, r.ox * r.ratio, r.oy * r.ratio);
    this.buttons = [];
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toast = null; }

    if (this.screen === 'play') this.drawHud(ctx, game);
    else if (this.screen === 'result') this.drawResult(ctx, game);
    else this.drawMenu(ctx, game);

    if (this.toast) {
      ctx.font = '500 26px ' + FONT_SANS;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,14,10,.85)';
      var tw = ctx.measureText(this.toast).width + 48;
      fillRR(ctx, (P.BASE_W - tw) / 2, P.BASE_H - 200, tw, 56, 28, 'rgba(8,14,10,.88)');
      ctx.fillStyle = '#f6e6c9';
      ctx.fillText(this.toast, P.BASE_W / 2, P.BASE_H - 200 + 37);
      ctx.textAlign = 'left';
    }
  };

  /* ── HUD ── */
  CanvasUI.prototype.drawHud = function (ctx, game) {
    var level = game.level;
    if (!level) return;
    var L = this.last;
    var p = level.player;

    // 左栏：关卡号、关卡名、目标
    if (L.lvId !== level.id) {
      L.lvId = level.id;
      L.stars = null;
    }
    ctx.textAlign = 'left';
    ctx.font = '500 16px ' + FONT_SANS;
    ctx.fillStyle = 'rgba(236,229,214,.45)';
    ctx.fillText('第 ' + level.id + ' 关', 26, 52);
    ctx.font = '600 27px ' + FONT_SANS;
    ctx.fillStyle = '#f0e6d2';
    ctx.fillText(level.cfg.name || '', 26, 82);
    ctx.font = '500 17px ' + FONT_SANS;
    ctx.fillStyle = C.amber;
    ctx.fillText(level.cfg.goalText || '', 26, 108);

    // 体温条
    var bw = 340, bx = (P.BASE_W - bw) / 2, by = 44;
    var pct = U.clamp(p.temp / P.player.tempMax, 0, 1);
    fillRR(ctx, bx, by, bw, 20, 10, 'rgba(0,0,0,.55)');
    strokeRR(ctx, bx, by, bw, 20, 10, 'rgba(236,229,214,.12)', 2);
    if (pct > 0) {
      var g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      if (pct <= 0.3) { g.addColorStop(0, '#a63a2c'); g.addColorStop(1, '#d4543f'); }
      else { g.addColorStop(0, '#4e9e6b'); g.addColorStop(1, '#8ad09a'); }
      ctx.save();
      rr(ctx, bx + 2, by + 2, (bw - 4) * pct, 16, 8);
      ctx.fillStyle = g; ctx.fill();
      ctx.restore();
    }
    // 倒计时
    var remain = level.night ? (level.duration - level.time) : (level.dayLength - level.time);
    var secs = Math.max(0, Math.ceil(remain));
    ctx.font = '600 26px ' + FONT_MONO;
    ctx.textAlign = 'center';
    ctx.fillStyle = level.night ? '#9fc4e8' : 'rgba(236,229,214,.9)';
    ctx.fillText(String(secs), P.BASE_W / 2, by + 54);
    ctx.textAlign = 'left';

    // 右上：星星实时状态 + 分数
    var stars = level.starStates();
    for (var i = 0; i < 3; i++) star(ctx, P.BASE_W - 26 - (2 - i) * 24, 50, 11, !!stars[i]);
    ctx.font = '600 26px ' + FONT_MONO;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,222,170,.95)';
    ctx.fillText(String(level.stats.score), P.BASE_W - 26, 86);
    ctx.textAlign = 'left';
    // 目标进度
    var goal = level.goal;
    var cur, target;
    if (goal.type === 'collect') { cur = level.stats.collect; target = goal.target; }
    else if (goal.type === 'gold') { cur = level.stats.gold; target = goal.target; }
    else if (goal.type === 'score') { cur = level.stats.score; target = goal.target; }
    else { cur = Math.round(level.time); target = level.duration; }
    var gtext = cur + '/' + target;
    ctx.font = '600 28px ' + FONT_MONO;
    ctx.fillStyle = '#f0e0c0';
    ctx.fillText(gtext, 46, P.BASE_H - 60);
    ctx.beginPath();
    ctx.arc(52, P.BASE_H - 96, 11, 0, U.TAU);
    ctx.fillStyle = goal.type === 'gold' ? C.amber : '#e0647a';
    ctx.fill();
  };

  /* ── 选关 ── */
  CanvasUI.prototype.drawMenu = function (ctx, game) {
    ctx.fillStyle = 'rgba(8,14,10,.92)';
    ctx.fillRect(0, 0, P.BASE_W, P.BASE_H);

    ctx.textAlign = 'center';
    ctx.font = '600 74px ' + FONT_SERIF;
    ctx.fillStyle = '#f2e6cd';
    ctx.fillText('森林求生', P.BASE_W / 2, 190);
    ctx.font = '400 26px ' + FONT_SANS;
    ctx.fillStyle = 'rgba(236,229,214,.5)';
    ctx.fillText('单指拖动，活到天亮', P.BASE_W / 2, 240);
    var total = 0;
    for (var i = 1; i <= DF.Levels.count; i++) total += game.levelRecord(i).stars;
    ctx.fillStyle = 'rgba(236,229,214,.4)';
    ctx.font = '500 24px ' + FONT_SANS;
    ctx.fillText('已得 ' + total + ' / 150 星', P.BASE_W / 2, 288);
    ctx.textAlign = 'left';

    // 关卡网格
    var cols = 5, cell = 104, gap = 20;
    var gridW = cols * cell + (cols - 1) * gap;
    var gx = (P.BASE_W - gridW) / 2, gy = 340;
    var viewH = P.BASE_H - gy - 170;
    this.gridRect = { x: gx, y: gy, w: gridW, h: viewH };
    var rows = Math.ceil(DF.Levels.count / cols);
    var contentH = rows * (cell + gap);
    this.scrollMax = Math.max(0, contentH - viewH);
    this.scroll = U.clamp(this.scroll, 0, this.scrollMax);

    ctx.save();
    ctx.beginPath(); ctx.rect(gx, gy, gridW, viewH); ctx.clip();
    for (var id = 1; id <= DF.Levels.count; id++) {
      var rec = game.levelRecord(id);
      var locked = !game.unlocked(id);
      var col = (id - 1) % cols, row = Math.floor((id - 1) / cols);
      var x = gx + col * (cell + gap);
      var y = gy + row * (cell + gap) - this.scroll;
      if (y > gy + viewH || y + cell < gy) continue;
      fillRR(ctx, x, y, cell, cell, 16, locked ? 'rgba(20,30,22,.6)' : 'rgba(28,44,30,.9)');
      strokeRR(ctx, x, y, cell, cell, 16, locked ? 'rgba(236,229,214,.08)' : 'rgba(236,229,214,.18)', 2);
      ctx.font = '600 34px ' + FONT_MONO;
      ctx.textAlign = 'center';
      ctx.fillStyle = locked ? 'rgba(236,229,214,.3)' : 'rgba(236,229,214,.85)';
      ctx.fillText(String(id), x + cell / 2, y + cell / 2 + 4);
      for (var s = 0; s < 3; s++) star(ctx, x + cell / 2 + (s - 1) * 24, y + cell - 20, 10, s < rec.stars);
      ctx.textAlign = 'left';
      if (!locked) this.buttons.push({ id: 'lv' + id, x: x, y: y, w: cell, h: cell });
    }
    ctx.restore();

    // 音效开关
    var sb = { id: 'sound', x: 40, y: P.BASE_H - 110, w: 180, h: 56 };
    fillRR(ctx, sb.x, sb.y, sb.w, sb.h, 14, 'rgba(236,229,214,.05)');
    strokeRR(ctx, sb.x, sb.y, sb.w, sb.h, 14, 'rgba(236,229,214,.16)', 2);
    ctx.font = '500 24px ' + FONT_SANS;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(236,229,214,.75)';
    ctx.fillText(this.soundMuted ? '音效 关' : '音效 开', sb.x + sb.w / 2, sb.y + 37);
    ctx.textAlign = 'left';
    this.buttons.push(sb);
  };

  /* ── 结算 ── */
  CanvasUI.prototype.drawResult = function (ctx, game) {
    var r = this.result || { win: false, stars: [false, false, false], score: 0, time: 0, reason: '' };
    ctx.fillStyle = 'rgba(6,11,8,.88)';
    ctx.fillRect(0, 0, P.BASE_W, P.BASE_H);

    var pw = 570, ph = 780, px = (P.BASE_W - pw) / 2, py = (P.BASE_H - ph) / 2;
    var g = ctx.createLinearGradient(px, py, px, py + ph);
    g.addColorStop(0, 'rgba(28,44,30,.97)');
    g.addColorStop(1, 'rgba(10,17,11,.99)');
    fillRR(ctx, px, py, pw, ph, 28, g);
    strokeRR(ctx, px, py, pw, ph, 28, 'rgba(236,229,214,.14)', 2);

    var titles = { survive: '活到天亮', collect: '采集完成', score: '分数达标', gold: '拿到金浆果', cold: '体温耗尽', caught: '被熊抓住了' };
    ctx.textAlign = 'center';
    ctx.font = '600 50px ' + FONT_SERIF;
    ctx.fillStyle = '#f4e9d6';
    ctx.fillText(r.win ? (titles[r.reason] || '通关') : (titles[r.reason] || '失败'), P.BASE_W / 2, py + 90);

    for (var i = 0; i < 3; i++) star(ctx, P.BASE_W / 2 + (i - 1) * 84, py + 164, 32, !!r.stars[i]);

    // 星星条件清单
    if (game.level && game.level.cfg.stars) {
      ctx.textAlign = 'left';
      for (var j = 0; j < game.level.cfg.stars.length; j++) {
        var cy = py + 218 + j * 30;
        ctx.fillStyle = r.stars[j] ? C.amber : 'rgba(236,229,214,.25)';
        ctx.beginPath(); ctx.arc(P.BASE_W / 2 - 150, cy - 6, 7, 0, U.TAU); ctx.fill();
        ctx.font = '500 20px ' + FONT_SANS;
        ctx.fillStyle = r.stars[j] ? '#f0dfc0' : 'rgba(236,229,214,.45)';
        ctx.fillText(DF.Levels.starText(game.level.cfg.stars[j]), P.BASE_W / 2 - 128, cy);
      }
    }

    ctx.font = '600 74px ' + FONT_MONO;
    ctx.fillStyle = C.amber;
    ctx.fillText(String(r.score), P.BASE_W / 2, py + 330);
    ctx.font = '400 24px ' + FONT_SANS;
    ctx.fillStyle = 'rgba(236,229,214,.45)';
    ctx.fillText('用时 ' + Math.round(r.time) + ' 秒', P.BASE_W / 2, py + 366);
    ctx.textAlign = 'left';

    var bw = pw - 80, bx = px + 40;
    this.button(ctx, 'next', bx, py + 404, bw, 74, '下一个', true);
    this.button(ctx, 'retry', bx, py + 492, bw, 74, '重试', false);
    this.button(ctx, 'share', bx, py + 580, bw, 56, '分享', false);
    this.button(ctx, 'menu', bx, py + 650, bw, 56, '返回选关', false);
  };

  CanvasUI.prototype.button = function (ctx, id, x, y, w, h, label, primary) {
    if (primary) {
      var g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#eab15f'); g.addColorStop(1, '#b8712a');
      fillRR(ctx, x, y, w, h, 18, g);
      ctx.fillStyle = '#221403';
    } else {
      fillRR(ctx, x, y, w, h, 18, 'rgba(236,229,214,.05)');
      strokeRR(ctx, x, y, w, h, 18, 'rgba(236,229,214,.16)', 2);
      ctx.fillStyle = 'rgba(236,229,214,.8)';
    }
    ctx.font = '600 28px ' + FONT_SANS;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    this.buttons.push({ id: id, x: x, y: y, w: w, h: h });
  };

  DF.CanvasUI = CanvasUI;
  if (typeof module !== 'undefined' && module.exports) { module.exports = CanvasUI; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));