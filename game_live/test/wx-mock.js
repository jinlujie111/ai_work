/* 微信小游戏 API 模拟器：让小游戏代码能在浏览器里跑起来做自动化测试 */
(function (global) {
  'use strict';
  var wx = {};
  var handlers = { touchstart: [], touchmove: [], touchend: [], touchcancel: [], hide: [], show: [] };
  var screenCanvas = null;

  wx.createCanvas = function () {
    var c = document.createElement('canvas');
    c.width = 300; c.height = 150;
    if (!screenCanvas) {
      screenCanvas = c;
      c.id = 'mg-screen';
      c.style.cssText = 'display:block;width:390px;height:844px;';
      document.body.appendChild(c);
    } else {
      c.style.display = 'none';
      document.body.appendChild(c);
    }
    return c;
  };
  wx.getWindowInfo = function () {
    return {
      windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844,
      pixelRatio: 2,
      safeArea: { top: 44, bottom: 810, left: 0, right: 390, width: 390, height: 766 }
    };
  };
  wx.getSystemInfoSync = wx.getWindowInfo;
  wx.createWebAudioContext = function () {
    var AC = global.AudioContext || global.webkitAudioContext;
    return AC ? new AC() : null;
  };
  wx.getStorageSync = function (k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  wx.setStorageSync = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  wx.getLaunchOptionsSync = function () { return { query: (global.__mgQuery || {}) }; };
  wx.getPerformance = function () { return global.performance; };

  wx.onTouchStart = function (fn) { handlers.touchstart.push(fn); };
  wx.onTouchMove = function (fn) { handlers.touchmove.push(fn); };
  wx.onTouchEnd = function (fn) { handlers.touchend.push(fn); };
  wx.onTouchCancel = function (fn) { handlers.touchcancel.push(fn); };
  wx.onHide = function (fn) { handlers.hide.push(fn); };
  wx.onShow = function (fn) { handlers.show.push(fn); };

  /* 测试辅助：模拟一次触摸 */
  wx.__touch = function (type, x, y, id) {
    var t = { identifier: id === undefined ? 1 : id, clientX: x, clientY: y, pageX: x, pageY: y };
    var e = { changedTouches: [t], touches: [t], timeStamp: 0 };
    (handlers[type] || []).forEach(function (fn) { fn(e); });
  };
  wx.__screen = function () { return screenCanvas; };

  global.wx = wx;
})(window);