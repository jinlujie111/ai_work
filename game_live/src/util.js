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