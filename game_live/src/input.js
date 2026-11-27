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