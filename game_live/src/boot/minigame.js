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