/* 自动生成，请勿手改：node test/bundle-minigame.js */
(function () {
var __mods = {}, __cache = {};
function __resolve(base, rel) {
  if (rel.charAt(0) !== ".") return rel.replace(/\.js$/, "");
  var dir = base.split("/"); dir.pop();
  var segs = rel.split("/");
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i];
    if (s === "." || s === "") continue;
    if (s === "..") dir.pop(); else dir.push(s);
  }
  return dir.join("/");
}
function __req(rel, from) {
  var name = __resolve(from || "", rel).replace(/\.js$/, "");
  if (__cache[name]) return __cache[name].exports;
  var m = __cache[name] = { exports: {} };
  __mods[name](m, m.exports, function (r) { return __req(r, name); });
  return m.exports;
}
__mods["src/util"] = function (module, exports, require) {
/* 深林 · Deep Forest — 基础工具：数学、随机、噪声、事件总线 */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};
  var U = DF.Util = {};

  U.TAU = Math.PI * 2;
  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.smoothstep = function (t) { return t * t * (3 - 2 * t); };
  U.easeOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
  U.easeOutBack = function (t) { var c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  U.dist = function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); };
  U.dist2 = function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  U.angleDiff = function (a, b) { var d = (b - a) % U.TAU; if (d > Math.PI) d -= U.TAU; if (d < -Math.PI) d += U.TAU; return d; };
  U.lerpAngle = function (a, b, t) { return a + U.angleDiff(a, b) * t; };
  U.fmtTime = function (sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };

  /* ── 可播种随机数 (mulberry32) ───────────────────────── */
  U.rng = function (seed) {
    var a = seed >>> 0;
    function r() {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    r.range = function (lo, hi) { return lo + r() * (hi - lo); };
    r.int = function (lo, hi) { return Math.floor(lo + r() * (hi - lo + 1)); };
    r.pick = function (arr) { return arr[Math.floor(r() * arr.length)]; };
    r.chance = function (p) { return r() < p; };
    r.shuffle = function (arr) {
      for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
      return arr;
    };
    return r;
  };

  /* ── 值噪声 / fbm ──────────────────────────────────── */
  function hash2(x, y, seed) {
    var h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
    h = (h ^ (h >>> 13));
    h = Math.imul(h, 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  U.hash2 = hash2;
  U.noise2 = function (x, y, seed) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var u = U.smoothstep(x - xi), v = U.smoothstep(y - yi);
    var a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
    var c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return U.lerp(U.lerp(a, b, u), U.lerp(c, d, u), v);
  };
  U.fbm = function (x, y, seed, oct, lac, gain) {
    oct = oct || 3; lac = lac || 2; gain = gain || 0.5;
    var amp = 1, freq = 1, sum = 0, norm = 0;
    for (var i = 0; i < oct; i++) {
      sum += amp * U.noise2(x * freq, y * freq, seed + i * 1013);
      norm += amp; amp *= gain; freq *= lac;
    }
    return sum / norm;
  };

  /* ── 极简事件总线（HUD 由事件驱动，而非每帧轮询） ───── */
  U.emitter = function () {
    var map = {};
    return {
      on: function (k, fn) { (map[k] || (map[k] = [])).push(fn); return fn; },
      off: function (k, fn) { if (!map[k]) return; map[k] = map[k].filter(function (f) { return f !== fn; }); },
      emit: function (k, payload) { var l = map[k]; if (!l) return; for (var i = 0; i < l.length; i++) { try { l[i](payload); } catch (e) { if (global.console) console.error(e); } } }
    };
  };

  /* ── 平台适配层 ─────────────────────────────────────
     Web 与微信小游戏共用同一套逻辑，这些钩子由各端注入。 */
  U.isMiniGame = function () {
    return !!(global.wx && typeof global.wx.createCanvas === 'function');
  };

  U.createCanvas = function (w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    return c;
  };

  U.makeCanvas = U.createCanvas;   // 兼容别名

  U.createAudioContext = function () {
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try { return new AC(); } catch (e) { return null; }
  };

  U.storage = {
    get: function (k, d) {
      try { var v = global.localStorage.getItem(k); return (v === null || v === undefined) ? d : v; }
      catch (e) { return d; }
    },
    set: function (k, v) { try { global.localStorage.setItem(k, v); } catch (e) {} }
  };

  U.now = function () {
    if (global.performance && global.performance.now) return global.performance.now();
    if (global.wx && global.wx.getPerformance) {
      try { return global.wx.getPerformance().now(); } catch (e) {}
    }
    return Date.now();
  };

  U.raf = function (cb) {
    if (typeof global.requestAnimationFrame === 'function') return global.requestAnimationFrame(cb);
    return global.setTimeout(function () { cb(U.now()); }, 16);
  };

  /* 画布尺寸信息：Web 用 DOM，小游戏用 wx */
  U.getViewport = function (canvas) {
    if (U.isMiniGame()) {
      var info = null;
      try { info = global.wx.getWindowInfo ? global.wx.getWindowInfo() : global.wx.getSystemInfoSync(); }
      catch (e) { info = { windowWidth: 390, windowHeight: 844, pixelRatio: 2 }; }
      return {
        w: info.windowWidth, h: info.windowHeight,
        ratio: Math.min(2, info.pixelRatio || 2)
      };
    }
    var rect = canvas.getBoundingClientRect();
    return {
      w: Math.max(240, Math.round(rect.width || 390)),
      h: Math.max(320, Math.round(rect.height || 844)),
      ratio: Math.min(2, global.devicePixelRatio || 1)
    };
  };

  U.pad = function (n, len) { var s = String(n); while (s.length < len) s = '0' + s; return s; };
  if (typeof module !== 'undefined' && module.exports) { module.exports = DF.Util; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
};
__mods["src/audio"] = function (module, exports, require) {
/* 深林 · Deep Forest — 纯合成音效（无外部音频资源） */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};
  var U = DF.Util;
  var A = DF.Audio = {
    ctx: null, master: null, sfxGain: null, ambGain: null,
    muted: false, ready: false, _noise: null, _night: false, _cricketGain: null
  };

  A.init = function () {
    if (this.ready) { this.resume(); return; }
    var ctx = U.createAudioContext();
    if (!ctx) return;
    this.ctx = ctx;
    var ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ctx.destination);

    this.sfxGain = ctx.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master);
    this.ambGain = ctx.createGain(); this.ambGain.gain.value = 0.0; this.ambGain.connect(this.master);

    this._noise = this._makeNoise(2.2);
    this.ready = true;
    if (this._noise) this._startAmbient();
    this.resume();
  };

  A.resume = function () { if (this.ctx && this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} } };
  A.setMuted = function (m) {
    this.muted = !!m;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
  };
  A.toggle = function () { this.setMuted(!this.muted); return this.muted; };

  A._makeNoise = function (sec) {
    try {
      var ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0), last = 0;
      for (var i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;      // 偏棕噪，听感更自然
        d[i] = last * 3.2;
      }
      return buf;
    } catch (e) { this._noNoise = true; return null; }
  };

  /* ── 环境层：风声 + 夜虫 ───────────────────────────── */
  A._startAmbient = function () {
    var ctx = this.ctx;
    var src = ctx.createBufferSource();
    src.buffer = this._noise; src.loop = true;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.6;
    var g = ctx.createGain(); g.gain.value = 0.5;
    // 缓慢起伏的风
    var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
    var lfoGain = ctx.createGain(); lfoGain.gain.value = 220;
    lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
    src.connect(lp); lp.connect(g); g.connect(this.ambGain);
    src.start(); lfo.start();
    this.ambGain.gain.setTargetAtTime(0.18, ctx.currentTime, 2.5);

    // 夜虫
    var cg = ctx.createGain(); cg.gain.value = 0; cg.connect(this.ambGain);
    for (var i = 0; i < 2; i++) {
      var o = ctx.createOscillator(); o.type = 'square';
      o.frequency.value = 3900 + i * 420;
      var og = ctx.createGain(); og.gain.value = 0.012;
      var trem = ctx.createOscillator(); trem.type = 'sine'; trem.frequency.value = 7 + i * 3.5;
      var tg = ctx.createGain(); tg.gain.value = 0.010;
      trem.connect(tg); tg.connect(og.gain);
      o.connect(og); og.connect(cg);
      o.start(); trem.start();
    }
    this._cricketGain = cg;
  };

  A.setNight = function (isNight) {
    if (!this.ready || this._night === isNight) return;
    this._night = isNight;
    this._cricketGain.gain.setTargetAtTime(isNight ? 1 : 0, this.ctx.currentTime, 1.2);
  };

  /* ── 基础发声单元 ─────────────────────────────────── */
  A._tone = function (o) {
    if (!this.ready) return;
    var ctx = this.ctx, t = ctx.currentTime + (o.delay || 0);
    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + Math.min(0.02, o.dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(t); osc.stop(t + o.dur + 0.02);
  };

  A._noiseHit = function (o) {
    if (!this.ready || !this._noise) return;
    var ctx = this.ctx, t = ctx.currentTime + (o.delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.playbackRate.value = o.rate || 1;
    var f = ctx.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 900, t);
    if (o.freqTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.freqTo), t + o.dur);
    f.Q.value = o.q || 1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(t, Math.random() * 1.5); src.stop(t + o.dur + 0.02);
  };

  /* ── 具体音效 ─────────────────────────────────────── */
  A.step = function () {
    this._noiseHit({ dur: 0.11, freq: 420, freqTo: 180, gain: 0.05, filter: 'lowpass' });
  };
  A.pickup = function () {
    this._tone({ freq: 520, to: 790, dur: 0.11, gain: 0.1, type: 'triangle' });
    this._tone({ freq: 1040, dur: 0.07, gain: 0.035, type: 'sine', delay: 0.05 });
  };
  A.relic = function () {
    var n = [523, 659, 784, 1046];
    for (var i = 0; i < n.length; i++) this._tone({ freq: n[i], dur: 0.42, gain: 0.1, type: 'triangle', delay: i * 0.085 });
  };
  A.hurt = function () {
    this._tone({ freq: 190, to: 70, dur: 0.28, gain: 0.14, type: 'square' });
    this._noiseHit({ dur: 0.22, freq: 1200, freqTo: 240, gain: 0.1 });
  };
  A.growl = function () {
    this._tone({ freq: 96, to: 62, dur: 0.55, gain: 0.075, type: 'sawtooth' });
    this._noiseHit({ dur: 0.5, freq: 320, freqTo: 150, gain: 0.05 });
  };
  A.fire = function () {
    this._noiseHit({ dur: 0.7, freq: 300, freqTo: 2200, gain: 0.11, filter: 'bandpass', q: 0.9 });
    this._tone({ freq: 150, to: 90, dur: 0.4, gain: 0.06, type: 'sine' });
  };
  A.swing = function () {
    this._noiseHit({ dur: 0.22, freq: 2600, freqTo: 500, gain: 0.08, filter: 'bandpass', q: 1.4 });
  };
  A.eat = function () {
    this._tone({ freq: 300, to: 420, dur: 0.14, gain: 0.07, type: 'sine' });
  };
  A.click = function () {
    this._tone({ freq: 880, dur: 0.05, gain: 0.05, type: 'triangle' });
  };
  A.deny = function () {
    this._tone({ freq: 220, to: 160, dur: 0.18, gain: 0.07, type: 'sawtooth' });
  };
  A.win = function () {
    var n = [392, 523, 659, 784, 1046];
    for (var i = 0; i < n.length; i++) this._tone({ freq: n[i], dur: 0.9, gain: 0.1, type: 'triangle', delay: i * 0.13 });
  };
  /* ── 森林求生专用音效（spec 第八章） ── */
  A._collectPitch = 0;
  A.collect = function (score) {
    // 音高随连采递增
    this._collectPitch = Math.min(12, this._collectPitch + 1);
    var base = 620 + this._collectPitch * 28 + (score >= 3 ? 160 : 0);
    this._tone({ freq: base, to: base * 1.5, dur: 0.1, gain: 0.11, type: 'triangle' });
  };
  A.catchRabbit = function () {
    this._tone({ freq: 380, to: 720, dur: 0.14, gain: 0.1, type: 'square' });
  };
  A.bearAlert = function () {
    this._tone({ freq: 130, to: 84, dur: 0.45, gain: 0.11, type: 'sawtooth' });
    this._noiseHit({ dur: 0.3, freq: 300, freqTo: 140, gain: 0.05 });
  };
  A.bearStep = function () {
    this._noiseHit({ dur: 0.13, freq: 260, freqTo: 110, gain: 0.07 });
  };
  A.snakeHiss = function () {
    this._noiseHit({ dur: 0.42, freq: 5200, freqTo: 2600, gain: 0.07, filter: 'bandpass', q: 2.2 });
  };
  A.nightFall = function () {
    this._tone({ freq: 300, to: 72, dur: 1.1, gain: 0.11, type: 'sine' });
  };
  A.dawn = function () {
    var n = [392, 523, 659];
    for (var i = 0; i < n.length; i++) this._tone({ freq: n[i], dur: 0.55, gain: 0.09, type: 'triangle', delay: i * 0.11 });
  };
  A.decoy = function () {
    this._tone({ freq: 880, to: 1320, dur: 0.16, gain: 0.07, type: 'sine' });
  };
  A.lose = function () {
    var n = [330, 262, 208, 165];
    for (var i = 0; i < n.length; i++) this._tone({ freq: n[i], dur: 1.1, gain: 0.1, type: 'sine', delay: i * 0.19 });
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = DF.Audio; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
};
__mods["src/input"] = function (module, exports, require) {
/* 森林求生｜输入
   5.2：屏幕任意位置按下，角色朝手指位置移动，最大偏移 120 像素，松手停下。
   桌面端另提供 WASD 作为等价输入。 */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};
  var U = DF.Util;
  var I = DF.Input = {
    keys: {},
    drag: { active: false, id: null, x: 0, y: 0, sx: 0, sy: 0 },
    axis: { x: 0, y: 0 },
    stageW: 390, stageH: 844,
    tx: null,
    _action: false, _pause: false
  };

  var MOVE_KEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0]
  };

  /* 屏幕 → 设计坐标（750×1334 基准，letterbox 居中） */
  I.setTransform = function (ox, oy, scale) { I.tx = { ox: ox, oy: oy, scale: scale }; };
  I.toDesign = function (sx, sy) {
    if (!I.tx || !I.tx.scale) return { x: sx, y: sy };
    return { x: (sx - I.tx.ox) / I.tx.scale, y: (sy - I.tx.oy) / I.tx.scale };
  };

  /* ── Web：绑定 DOM ──────────────────────────────── */
  I.attach = function (stage) {
    I.stage = stage;
    global.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      I.keys[e.code] = true;
      if (MOVE_KEYS[e.code]) e.preventDefault();
      if (e.code === 'Escape' || e.code === 'KeyP') I._pause = true;
    }, { passive: false });
    global.addEventListener('keyup', function (e) { I.keys[e.code] = false; });
    global.addEventListener('blur', function () {
      I.keys = {}; I.drag.active = false; I.axis.x = I.axis.y = 0;
    });

    stage.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('button,.no-drag')) return;
      var p = I._local(e);
      I.pointerDown(e.pointerId, p.x, p.y);
      e.preventDefault();
    }, { passive: false });

    stage.addEventListener('pointermove', function (e) {
      if (!I.drag.active || e.pointerId !== I.drag.id) return;
      var p = I._local(e);
      I.pointerMove(e.pointerId, p.x, p.y);
      e.preventDefault();
    }, { passive: false });

    stage.addEventListener('pointerup', function (e) { I.pointerUp(e.pointerId); });
    stage.addEventListener('pointercancel', function (e) { I.pointerUp(e.pointerId); });
    stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };

  I._local = function (e) {
    var r = I.stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /* ── 指针原语（Web 与小游戏通用，屏幕坐标） ────── */
  I.pointerDown = function (id, sx, sy) {
    I.drag.active = true;
    I.drag.id = id;
    I.drag.sx = sx; I.drag.sy = sy;
    var d = I.toDesign(sx, sy);
    I.drag.x = d.x; I.drag.y = d.y;
  };
  I.pointerMove = function (id, sx, sy) {
    if (!I.drag.active || id !== I.drag.id) return;
    I.drag.sx = sx; I.drag.sy = sy;
    var d = I.toDesign(sx, sy);
    I.drag.x = d.x; I.drag.y = d.y;
  };
  I.pointerUp = function (id) {
    if (id !== undefined && I.drag.id !== id) return;
    I.drag.active = false;
    I.drag.id = null;
  };

  /* 键盘方向（桌面端替代拖动） */
  I.update = function () {
    var kx = 0, ky = 0;
    for (var code in MOVE_KEYS) {
      if (I.keys[code]) { kx += MOVE_KEYS[code][0]; ky += MOVE_KEYS[code][1]; }
    }
    var len = Math.sqrt(kx * kx + ky * ky);
    if (len > 0) { kx /= len; ky /= len; }
    I.axis.x = kx; I.axis.y = ky;
  };

  I.consumePause = function () { var p = I._pause; I._pause = false; return p; };
  I.clear = function () {
    I._action = false; I._pause = false;
    I.drag.active = false; I.drag.id = null;
    I.axis.x = 0; I.axis.y = 0;
  };

  DF.Input = I;
  if (typeof module !== 'undefined' && module.exports) { module.exports = I; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
};
__mods["src/spec/params"] = function (module, exports, require) {
/* 森林求生｜数值总表
   全部数值来自 doc/game-design-spec.md 第六章「数值总表」与第二、三章的规格表。
   改数值只改这里，不要散落到逻辑代码里。 */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};

  /* ── 基准分辨率（spec 0. 文档约定） ── */
  var P = {
    BASE_W: 750,
    BASE_H: 1334,

    /* ── 6.1 玩家 ── */
    player: {
      radius: 14,
      speed: 180,
      accel: 900,          // 转向加速度
      decel: 1400,         // 停止减速度
      tempMax: 100,
      tempFail: 0
    },

    /* ── 6.2 动物 ── */
    animals: {
      bear: {
        radius: 20,
        patrolSpeed: 62,
        chaseSpeed: 88,
        nightSpeed: 88,
        senseDist: 260,
        coneDeg: 90,
        alertPause: 0.8,    // 警觉停顿，头顶感叹号
        loseTargetTime: 2,  // 丢失目标后转 SEARCH
        searchTime: 3,      // 搜索时长
        contact: 34,        // 接触判定，玩家被抓
        decoyRange: 220,    // 诱饵：兔在此范围内则改追兔
        decoyTime: 4
      },
      snake: {
        radius: 16,
        speed: 0,
        senseDist: 70,
        trigger: 46,        // 触发半径
        biteDelay: 0.4,     // 咬击延迟，有嘶声预警
        poisonTemp: -30,
        poisonTime: 3
      },
      rabbit: {
        radius: 12,
        speed: 120,
        senseDist: 300,     // 逃跑触发
        capture: 26,        // 捕获判定
        score: 2,
        wanderSpeed: 26
      }
    },

    /* ── 6.3 资源与状态 ── */
    resource: {
      berry:  { score: 1, temp: 15 },
      gold:   { score: 3, temp: 40 },
      wood:   { score: 0, temp: 0 },
      herb:   { score: 0, temp: 0 }
    },
    temp: {
      dayChange: 0,        // 白天体温不变
      fireGain: 6,         // 夜晚火堆内
      nightLoss: 2.5       // 夜晚火堆外
    },
    fire: {
      radius: 180,         // 保暖半径
      woodPerBurn: 10,     // 每 10 秒消耗 1 个木头
      burnTime: 10,
      woodStock: 3         // 初始木头存量
    },

    /* ── 6.4 采集 ── */
    collect: {
      time: 0.8,           // 采集耗时
      radius: 28,          // 拾取半径
      respawnDay: 6,       // 资源刷新间隔
      respawnNight: 12
    },

    /* ── 2.3 昼夜 ── */
    dayNight: {
      dayLength: 60,
      nightLength: 30,
      nightVision: 320,    // 夜晚视野半径
      visionFeather: 40,
      outsideBrightness: 0.25,
      nightResourceScale: 0.5
    },

    /* ── 5.2 输入 ── */
    input: {
      maxDragOffset: 120   // 拖动最大偏移
    },

    /* ── 5.3 摄像机 ── */
    camera: {
      deadZone: 40,
      lerp: 0.12,
      zoom: 1.0
    },

    /* ── 2.2 地图通用规则 ── */
    map: {
      border: 80,          // 四周不可达边界
      spawnSafeDist: 260,  // 出生点距危险物至少
      squashY: 0.85        // 7.2 垂直压缩
    },

    /* ── 3.1 采集后行为 ── */
    poison: {
      cureByHerb: true
    }
  };

  /* 便捷取值 */
  P.animal = function (type) { return P.animals[type]; };
  P.res = function (type) { return P.resource[type]; };

  DF.Params = P;
  if (typeof module !== 'undefined' && module.exports) { module.exports = P; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
};
__mods["src/spec/levels"] = function (module, exports, require) {
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
      stars: ['complete', 'decoy:1', 'no_damage'], teach: '兔子可以引开熊，不做教学' },
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
      stars: ['complete', 'no_damage', 'undetected'], teach: '蛇完全静止，靠近才触发' },
    { name: '学会药草', template: 'grove', dur: 90, day: 60,
      animals: ['snake:2', 'bear:1:always'], res: { berry: 5, herb: 2 }, fires: 0,
      goal: { type: 'survive' }, goalText: '活到天亮',
      stars: ['complete', 'herb:1', 'no_damage'], teach: '药草解除中毒' },
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
      stars: ['complete', 'decoy:2', 'no_damage'], teach: '把兔子赶向熊来脱身' },
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
      stars: ['complete', 'decoy:1', 'no_damage'], teach: '诱饵加地形' },
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
      stars: ['complete', 'herb:2', 'no_damage'], teach: '密集伏击，药草要省着用' },
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
      stars: ['complete', 'decoy:2', 'no_damage'], teach: '连续使用诱饵' },
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
      stars: ['complete', 'herb:2', 'no_damage'], teach: '药草不够用' },
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
      stars: ['complete', 'decoy:1', 'fire_alive'], teach: '终章：带着遗物走出去' }
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
};
__mods["src/game/entities"] = function (module, exports, require) {
/* 森林求生｜实体：玩家、熊、蛇、兔、资源、火堆
   行为按 spec 3.2「行为原型」实现，数值取自 src/spec/params.js。 */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};
  var U = DF.Util;
  var P = DF.Params;

  /* ══════════════ 玩家 ══════════════ */
  function Player(x, y) {
    var p = P.player;
    this.type = 'player';
    this.x = x; this.y = y;
    this.r = p.radius;
    this.vx = 0; this.vy = 0;
    this.facing = -Math.PI / 2;
    this.temp = p.tempMax;
    this.poison = 0;          // 中毒剩余时间
    this.wood = 0;            // 待送达火堆的木头
    this.decoy = null;        // 抓在手里的兔子（诱饵）
    this.collectTarget = null;
    this.collectT = 0;
    this.moving = false;
    this.dead = false;
    this.hitAt = -99;
    this.anim = 0;
  }

  /* 5.2 输入：屏幕任意位置按下，角色朝手指位置移动，最大偏移 120 像素 */
  Player.prototype.update = function (dt, ctx) {
    if (this.dead) return;
    var p = P.player;
    var target = ctx.dragActive ? ctx.dragPoint : null;
    var desiredVx = 0, desiredVy = 0;

    if (target) {
      var dx = target.x - this.x, dy = target.y - this.y;
      var d = Math.hypot(dx, dy);
      if (d > P.input.maxDragOffset) {
        desiredVx = dx / d * p.speed;
        desiredVy = dy / d * p.speed;
      }
    }
    // 转向加速度 / 停止减速度
    var dvx = desiredVx - this.vx, dvy = desiredVy - this.vy;
    var dmag = Math.hypot(dvx, dvy);
    var rate = (desiredVx || desiredVy) ? p.accel : p.decel;
    var maxDelta = rate * dt;
    if (dmag > maxDelta) { dvx = dvx / dmag * maxDelta; dvy = dvy / dmag * maxDelta; }
    this.vx += dvx; this.vy += dvy;

    var sp = Math.hypot(this.vx, this.vy);
    if (sp > p.speed) { this.vx = this.vx / sp * p.speed; this.vy = this.vy / sp * p.speed; sp = p.speed; }
    this.moving = sp > 6;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (sp > 1) this.facing = Math.atan2(this.vy, this.vx);
    this.anim += dt * (this.moving ? 9 : 2.2);

    // 碰撞
    ctx.world.resolveCircle(this);
    if (ctx.world.clampToBounds(this)) { /* 已处理 */ }
  };

  /* 中毒：咬击瞬间扣 30，三秒后自动解除，药草可提前解除 */
  Player.prototype.poisoned = function () { return this.poison > 0; };
  Player.prototype.applyPoison = function (ctx) {
    this.temp = Math.max(0, this.temp + P.animals.snake.poisonTemp);
    this.poison = P.animals.snake.poisonTime;
    ctx.bus.emit('hit', { x: this.x, y: this.y, kind: 'poison' });
  };

  Player.prototype.addTemp = function (v) { this.temp = U.clamp(this.temp + v, 0, P.player.tempMax); };

  /* ══════════════ 熊：巡逻追击原型 ══════════════ */
  function Bear(x, y, path, opts) {
    opts = opts || {};
    var b = P.animals.bear;
    this.type = 'bear';
    this.x = x; this.y = y;
    this.r = b.radius;
    this.state = 'PATROL';
    this.stateT = 0;
    this.facing = Math.random() * U.TAU;
    this.path = path || [{ x: x, y: y }];
    this.pathIndex = 0;
    this.lastKnown = { x: x, y: y };
    this.chargeT = 0;         // 警觉停顿
    this.seen = false;        // 本局是否发现过玩家
    this.chaseTarget = null;  // 诱饵目标（兔子）
    this.decoyT = 0;
    this.aggressive = opts.aggressive === undefined ? true : opts.aggressive;
    this.anim = Math.random() * 6.28;
    this.alertMark = 0;        // 感叹号动画
    this.stepAcc = 0;
  }

  Bear.prototype.speed = function (night) {
    var b = P.animals.bear;
    if (this.state === 'CHASE' || this.state === 'SEARCH') return night ? b.nightSpeed : b.chaseSpeed;
    return night ? b.nightSpeed : b.patrolSpeed;
  };

  Bear.prototype.senses = function (player, night) {
    var b = P.animals.bear;
    var dx = player.x - this.x, dy = player.y - this.y;
    var d = Math.hypot(dx, dy);
    if (d > b.senseDist) return false;
    if (d < 30) return true;                    // 太近直接察觉
    if (night) return true;                     // 夜里视野差，靠听觉
    var ang = Math.atan2(dy, dx);
    var half = b.coneDeg * Math.PI / 360;
    return Math.abs(U.angleDiff(this.facing, ang)) <= half;
  };

  Bear.prototype.update = function (dt, ctx) {
    var b = P.animals.bear;
    var player = ctx.player;
    this.anim += dt * (this.state === 'CHASE' ? 11 : 5);
    this.stateT += dt;
    this.alertMark = Math.max(0, this.alertMark - dt * 2);

    var target = null;
    var chasing = false;

    // 诱饵优先：追击时兔在 220 内则改追兔，持续 4 秒
    if (this.decoyT > 0) {
      this.decoyT -= dt;
      if (this.decoyTarget && !this.decoyTarget.dead) { target = this.decoyTarget; chasing = true; }
      else this.decoyTarget = null;
    }

    if (!target) {
      // 常规感知
      var canSense = this.aggressive === true || (this.aggressive === 'night' && ctx.night);
      var sensed = canSense && this.senses(player, ctx.night);
      if (sensed) {
        this.lastKnown = { x: player.x, y: player.y };
        if (this.state === 'PATROL' || this.state === 'SEARCH') {
          this.state = 'SUSPICIOUS';
          this.stateT = 0;
          this.chargeT = b.alertPause;
          this.alertMark = 1.2;
          ctx.bus.emit('bearAlert', { x: this.x, y: this.y });
        }
        if (this.state === 'SUSPICIOUS' || this.state === 'CHASE') {
          this.state = 'CHASE';
          this.stateT = 0;
          this.seen = true;
          chasing = true;
          target = player;
        }
      }
    }

    if (!chasing) {
      if (this.state === 'SUSPICIOUS') {
        this.chargeT -= dt;
        if (this.chargeT <= 0) { this.state = 'CHASE'; this.stateT = 0; chasing = true; target = player; }
      } else if (this.state === 'CHASE') {
        // 2 秒未重新感知到目标则转 SEARCH
        if (this.stateT > b.loseTargetTime) { this.state = 'SEARCH'; this.stateT = 0; }
      } else if (this.state === 'SEARCH') {
        if (this.stateT > b.searchTime) { this.state = 'PATROL'; this.stateT = 0; }
      }
    }

    var sp = this.speed(ctx.night);
    var vx = 0, vy = 0;

    if (chasing && target) {
      var dx = target.x - this.x, dy = target.y - this.y;
      var d = Math.hypot(dx, dy) || 1;
      vx = dx / d * sp; vy = dy / d * sp;
      this.facing = Math.atan2(dy, dx);
      this.stepAcc += dt * sp;
      if (this.stepAcc > 60) { this.stepAcc = 0; ctx.bus.emit('bearStep', { x: this.x, y: this.y, d: d }); }
      // 接触判定
      var rr = target.r + P.animals.bear.contact;
      if (U.dist2(this.x, this.y, target.x, target.y) < rr * rr && target.type === 'player') {
        ctx.onCaught(this);
      }
    } else if (this.state === 'SEARCH') {
      // 在最后已知位置附近徘徊
      var lx = this.lastKnown.x - this.x, ly = this.lastKnown.y - this.y;
      var ld = Math.hypot(lx, ly) || 1;
      vx = lx / ld * sp * 0.7 + Math.sin(this.anim * 0.7) * 22;
      vy = ly / ld * sp * 0.7 + Math.cos(this.anim * 0.5) * 22;
      this.facing = Math.atan2(vy, vx);
    } else {
      // 巡逻：沿固定路线
      var wp = this.path[this.pathIndex % this.path.length];
      var pdx = wp.x - this.x, pdy = wp.y - this.y;
      var pd = Math.hypot(pdx, pdy);
      if (pd < 40) { this.pathIndex++; wp = this.path[this.pathIndex % this.path.length]; pdx = wp.x - this.x; pdy = wp.y - this.y; pd = Math.hypot(pdx, pdy) || 1; }
      vx = pdx / pd * sp; vy = pdy / pd * sp;
      this.facing = Math.atan2(vy, vx);
      this.stepAcc += dt * sp;
      if (this.stepAcc > 80) { this.stepAcc = 0; ctx.bus.emit('bearStep', { x: this.x, y: this.y, d: 999 }); }
    }

    this.x += vx * dt;
    this.y += vy * dt;
    ctx.world.resolveCircle(this);
    ctx.world.clampToBounds(this);
  };

  /* 被诱饵吸引 */
  Bear.prototype.lure = function (rabbit, time) {
    this.decoyTarget = rabbit;
    this.decoyT = time;
    this.state = 'CHASE';
    this.stateT = 0;
  };

  /* ══════════════ 蛇：潜伏伏击原型 ══════════════ */
  function Snake(x, y) {
    var s = P.animals.snake;
    this.type = 'snake';
    this.x = x; this.y = y;
    this.r = s.radius;
    this.cool = 0;
    this.biteT = 0;
    this.strike = 0;      // 弹起动画
    this.anim = Math.random() * 6.28;
  }

  Snake.prototype.update = function (dt, ctx) {
    var s = P.animals.snake;
    this.anim += dt * 3;
    if (this.cool > 0) { this.cool -= dt; }
    if (this.biteT > 0) {
      this.biteT -= dt;
      this.strike = 1;
      if (this.biteT <= 0) {
        this.strike = 0;
        this.cool = 2.2;
        ctx.player.applyPoison(ctx);
      }
    } else if (this.cool <= 0) {
      var d = U.dist(this.x, this.y, ctx.player.x, ctx.player.y);
      if (d < s.trigger) {
        this.biteT = s.biteDelay;
        ctx.bus.emit('snakeHiss', { x: this.x, y: this.y });
      }
    }
    if (this.strike > 0) this.strike = Math.max(0, this.strike - dt * 2.5);
  };

  /* ══════════════ 兔：资源生物原型 ══════════════ */
  function Rabbit(x, y) {
    var r = P.animals.rabbit;
    this.type = 'rabbit';
    this.x = x; this.y = y;
    this.r = r.radius;
    this.vx = 0; this.vy = 0;
    this.fleeing = false;
    this.facing = Math.random() * U.TAU;
    this.wanderT = 0;
    this.anim = Math.random() * 6.28;
    this.dead = false;
    this.caught = false;
    this.bias = (Math.random() - 0.5) * 0.8;   // 逃跑方向的少量随机偏移
  }

  Rabbit.prototype.update = function (dt, ctx) {
    var r = P.animals.rabbit;
    this.anim += dt * (this.fleeing ? 16 : 3);
    var player = ctx.player;
    var d = U.dist(this.x, this.y, player.x, player.y);

    if (d < r.senseDist) {
      this.fleeing = true;
      var dx = this.x - player.x, dy = this.y - player.y;
      var ang = Math.atan2(dy, dx) + this.bias;
      var sp = r.speed;
      this.vx = Math.cos(ang) * sp;
      this.vy = Math.sin(ang) * sp;
      this.facing = ang;
    } else {
      this.fleeing = false;
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 1.2 + Math.random() * 1.8;
        this.facing = Math.random() * U.TAU;
      }
      this.vx = Math.cos(this.facing) * r.wanderSpeed;
      this.vy = Math.sin(this.facing) * r.wanderSpeed;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    ctx.world.resolveCircle(this);
    ctx.world.clampToBounds(this);
  };

  /* ══════════════ 资源 ══════════════ */
  var RES_STYLE = {
    berry: { r: 9, color: '#d4455a', glow: '#ff8a9c' },
    gold:  { r: 11, color: '#f0b45c', glow: '#ffe3a8' },
    wood:  { r: 11, color: '#8a6440', glow: '#c49a6a' },
    herb:  { r: 10, color: '#5f9e58', glow: '#a8e0a0' }
  };

  function Resource(type, x, y) {
    this.type = 'resource';
    this.res = type;
    this.x = x; this.y = y;
    this.r = RES_STYLE[type].r;
    this.alive = true;
    this.cool = 0;          // 采集冷却
    this.collecting = 0;    // 0 到 1 的采集进度
    this.anim = Math.random() * 6.28;
    this.bob = Math.random() * 6.28;
  }

  Resource.prototype.update = function (dt, ctx) {
    this.anim += dt * 2.4;
    this.bob += dt * 2.8;
    if (this.cool > 0) {
      this.cool -= dt;
      if (this.cool <= 0) { this.alive = true; this.collecting = 0; }
    }
  };

  /* ══════════════ 火堆 ══════════════ */
  function Fire(x, y) {
    this.type = 'fire';
    this.x = x; this.y = y;
    this.r = P.fire.radius;
    this.wood = P.fire.woodStock;
    this.lit = this.wood > 0;
    this.burnT = 0;
    this.anim = Math.random() * 6.28;
    this.everLit = this.lit;
    this.flicker = 0;
  }

  Fire.prototype.update = function (dt, ctx) {
    this.anim += dt * 6;
    if (this.lit) {
      this.burnT += dt;
      while (this.burnT >= P.fire.burnTime) {
        this.burnT -= P.fire.burnTime;
        if (this.wood > 0) { this.wood--; }
        else { this.lit = false; break; }
      }
      this.flicker = 0.8 + 0.2 * Math.sin(this.anim * 1.7) + 0.1 * Math.sin(this.anim * 3.1);
    } else {
      this.flicker = 0;
    }
    // 玩家送木头
    if (this.lit && ctx.player.wood > 0 && U.dist(ctx.player.x, ctx.player.y, this.x, this.y) < this.r * 0.75) {
      ctx.player.wood--;
      this.wood = Math.min(99, this.wood + 1);
      this.lit = true;
      ctx.bus.emit('fireStoke', { x: this.x, y: this.y });
    }
  };

  DF.Entities = {
    Player: Player, Bear: Bear, Snake: Snake, Rabbit: Rabbit,
    Resource: Resource, Fire: Fire, RES_STYLE: RES_STYLE
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = DF.Entities; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
};
__mods["src/game/level"] = function (module, exports, require) {
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
};
__mods["src/game/render"] = function (module, exports, require) {
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
};
__mods["src/game/core"] = function (module, exports, require) {
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
};
__mods["src/ui/canvas"] = function (module, exports, require) {
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
};
__mods["src/boot/minigame"] = function (module, exports, require) {
/* 森林求生｜微信小游戏启动 */
(function (global) {
  'use strict';
  var wx = global.wx;
  var DF = global.DF = global.DF || {};

  /* ── 共享模块（顺序重要：util 最先） ─────────────── */
  DF.Util = require('../util.js');
  DF.Audio = require('../audio.js');
  DF.Input = require('../input.js');
  DF.Params = require('../spec/params.js');
  DF.Levels = require('../spec/levels.js');
  DF.Entities = require('../game/entities.js');
  DF.Level = require('../game/level.js');
  DF.Renderer = require('../game/render.js');
  DF.Game = require('../game/core.js');
  var CanvasUI = require('../ui/canvas.js');
  var U = DF.Util;

  /* ── 平台适配 ───────────────────────────────────── */
  U.createCanvas = function (w, h) {
    var c = wx.createCanvas();
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
    return c;
  };
  U.createAudioContext = function () {
    try { return wx.createWebAudioContext(); } catch (e) { return null; }
  };
  U.storage = {
    get: function (k, d) {
      try {
        var v = wx.getStorageSync(k);
        return (v === '' || v === null || v === undefined) ? d : v;
      } catch (e) { return d; }
    },
    set: function (k, v) { try { wx.setStorageSync(k, v); } catch (e) {} }
  };

  /* ── 组装 ───────────────────────────────────────── */
  var canvas = wx.createCanvas();
  var renderer = new DF.Renderer(canvas);
  var bus = U.emitter();
  var game = new DF.Game({
    bus: bus, renderer: renderer, input: DF.Input, storage: U.storage
  });
  var ui = new CanvasUI(bus, game, renderer);
  game.ui = ui;
  global.game = game;

  function layout() {
    renderer.resize();
    DF.Input.setTransform(renderer.ox, renderer.oy, renderer.scale);
  }
  layout();

  /* ── 触摸：界面优先，其余交给拖动 ───────────────── */
  var dragId = null;
  var scrollId = null, scrollY = 0;

  function toDesign(t) {
    return { x: (t.clientX - renderer.ox) / renderer.scale, y: (t.clientY - renderer.oy) / renderer.scale };
  }

  wx.onTouchStart(function (e) {
    var list = e.changedTouches || [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var d = toDesign(t);
      var btn = ui.hitTest(d.x, d.y);
      if (btn) { ui.press(btn.id); continue; }
      if (ui.gridRect && ui.screen === 'menu') {
        var g = ui.gridRect;
        if (d.x >= g.x && d.x <= g.x + g.w && d.y >= g.y && d.y <= g.y + g.h) {
          scrollId = t.identifier; scrollY = t.clientY;
          continue;
        }
      }
      if (ui.screen === 'play') {
        dragId = t.identifier;
        DF.Input.pointerDown(t.identifier, t.clientX, t.clientY);
      }
    }
  });

  wx.onTouchMove(function (e) {
    var list = e.changedTouches || [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (scrollId === t.identifier) {
        ui.scrollBy(scrollY - t.clientY);
        scrollY = t.clientY;
        continue;
      }
      if (dragId === t.identifier) DF.Input.pointerMove(t.identifier, t.clientX, t.clientY);
    }
  });

  function endTouch(t) {
    if (scrollId === t.identifier) { scrollId = null; return; }
    if (dragId === t.identifier) { dragId = null; DF.Input.pointerUp(t.identifier); }
  }
  wx.onTouchEnd(function (e) {
    var list = e.changedTouches || [];
    for (var i = 0; i < list.length; i++) endTouch(list[i]);
  });
  wx.onTouchCancel(function (e) {
    var list = e.changedTouches || [];
    for (var i = 0; i < list.length; i++) endTouch(list[i]);
  });

  wx.onHide(function () { DF.Input.clear(); });
  wx.onShow(function () { DF.Audio.resume(); });

  game.start();
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
};
window.__mgRequire = __req;
window.__mgBoot = function () { return __req("src/boot/minigame.js", ""); };
})();
