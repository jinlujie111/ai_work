/* 森林求生｜渲染层
   7.2 2.5D 做法：垂直压缩 0.85、接地阴影、按 y 排序、树冠遮挡。
   7.4 动画全部程序化，不做逐帧。 */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};
  var U = DF.Util;
  var P = DF.Params;

  var C = {
    ground: '#31462f', groundDark: '#26361f', water: '#2a5a6b', waterRim: '#4a8a9a',
    trunk: '#3a2c1e', canopy: '#3f6b3a', canopyDark: '#274a26',
    player: '#f2e3c4', playerDark: '#8d7a58',
    bear: '#4a3a2c', bearDark: '#2e241b',
    snake: '#37603c', snakeDark: '#1f3a24',
    rabbit: '#d9c9b1', rabbitDark: '#8f7f6a',
    fire: '#ff9a3c', fireCore: '#ffe6a8', log: '#6b4a2e',
    night: '#0b1a24'
  };

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ratio = 1;
    this.w = 0; this.h = 0;
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.mask = U.createCanvas(2, 2);
    this.maskCtx = this.mask.getContext('2d');
    this.shake = 0;
    this.hitFlash = 0;
    this.time = 0;
    this.resize();
  }

  Renderer.prototype.resize = function () {
    var vp = U.getViewport(this.canvas);
    this.ratio = vp.ratio;
    this.w = vp.w; this.h = vp.h;
    this.canvas.width = Math.round(this.w * this.ratio);
    this.canvas.height = Math.round(this.h * this.ratio);
    this.mask.width = this.canvas.width;
    this.mask.height = this.canvas.height;
    this.scale = Math.min(this.w / P.BASE_W, this.h / P.BASE_H);
    this.ox = (this.w - P.BASE_W * this.scale) / 2;
    this.oy = (this.h - P.BASE_H * this.scale) / 2;
  };

  /* 屏幕坐标 → 设计坐标 */
  Renderer.prototype.toDesign = function (sx, sy) {
    return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale };
  };

  /* ══════════════ 主绘制 ══════════════ */
  Renderer.prototype.render = function (game, dt) {
    var ctx = this.ctx;
    this.time += dt;
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 2.4);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 26);

    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = '#0d1510';
    ctx.fillRect(0, 0, this.w, this.h);

    var level = game.level;
    if (!level) return;

    var cam = game.camera;
    var sx = (Math.random() - 0.5) * this.shake;
    var sy = (Math.random() - 0.5) * this.shake;

    ctx.save();
    ctx.translate(this.ox + sx, this.oy + sy);
    ctx.scale(this.scale, this.scale);
    ctx.beginPath();
    ctx.rect(0, 0, P.BASE_W, P.BASE_H);
    ctx.clip();

    // 世界坐标：相机中心对齐屏幕中心
    ctx.save();
    ctx.translate(P.BASE_W / 2 - cam.x, P.BASE_H / 2 - cam.y);
    this.drawGround(ctx, level);
    this.drawEntities(ctx, level, game);
    // 引导箭头画在世界坐标里
    if (level.cfg.guide === 'berry') this.drawGuide(ctx, level);
    ctx.restore();

    ctx.restore();

    // 夜间视野遮罩
    if (level.night) this.drawNightMask(ctx, game);

    // 受击闪红
    if (this.hitFlash > 0) {
      ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
      ctx.fillStyle = 'rgba(200,40,30,' + (this.hitFlash * 0.35).toFixed(3) + ')';
      ctx.fillRect(0, 0, this.w, this.h);
    }
  };

  /* ── 地表 ── */
  Renderer.prototype.drawGround = function (ctx, level) {
    var map = level.map;
    ctx.fillStyle = C.ground;
    ctx.fillRect(0, 0, map.w, map.h);
    // 地面斑驳
    ctx.fillStyle = C.groundDark;
    var rng = U.rng(map.w * 31 + map.h);
    for (var i = 0; i < 90; i++) {
      var x = rng() * map.w, y = rng() * map.h;
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(30, 90), rng.range(20, 60), rng() * 3, 0, U.TAU);
      ctx.fill();
    }
    // 水域
    for (var w = 0; w < map.waters.length; w++) {
      var wa = map.waters[w];
      ctx.fillStyle = C.water;
      ctx.beginPath();
      ctx.ellipse(wa.x, wa.y, wa.r, wa.r * 0.82, 0, 0, U.TAU);
      ctx.fill();
      ctx.strokeStyle = C.waterRim;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 地图边界
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(P.map.border, P.map.border, map.w - P.map.border * 2, map.h - P.map.border * 2);
  };

  /* ── 实体（按 y 排序） ── */
  Renderer.prototype.drawEntities = function (ctx, level, game) {
    var list = [];
    var i;
    for (i = 0; i < level.map.trees.length; i++) list.push({ e: level.map.trees[i], kind: 'tree' });
    for (i = 0; i < level.resources.length; i++) {
      var r = level.resources[i];
      if (r.alive || r.collecting > 0) list.push({ e: r, kind: 'res' });
    }
    for (i = 0; i < level.fires.length; i++) list.push({ e: level.fires[i], kind: 'fire' });
    for (i = 0; i < level.animals.length; i++) {
      var a = level.animals[i];
      if (a.type === 'rabbit' && a.caught) continue;
      list.push({ e: a, kind: 'animal' });
    }
    list.push({ e: level.player, kind: 'player' });

    list.sort(function (p, q) { return p.e.y - q.e.y; });

    for (i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.kind === 'tree') this.drawTree(ctx, it.e);
      else if (it.kind === 'res') this.drawResource(ctx, it.e);
      else if (it.kind === 'fire') this.drawFire(ctx, it.e);
      else if (it.kind === 'animal') this.drawAnimal(ctx, it.e, level);
      else this.drawPlayer(ctx, it.e, level);
    }
  };

  Renderer.prototype.shadow = function (ctx, x, y, rx, ry) {
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, U.TAU);
    ctx.fill();
  };

  /* 树：树干 + 两层树冠，树冠可遮住角色 */
  Renderer.prototype.drawTree = function (ctx, t) {
    var sq = P.map.squashY;
    this.shadow(ctx, t.x, t.y + 4, t.vis * 0.7, t.vis * 0.28);
    ctx.fillStyle = C.trunk;
    ctx.fillRect(t.x - 7, t.y - 34, 14, 40);
    ctx.fillStyle = C.canopyDark;
    ctx.beginPath();
    ctx.ellipse(t.x, t.y - 56, 34, 34 * sq + 8, 0, 0, U.TAU);
    ctx.fill();
    ctx.fillStyle = C.canopy;
    ctx.beginPath();
    ctx.ellipse(t.x - 7, t.y - 68, 24, 24 * sq + 6, 0, 0, U.TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(t.x + 9, t.y - 62, 20, 20 * sq + 5, 0, 0, U.TAU);
    ctx.fill();
  };

  Renderer.prototype.drawPlayer = function (ctx, p, level) {
    var sq = P.map.squashY;
    var bob = p.moving ? Math.sin(p.anim * 2) * 4 : Math.sin(this.time * 2) * 1.6;
    var scale = p.moving ? 1 : 1 + Math.sin(this.time * 2.4) * 0.03;
    this.shadow(ctx, p.x, p.y + 6, 12, 5);
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.scale(scale, scale * sq);
    ctx.fillStyle = C.player;
    ctx.beginPath();
    ctx.ellipse(0, -10, 11, 12, 0, 0, U.TAU);
    ctx.fill();
    ctx.fillStyle = C.playerDark;
    ctx.beginPath();
    ctx.arc(0, -22, 7, 0, U.TAU);
    ctx.fill();
    // 朝向指示
    ctx.fillStyle = C.player;
    ctx.beginPath();
    ctx.arc(Math.cos(p.facing) * 5, -22 + Math.sin(p.facing) * 3, 2.4, 0, U.TAU);
    ctx.fill();
    ctx.restore();

    // 中毒提示
    if (p.poison > 0) {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.time * 12);
      ctx.fillStyle = '#7fd6a0';
      ctx.beginPath();
      ctx.arc(p.x, p.y - 40, 4, 0, U.TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  };

  Renderer.prototype.drawAnimal = function (ctx, a, level) {
    var sq = P.map.squashY;
    if (a.type === 'bear') {
      var lean = a.state === 'CHASE' ? 0.18 : 0;
      this.shadow(ctx, a.x, a.y + 6, 20, 8);
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(Math.cos(a.facing) * lean * Math.cos(a.facing + Math.PI / 2));
      ctx.scale(1, sq);
      ctx.fillStyle = C.bear;
      ctx.beginPath();
      ctx.ellipse(0, -12, 20, 17, 0, 0, U.TAU);
      ctx.fill();
      ctx.fillStyle = C.bearDark;
      ctx.beginPath();
      ctx.arc(Math.cos(a.facing) * 13, -22, 10, 0, U.TAU);
      ctx.fill();
      ctx.restore();
      // 警觉感叹号
      if (a.alertMark > 0) {
        ctx.globalAlpha = U.clamp(a.alertMark, 0, 1);
        ctx.fillStyle = '#ffd45c';
        ctx.font = 'bold 34px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', a.x, a.y - 52);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }
    } else if (a.type === 'snake') {
      var st = a.strike;
      this.shadow(ctx, a.x, a.y + 3, 13, 5);
      ctx.save();
      ctx.translate(a.x, a.y);
      if (st > 0) ctx.rotate(0.26 * st);
      ctx.scale(1, sq);
      ctx.fillStyle = C.snake;
      ctx.beginPath();
      ctx.ellipse(0, -6 - st * 10, 13, 7 + st * 4, 0, 0, U.TAU);
      ctx.fill();
      ctx.fillStyle = C.snakeDark;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a.anim) * 5, -9 - st * 10, 5, 4, 0, 0, U.TAU);
      ctx.fill();
      ctx.restore();
    } else if (a.type === 'rabbit') {
      var hop = a.fleeing ? Math.abs(Math.sin(a.anim)) * 7 : Math.sin(a.anim * 0.6) * 1.2;
      this.shadow(ctx, a.x, a.y + 3, 11, 4.5);
      ctx.save();
      ctx.translate(a.x, a.y - hop);
      ctx.scale(1, sq);
      ctx.fillStyle = C.rabbit;
      ctx.beginPath();
      ctx.ellipse(0, -8, 11, 9, 0, 0, U.TAU);
      ctx.fill();
      ctx.fillStyle = C.rabbitDark;
      ctx.beginPath();
      ctx.arc(Math.cos(a.facing) * 7, -15, 5.5, 0, U.TAU);
      ctx.fill();
      // 耳朵
      ctx.strokeStyle = C.rabbit;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a.facing) * 7 - 3, -19);
      ctx.lineTo(Math.cos(a.facing) * 7 - 5, -28);
      ctx.moveTo(Math.cos(a.facing) * 7 + 3, -19);
      ctx.lineTo(Math.cos(a.facing) * 7 + 5, -28);
      ctx.stroke();
      ctx.restore();
    }
  };

  Renderer.prototype.drawResource = function (ctx, r) {
    var st = DF.Entities.RES_STYLE[r.res];
    var pop = r.collecting > 0 ? r.collecting : 0;
    var scale = 1 - pop * 0.8;
    var rise = pop * 18;
    var alpha = 1 - pop;
    this.shadow(ctx, r.x, r.y + 4, 8 * scale, 3 * scale);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(r.x, r.y - rise);
    ctx.scale(scale, scale);
    if (r.res === 'berry') {
      ctx.fillStyle = st.color;
      ctx.beginPath(); ctx.arc(0, -8, 7, 0, U.TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(-5, -5, 5, 0, U.TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(5, -5, 5, 0, U.TAU); ctx.fill();
      ctx.fillStyle = '#6a9e58';
      ctx.fillRect(-1.5, -18, 3, 6);
    } else if (r.res === 'gold') {
      ctx.fillStyle = st.glow;
      ctx.beginPath(); ctx.arc(0, -10, 13, 0, U.TAU); ctx.fill();
      ctx.fillStyle = st.color;
      ctx.beginPath(); ctx.arc(0, -10, 8, 0, U.TAU); ctx.fill();
    } else if (r.res === 'wood') {
      ctx.fillStyle = st.color;
      ctx.fillRect(-13, -12, 26, 10);
      ctx.fillStyle = st.glow;
      ctx.beginPath(); ctx.ellipse(13, -7, 3.5, 5, 0, 0, U.TAU); ctx.fill();
    } else if (r.res === 'herb') {
      ctx.fillStyle = st.color;
      for (var i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.ellipse(i * 6, -9, 5, 9, i * 0.4, 0, U.TAU);
        ctx.fill();
      }
    }
    ctx.restore();

    // 采集进度环
    if (pop > 0) {
      ctx.strokeStyle = 'rgba(255,240,200,.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y - 8, 18, -Math.PI / 2, -Math.PI / 2 + pop * U.TAU);
      ctx.stroke();
    }
  };

  Renderer.prototype.drawFire = function (ctx, f) {
    var sq = P.map.squashY;
    this.shadow(ctx, f.x, f.y + 4, 18, 7);
    ctx.fillStyle = C.log;
    ctx.fillRect(f.x - 16, f.y - 10, 32, 9);
    ctx.save();
    ctx.translate(f.x, f.y - 8);
    ctx.scale(1, sq);
    if (f.lit) {
      var f1 = f.flicker || 1;
      var h1 = 26 * f1, h2 = 18 * (1.4 - f1 * 0.4);
      ctx.fillStyle = C.fire;
      ctx.beginPath();
      ctx.moveTo(-11, 0);
      ctx.quadraticCurveTo(-12, -h1 * 0.6, 0, -h1);
      ctx.quadraticCurveTo(12, -h1 * 0.6, 11, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = C.fireCore;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.quadraticCurveTo(-7, -h2 * 0.6, 0, -h2);
      ctx.quadraticCurveTo(7, -h2 * 0.6, 6, 0);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(120,120,110,.5)';
      ctx.beginPath(); ctx.ellipse(0, -2, 10, 4, 0, 0, U.TAU); ctx.fill();
    }
    ctx.restore();
  };

  /* ── 夜间视野遮罩：圆形 320 像素，边缘 40 像素羽化，视野外亮度 25% ── */
  Renderer.prototype.drawNightMask = function (ctx, game) {
    var mc = this.maskCtx;
    var R = P.dayNight.nightVision;
    var F = P.dayNight.visionFeather;
    var dark = 1 - P.dayNight.outsideBrightness;   // 需要压暗到 25%
    var level = game.level, cam = game.camera;

    mc.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    mc.clearRect(0, 0, this.w, this.h);
    mc.fillStyle = 'rgba(6,14,20,' + dark.toFixed(3) + ')';
    mc.fillRect(0, 0, this.w, this.h);

    // 挖出玩家周围的视野
    var px = this.ox + (P.BASE_W / 2 + (level.player.x - cam.x)) * this.scale;
    var py = this.oy + (P.BASE_H / 2 + (level.player.y - cam.y)) * this.scale;
    var rr = R * this.scale;
    mc.globalCompositeOperation = 'destination-out';
    var g = mc.createRadialGradient(px, py, rr * (1 - F / R), px, py, rr);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    mc.fillStyle = g;
    mc.beginPath(); mc.arc(px, py, rr, 0, U.TAU); mc.fill();
    mc.globalCompositeOperation = 'source-over';

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.mask, 0, 0);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
  };

  /* ── 教学引导箭头（第一关） ── */
  Renderer.prototype.drawGuide = function (ctx, level) {
    var target = null, bd = Infinity;
    for (var i = 0; i < level.resources.length; i++) {
      var r = level.resources[i];
      if (!r.alive || r.res !== 'berry') continue;
      var d = U.dist2(level.player.x, level.player.y, r.x, r.y);
      if (d < bd) { bd = d; target = r; }
    }
    if (!target) return;
    var ang = Math.atan2(target.y - level.player.y, target.x - level.player.x);
    var pulse = (Math.sin(this.time * 4) + 1) / 2;
    var dist = 70 + pulse * 12;
    ctx.save();
    ctx.translate(level.player.x + Math.cos(ang) * dist, level.player.y + Math.sin(ang) * dist);
    ctx.rotate(ang);
    ctx.globalAlpha = 0.55 + pulse * 0.4;
    ctx.fillStyle = '#ffe6a8';
    ctx.beginPath();
    ctx.moveTo(16, 0); ctx.lineTo(-10, -12); ctx.lineTo(-4, 0); ctx.lineTo(-10, 12);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  };

  DF.Renderer = Renderer;
  DF.RenderColors = C;
  if (typeof module !== 'undefined' && module.exports) { module.exports = Renderer; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));