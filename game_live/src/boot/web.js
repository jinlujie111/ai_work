/* 森林求生｜H5 启动 */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};
  var U = DF.Util;

  function boot() {
    var bus = U.emitter();
    var canvas = document.getElementById('game');
    var renderer = new DF.Renderer(canvas);
    var game = new DF.Game({
      bus: bus, renderer: renderer, input: DF.Input, storage: U.storage
    });
    var ui = new DF.DomUI(bus, game);
    game.ui = ui;

    DF.Input.attach(document.getElementById('stage'));

    function layout() {
      renderer.resize();
      var stage = document.getElementById('stage');
      document.documentElement.style.setProperty('--s', (stage.clientWidth / DF.Params.BASE_W) + 'px');
      DF.Input.setTransform(renderer.ox, renderer.oy, renderer.scale);
    }
    global.addEventListener('resize', layout);
    layout();

    game.start();
    global.forestSurvival = game;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));