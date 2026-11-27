/* 路养｜H5 启动 */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  function boot() {
    var bus = LY.Util.emitter();
    var canvas = document.getElementById('game');
    var renderer = new LY.Renderer(canvas);
    var game = new LY.Game({ bus: bus, renderer: renderer });
    var ui = new LY.DomUI(bus, game);
    game.ui = ui;

    function layout() {
      renderer.resize();
    }
    global.addEventListener('resize', layout);
    layout();

    game.start();
    global.luyang = game;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
