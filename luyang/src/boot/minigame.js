/* 拼车狂飙｜微信小游戏启动 */
(function (global) {
  'use strict';
  var wx = global.wx;
  var LY = global.LY = global.LY || {};

  LY.Config = require('../config.js');
  LY.Util = require('../util.js');
  LY.Params = require('../spec/params.js');
  LY.Parts = require('../spec/parts.js');
  LY.Vehicles = require('../spec/vehicles.js');
  LY.Levels = require('../spec/levels.js');
  LY.Save = require('../cloud/save.js');
  LY.Project = require('../game/project.js');
  LY.Run = require('../game/run.js');
  LY.Renderer = require('../game/render.js');
  LY.Game = require('../game/core.js');
  var CanvasUI = require('../ui/canvas.js');

  var canvas = wx.createCanvas();
  var bus = LY.Util.emitter();
  var renderer = new LY.Renderer(canvas);
  var game = new LY.Game({ bus: bus, renderer: renderer });
  var ui = new CanvasUI(bus, game, renderer);
  game.ui = ui;
  global.luyang = game;

  function layout() { renderer.resize(); }
  layout();
  if (wx.onWindowResize) wx.onWindowResize(layout);

  wx.onTouchStart(function (e) {
    var list = e.changedTouches || [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var x = (t.clientX - renderer.ox) / renderer.scale;
      var y = (t.clientY - renderer.oy) / renderer.scale;
      var btn = ui.hitTest(x, y);
      if (btn) ui.press(btn.id);
    }
  });

  game.start();
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
