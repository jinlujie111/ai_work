/* 路养 · 工具：数学、随机、事件总线、平台适配 */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};
  var U = LY.Util = {};

  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };

  U.rng = function (seed) {
    var a = (seed >>> 0) || 1;
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
    return r;
  };

  U.emitter = function () {
    var map = {};
    return {
      on: function (k, fn) { (map[k] || (map[k] = [])).push(fn); return fn; },
      off: function (k, fn) {
        if (!map[k]) return;
        map[k] = map[k].filter(function (f) { return f !== fn; });
      },
      emit: function (k, payload) {
        var l = map[k];
        if (!l) return;
        for (var i = 0; i < l.length; i++) {
          try { l[i](payload); } catch (e) { if (global.console) console.error(e); }
        }
      }
    };
  };

  U.isMiniGame = function () {
    return !!(global.wx && typeof global.wx.createCanvas === 'function');
  };

  U.storage = {
    get: function (k, d) {
      try {
        if (U.isMiniGame()) {
          var v = global.wx.getStorageSync(k);
          return (v === '' || v === null || v === undefined) ? d : v;
        }
        var w = global.localStorage.getItem(k);
        return (w === null || w === undefined) ? d : w;
      } catch (e) { return d; }
    },
    set: function (k, v) {
      try {
        if (U.isMiniGame()) global.wx.setStorageSync(k, v);
        else global.localStorage.setItem(k, v);
      } catch (e) {}
    }
  };

  U.now = function () {
    if (global.performance && global.performance.now) return global.performance.now();
    return Date.now();
  };

  U.raf = function (cb) {
    if (typeof global.requestAnimationFrame === 'function') return global.requestAnimationFrame(cb);
    return global.setTimeout(function () { cb(U.now()); }, 16);
  };

  U.getViewport = function (canvas) {
    if (U.isMiniGame()) {
      var info = null;
      try {
        info = global.wx.getWindowInfo ? global.wx.getWindowInfo() : global.wx.getSystemInfoSync();
      } catch (e) {
        info = { windowWidth: 390, windowHeight: 844, pixelRatio: 2 };
      }
      return {
        w: info.windowWidth,
        h: info.windowHeight,
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

  if (typeof module !== 'undefined' && module.exports) module.exports = LY.Util;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
