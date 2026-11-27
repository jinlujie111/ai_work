/* 拼车狂飙 · 2.5D 渲染（车宽随拼装变化） */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ox = 0;
    this.oy = 0;
    this.scale = 1;
    this.pixelRatio = 1;
    this.time = 0;
  }

  Renderer.prototype.resize = function () {
    var vp = LY.Util.getViewport(this.canvas);
    var bw = LY.Params.BASE_W;
    var bh = LY.Params.BASE_H;
    var s = Math.min(vp.w / bw, vp.h / bh);
    this.scale = s;
    this.ox = (vp.w - bw * s) / 2;
    this.oy = (vp.h - bh * s) / 2;
    this.pixelRatio = vp.ratio || 1;
    if (LY.Util.isMiniGame()) {
      this.canvas.width = Math.floor(vp.w * this.pixelRatio);
      this.canvas.height = Math.floor(vp.h * this.pixelRatio);
    } else {
      this.canvas.width = bw;
      this.canvas.height = bh;
      this.canvas.style.width = Math.floor(bw * s) + 'px';
      this.canvas.style.height = Math.floor(bh * s) + 'px';
    }
  };

  Renderer.prototype.begin = function () {
    var ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (LY.Util.isMiniGame()) {
      ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      ctx.translate(this.ox, this.oy);
      ctx.scale(this.scale, this.scale);
    }
  };

  Renderer.prototype.drawWorld = function (state, dt) {
    this.time += dt || 0.016;
    var ctx = this.ctx;
    var P = LY.Params;
    var W = P.BASE_W;
    var H = P.BASE_H;
    var proj = LY.Project.project;

    var sky = ctx.createLinearGradient(0, 0, 0, P.horizonY + 40);
    sky.addColorStop(0, '#1b2a44');
    sky.addColorStop(0.55, '#3d5a7a');
    sky.addColorStop(1, '#8fb3c9');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, P.horizonY + 8);

    ctx.fillStyle = '#2a3d4f';
    ctx.beginPath();
    ctx.moveTo(0, P.horizonY);
    for (var hx = 0; hx <= W; hx += 40) {
      ctx.lineTo(hx, P.horizonY - 18 - Math.sin(hx * 0.01 + 1.2) * 22);
    }
    ctx.lineTo(W, P.horizonY);
    ctx.closePath();
    ctx.fill();

    var seg = P.segLength;
    var scroll = state.scroll || 0;
    for (var z = P.viewDepth; z >= 0; z -= seg) {
      var z2 = Math.max(0, z - seg);
      var a = proj(0, z);
      var b = proj(0, z2);
      var rumble = Math.floor((z + scroll) / seg) % 2;

      ctx.fillStyle = rumble ? '#2f5a3c' : '#274e34';
      ctx.beginPath();
      ctx.moveTo(0, a.y);
      ctx.lineTo(a.x - a.roadHalf - 90 * a.scale / a.scale0, a.y);
      ctx.lineTo(b.x - b.roadHalf - 90 * b.scale / b.scale0, b.y);
      ctx.lineTo(0, b.y);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(W, a.y);
      ctx.lineTo(a.x + a.roadHalf + 90 * a.scale / a.scale0, a.y);
      ctx.lineTo(b.x + b.roadHalf + 90 * b.scale / b.scale0, b.y);
      ctx.lineTo(W, b.y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = rumble ? '#c45c26' : '#e8e8e8';
      ctx.beginPath();
      ctx.moveTo(a.x - a.roadHalf - 18 * a.scale / a.scale0, a.y);
      ctx.lineTo(a.x - a.roadHalf, a.y);
      ctx.lineTo(b.x - b.roadHalf, b.y);
      ctx.lineTo(b.x - b.roadHalf - 18 * b.scale / b.scale0, b.y);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(a.x + a.roadHalf, a.y);
      ctx.lineTo(a.x + a.roadHalf + 18 * a.scale / a.scale0, a.y);
      ctx.lineTo(b.x + b.roadHalf + 18 * b.scale / b.scale0, b.y);
      ctx.lineTo(b.x + b.roadHalf, b.y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = rumble ? '#3d4452' : '#454c5c';
      ctx.beginPath();
      ctx.moveTo(a.x - a.roadHalf, a.y);
      ctx.lineTo(a.x + a.roadHalf, a.y);
      ctx.lineTo(b.x + b.roadHalf, b.y);
      ctx.lineTo(b.x - b.roadHalf, b.y);
      ctx.closePath();
      ctx.fill();

      if (rumble) {
        var mid = (P.laneCount - 1) / 2;
        for (var li = 1; li < P.laneCount; li++) {
          var wx = (li - 0.5 - mid) * P.laneWorld;
          var pa = proj(wx, z);
          var pb = proj(wx, z2);
          ctx.strokeStyle = 'rgba(240,240,245,0.85)';
          ctx.lineWidth = Math.max(1.5, 5 * b.scale / b.scale0);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
      }
    }

    /* 窄路预告墙：接近检查点时画夹逼 */
    if (!state.checkpointDone && LY.Run.progressRatio(state) > 0.4) {
      var cz = 500;
      var ca = proj(0, cz);
      var maxW = state.level.checkpointMaxWidth || 1.2;
      var gap = ca.roadHalf * (0.55 / maxW);
      ctx.fillStyle = 'rgba(80,40,40,0.55)';
      ctx.fillRect(0, ca.y - 8, ca.x - gap, 16);
      ctx.fillRect(ca.x + gap, ca.y - 8, W - (ca.x + gap), 16);
    }

    var list = state.entities.slice().sort(function (u, v) { return v.z - u.z; });
    for (var i = 0; i < list.length; i++) this.drawEntity(ctx, list[i]);
    this.drawCar(ctx, state);
  };

  Renderer.prototype.drawEntity = function (ctx, ent) {
    var P = LY.Params;
    if (ent.z < -20 || ent.z > P.viewDepth + 40) return;
    var lane = ent.lane < 0 ? 1 : ent.lane;
    var wx = LY.Project.laneWorldX(lane);
    var p = LY.Project.project(wx, ent.z);
    var s = p.scale / p.scale0;
    var x = p.x;
    var y = p.y;

    oval(ctx, x, y + 6 * s, 30 * s, 9 * s, 'rgba(0,0,0,0.35)');

    if (ent.kind === 'absorb') {
      if (ent.teachTarget) {
        var pulse = 0.65 + 0.35 * Math.sin(this.time * 8);
        ctx.strokeStyle = 'rgba(255,230,80,' + pulse.toFixed(2) + ')';
        ctx.lineWidth = 5 * s;
        ctx.beginPath();
        ctx.arc(x, y - 18 * s, 42 * s * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffe566';
        ctx.font = 'bold ' + Math.max(14, Math.floor(22 * s)) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('撞我变强', x, y - 62 * s);
      }
      drawAbsorbGlow(ctx, x, y - 16 * s, 34 * s);
      drawPartGround(ctx, x, y, s, ent.partId);
    } else if (ent.kind === 'drop') {
      drawDropCrate(ctx, x, y, s, ent.itemLevel || 1);
    } else if (ent.kind === 'hazard') {
      if (ent.fatal) drawHazardFatal(ctx, x, y, s);
      else drawHazardSoft(ctx, x, y, s);
    } else if (ent.kind === 'wall') {
      /* 窄门由路面段绘制；实体上可略过 */
    }
  };

  Renderer.prototype.drawCar = function (ctx, state) {
    var P = LY.Params;
    var d = LY.Run.derived(state);
    var lane = state.laneSmooth != null ? state.laneSmooth : state.lane;
    var wx = LY.Project.laneWorldX(0, lane);
    var p = LY.Project.project(wx, P.carZ);
    var s = p.scale / p.scale0;
    var bob = Math.sin(this.time * 10) * 2 * s;
    var w = P.carDrawW * s * d.width;
    var h = P.carDrawH * s * d.length;
    var x = p.x;
    var y = p.y + bob;
    var body = state.vehicle.color || '#4cc9f0';
    var tier = state.vehicle.tier || state.vehicleTier || 1;

    oval(ctx, x, p.y + 8 * s, w * 0.48, 14 * s, 'rgba(0,0,0,0.4)');

    if (state.buff.iframe > 0) {
      ctx.strokeStyle = 'rgba(255,255,120,0.9)';
      ctx.lineWidth = 4;
      ctx.strokeRect(x - w / 2 - 6, y - h - 6, w + 12, h + 12);
    }
    if (state.fx && state.fx.absorbFlash > 0) {
      ctx.strokeStyle = 'rgba(80,220,120,' + Math.min(1, state.fx.absorbFlash * 2).toFixed(2) + ')';
      ctx.lineWidth = 6;
      ctx.strokeRect(x - w / 2 - 10, y - h - 10, w + 20, h + 20);
    }
    if (state.fx && state.fx.discardFlash > 0) {
      ctx.strokeStyle = 'rgba(255,140,60,' + Math.min(1, state.fx.discardFlash * 2).toFixed(2) + ')';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y - h * 0.5);
      ctx.lineTo(x + w / 2 + 40 * s, y - h);
      ctx.stroke();
    }

    if (tier <= 1) {
      drawBicycle(ctx, x, y, w, h, s, body);
    } else if (tier === 2) {
      drawEBike(ctx, x, y, w, h, s, body);
    } else if (tier === 3) {
      drawMotorcycle(ctx, x, y, w, h, s, body);
    } else {
      drawCarBody(ctx, x, y, w, h, s, body);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.max(12, Math.floor(18 * s)) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.vehicle.name[0] || '车', x, y - h * 0.35);
    }

    /* 挂接件：直接改外形，头顶只留小色点计数 */
    drawPartAttaches(ctx, x, y, w, h, s, state.tempParts);
    for (var i = 0; i < state.tempParts.length; i++) {
      var part = LY.Parts.get(state.tempParts[i]);
      ctx.fillStyle = (part && part.color) || '#fff';
      ctx.fillRect(x - w / 2 + i * 14 * s, y - h - 18 * s, 12 * s, 12 * s);
    }
  };

  /* —— 吸 / 障 / 掉：程序可读造型 —— */

  function drawAbsorbGlow(ctx, cx, cy, r) {
    ctx.strokeStyle = 'rgba(80, 220, 120, 0.85)';
    ctx.lineWidth = Math.max(2, r * 0.08);
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawPartGround(ctx, x, y, s, partId) {
    var id = partId || 'bumper';
    if (id === 'wide_tire') {
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(x - 16 * s, y - 14 * s, 14 * s, 0, Math.PI * 2);
      ctx.arc(x + 16 * s, y - 14 * s, 14 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#52525b';
      ctx.beginPath();
      ctx.arc(x - 16 * s, y - 14 * s, 7 * s, 0, Math.PI * 2);
      ctx.arc(x + 16 * s, y - 14 * s, 7 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a3e635';
      ctx.font = 'bold ' + Math.max(10, Math.floor(12 * s)) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('宽胎', x, y - 36 * s);
    } else if (id === 'crate') {
      ctx.fillStyle = '#c4a574';
      ctx.fillRect(x - 22 * s, y - 36 * s, 44 * s, 32 * s);
      ctx.strokeStyle = '#5c4030';
      ctx.lineWidth = Math.max(2, 2.5 * s);
      ctx.strokeRect(x - 22 * s, y - 36 * s, 44 * s, 32 * s);
      ctx.beginPath();
      ctx.moveTo(x, y - 36 * s);
      ctx.lineTo(x, y - 4 * s);
      ctx.moveTo(x - 22 * s, y - 20 * s);
      ctx.lineTo(x + 22 * s, y - 20 * s);
      ctx.stroke();
      ctx.fillStyle = '#a3e635';
      ctx.font = 'bold ' + Math.max(10, Math.floor(12 * s)) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('货箱', x, y - 42 * s);
    } else {
      /* bumper 防撞杠 */
      ctx.fillStyle = '#9aa0a6';
      ctx.fillRect(x - 28 * s, y - 18 * s, 56 * s, 12 * s);
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(x - 30 * s, y - 22 * s, 8 * s, 18 * s);
      ctx.fillRect(x + 22 * s, y - 22 * s, 8 * s, 18 * s);
      ctx.fillStyle = '#d1d5db';
      ctx.beginPath();
      ctx.arc(x - 12 * s, y - 12 * s, 3 * s, 0, Math.PI * 2);
      ctx.arc(x + 12 * s, y - 12 * s, 3 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a3e635';
      ctx.font = 'bold ' + Math.max(10, Math.floor(12 * s)) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('防撞杠', x, y - 32 * s);
    }
  }

  function drawHazardSoft(ctx, x, y, s) {
    /* 交通锥：非致命 */
    ctx.fillStyle = '#ea580c';
    ctx.beginPath();
    ctx.moveTo(x, y - 48 * s);
    ctx.lineTo(x + 18 * s, y - 4 * s);
    ctx.lineTo(x - 18 * s, y - 4 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x - 10 * s, y - 28 * s, 20 * s, 7 * s);
    ctx.fillRect(x - 7 * s, y - 16 * s, 14 * s, 6 * s);
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(x - 22 * s, y - 6 * s, 44 * s, 6 * s);
  }

  function drawHazardFatal(ctx, x, y, s) {
    /* 断坑 + 警示条：致命 */
    ctx.fillStyle = '#0c0a09';
    ctx.beginPath();
    ctx.moveTo(x - 36 * s, y - 4 * s);
    ctx.quadraticCurveTo(x, y + 10 * s, x + 36 * s, y - 4 * s);
    ctx.lineTo(x + 28 * s, y - 22 * s);
    ctx.quadraticCurveTo(x, y - 8 * s, x - 28 * s, y - 22 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(x - 34 * s, y - 28 * s, 20 * s, 8 * s);
    ctx.fillRect(x - 8 * s, y - 28 * s, 20 * s, 8 * s);
    ctx.fillRect(x + 18 * s, y - 28 * s, 16 * s, 8 * s);
    ctx.fillStyle = '#111';
    ctx.fillRect(x - 24 * s, y - 28 * s, 8 * s, 8 * s);
    ctx.fillRect(x + 2 * s, y - 28 * s, 8 * s, 8 * s);
    ctx.fillStyle = '#fecaca';
    ctx.font = 'bold ' + Math.max(11, Math.floor(14 * s)) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('深坑', x, y - 36 * s);
  }

  function drawDropCrate(ctx, x, y, s, level) {
    var rarity = level <= 2 ? '#94a3b8' : level <= 5 ? '#38bdf8' : level <= 10 ? '#a78bfa' : '#fbbf24';
    ctx.fillStyle = '#92400e';
    ctx.fillRect(x - 20 * s, y - 34 * s, 40 * s, 30 * s);
    ctx.fillStyle = '#b45309';
    ctx.beginPath();
    ctx.moveTo(x - 20 * s, y - 34 * s);
    ctx.lineTo(x - 12 * s, y - 44 * s);
    ctx.lineTo(x + 28 * s, y - 44 * s);
    ctx.lineTo(x + 20 * s, y - 34 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#78350f';
    ctx.beginPath();
    ctx.moveTo(x + 20 * s, y - 34 * s);
    ctx.lineTo(x + 28 * s, y - 44 * s);
    ctx.lineTo(x + 28 * s, y - 14 * s);
    ctx.lineTo(x + 20 * s, y - 4 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rarity;
    ctx.lineWidth = Math.max(2.5, 3.5 * s);
    ctx.strokeRect(x - 20 * s, y - 34 * s, 40 * s, 30 * s);
    ctx.fillStyle = '#44403c';
    ctx.fillRect(x - 6 * s, y - 24 * s, 12 * s, 10 * s);
    ctx.fillStyle = rarity;
    ctx.font = 'bold ' + Math.max(11, Math.floor(15 * s)) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Lv' + level, x, y - 48 * s);
  }

  function drawPartAttaches(ctx, x, y, w, h, s, tempParts) {
    var counts = {};
    var i;
    for (i = 0; i < (tempParts || []).length; i++) {
      counts[tempParts[i]] = (counts[tempParts[i]] || 0) + 1;
    }
    if (counts.wide_tire) {
      var tw = w * 0.22 * counts.wide_tire;
      ctx.fillStyle = '#18181b';
      ctx.beginPath();
      ctx.arc(x - w / 2 - tw * 0.2, y - h * 0.15, 10 * s + tw * 0.15, 0, Math.PI * 2);
      ctx.arc(x + w / 2 + tw * 0.2, y - h * 0.15, 10 * s + tw * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
    if (counts.crate) {
      var ch = 16 * s * counts.crate;
      ctx.fillStyle = '#c4a574';
      ctx.fillRect(x - w * 0.22, y - h - ch, w * 0.44, ch);
      ctx.strokeStyle = '#5c4030';
      ctx.lineWidth = 2 * s;
      ctx.strokeRect(x - w * 0.22, y - h - ch, w * 0.44, ch);
    }
    if (counts.bumper) {
      ctx.fillStyle = '#9aa0a6';
      ctx.fillRect(x - w * 0.55, y - h * 0.2, w * 1.1, 8 * s);
    }
  }

  function drawCarBody(ctx, x, y, w, h, s, body) {
    ctx.fillStyle = body;
    ctx.fillRect(x - w / 2, y - h * 0.55, w, h * 0.55);
    ctx.fillStyle = shade(body, -30);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - h * 0.55);
    ctx.lineTo(x - w / 2 + 12 * s, y - h);
    ctx.lineTo(x + w / 2 - 12 * s, y - h);
    ctx.lineTo(x + w / 2, y - h * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(20,30,50,0.85)';
    ctx.fillRect(x - w * 0.28, y - h * 0.88, w * 0.56, h * 0.28);
  }

  /* 侧视自行车：双轮 + 菱形车架 + 车把/座垫/骑手，开局一眼能认 */
  function drawBicycle(ctx, x, y, w, h, s, color) {
    var L = Math.max(w * 1.15, 56 * s);
    var wheelR = Math.max(10 * s, h * 0.28);
    var ground = y - 2 * s;
    var rearX = x - L * 0.38;
    var frontX = x + L * 0.38;
    var hubY = ground - wheelR;
    var pedalX = (rearX + frontX) * 0.5;
    var pedalY = hubY;
    var seatX = rearX + wheelR * 0.55;
    var seatY = hubY - wheelR * 1.55;
    var headX = frontX - wheelR * 0.35;
    var headY = hubY - wheelR * 1.7;

    drawWheel(ctx, rearX, hubY, wheelR, s);
    drawWheel(ctx, frontX, hubY, wheelR, s);

    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, 4.5 * s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rearX, hubY);
    ctx.lineTo(seatX, seatY);
    ctx.lineTo(headX, headY);
    ctx.lineTo(pedalX, pedalY);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(seatX, seatY);
    ctx.lineTo(pedalX, pedalY);
    ctx.lineTo(rearX, hubY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(headX, headY);
    ctx.lineTo(frontX, hubY);
    ctx.stroke();

    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(seatX - 11 * s, seatY - 5 * s, 20 * s, 7 * s);

    ctx.strokeStyle = '#222';
    ctx.lineWidth = Math.max(2.5, 3.5 * s);
    ctx.beginPath();
    ctx.moveTo(headX, headY);
    ctx.lineTo(headX, headY - 10 * s);
    ctx.moveTo(headX - 16 * s, headY - 10 * s);
    ctx.lineTo(headX + 16 * s, headY - 10 * s);
    ctx.stroke();

    ctx.strokeStyle = '#333';
    ctx.lineWidth = Math.max(2, 2.5 * s);
    ctx.beginPath();
    ctx.arc(pedalX, pedalY, 5 * s, 0, Math.PI * 2);
    ctx.moveTo(pedalX - 10 * s, pedalY + 8 * s);
    ctx.lineTo(pedalX + 10 * s, pedalY - 8 * s);
    ctx.stroke();

    /* 骑手剪影 */
    ctx.fillStyle = '#2a3d36';
    oval(ctx, seatX + 4 * s, seatY - 22 * s, 9 * s, 14 * s, '#2a3d36');
    ctx.beginPath();
    ctx.arc(seatX + 10 * s, seatY - 40 * s, 8 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a3d36';
    ctx.lineWidth = Math.max(3, 4 * s);
    ctx.beginPath();
    ctx.moveTo(seatX + 2 * s, seatY - 18 * s);
    ctx.lineTo(pedalX + 4 * s, pedalY + 4 * s);
    ctx.moveTo(seatX + 8 * s, seatY - 28 * s);
    ctx.lineTo(headX - 2 * s, headY - 8 * s);
    ctx.stroke();
  }

  function drawEBike(ctx, x, y, w, h, s, color) {
    drawBicycle(ctx, x, y, w, h, s, color);
    var L = Math.max(w * 1.15, 56 * s);
    var hubY = y - 2 * s - Math.max(10 * s, h * 0.28);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x - 14 * s, hubY - 8 * s, 28 * s, 12 * s);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(x - 10 * s, hubY - 4 * s, 8 * s, 4 * s);
  }

  function drawMotorcycle(ctx, x, y, w, h, s, color) {
    var L = Math.max(w * 1.1, 52 * s);
    var wheelR = Math.max(9 * s, h * 0.24);
    var ground = y - 2 * s;
    var rearX = x - L * 0.36;
    var frontX = x + L * 0.36;
    var hubY = ground - wheelR;
    drawWheel(ctx, rearX, hubY, wheelR, s);
    drawWheel(ctx, frontX, hubY, wheelR * 0.95, s);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(rearX + 4 * s, hubY - wheelR * 0.3);
    ctx.lineTo(x - 4 * s, hubY - wheelR * 1.4);
    ctx.lineTo(frontX - 6 * s, hubY - wheelR * 1.1);
    ctx.lineTo(frontX - 2 * s, hubY - wheelR * 0.2);
    ctx.lineTo(x + 6 * s, hubY + 4 * s);
    ctx.lineTo(rearX + 8 * s, hubY + 4 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(x - 18 * s, hubY - wheelR * 1.55, 22 * s, 8 * s);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = Math.max(2.5, 3.5 * s);
    ctx.beginPath();
    ctx.moveTo(frontX - 8 * s, hubY - wheelR * 1.15);
    ctx.lineTo(frontX - 4 * s, hubY - wheelR * 1.85);
    ctx.moveTo(frontX - 18 * s, hubY - wheelR * 1.85);
    ctx.lineTo(frontX + 6 * s, hubY - wheelR * 1.85);
    ctx.stroke();
    ctx.fillStyle = '#2a3d36';
    ctx.beginPath();
    ctx.arc(x - 2 * s, hubY - wheelR * 2.15, 7 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWheel(ctx, cx, cy, r, s) {
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d4d4d8';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#52525b';
    ctx.lineWidth = Math.max(1, 1.5 * s);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.45, cy);
    ctx.lineTo(cx + r * 0.45, cy);
    ctx.moveTo(cx, cy - r * 0.45);
    ctx.lineTo(cx, cy + r * 0.45);
    ctx.stroke();
    ctx.fillStyle = '#27272a';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }

  function shade(hex, delta) {
    /* 极简：直接加深用固定色 */
    return delta < 0 ? 'rgba(0,0,0,0.25)' : hex;
  }

  function oval(ctx, x, y, rx, ry, fill) {
    ctx.fillStyle = fill || 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.restore();
    ctx.fill();
  }

  LY.Renderer = Renderer;
  if (typeof module !== 'undefined' && module.exports) module.exports = LY.Renderer;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
