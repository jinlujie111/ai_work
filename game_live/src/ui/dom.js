/* 森林求生｜H5 界面层
   与小游戏 Canvas 版实现同一套接口：draw(game, dt) 每帧调用。 */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};
  var U = DF.Util;
  var P = DF.Params;

  function $(id) { return document.getElementById(id); }

  function DomUI(bus, game) {
    this.bus = bus;
    this.game = game;
    this.screen = 'menu';           // menu / play / result
    this.last = {};
    this.toastT = 0;
    this.buildLevelGrid();
    this.bind();
    this.showMenu();
  }

  /* ── 选关网格 ── */
  DomUI.prototype.buildLevelGrid = function () {
    var grid = $('level-grid');
    grid.innerHTML = '';
    var self = this;
    for (var i = 1; i <= DF.Levels.count; i++) {
      (function (id) {
        var b = document.createElement('button');
        b.className = 'lv no-drag';
        b.type = 'button';
        b.dataset.id = id;
        b.innerHTML = '<span>' + id + '</span><span class="st"><i></i><i></i><i></i></span>';
        b.addEventListener('click', function () { self.startLevel(id); });
        grid.appendChild(b);
      })(i);
    }
  };

  DomUI.prototype.refreshLevelGrid = function () {
    var game = this.game, grid = $('level-grid');
    var total = 0;
    for (var i = 1; i <= DF.Levels.count; i++) {
      var rec = game.levelRecord(i);
      total += rec.stars;
      var el = grid.querySelector('[data-id="' + i + '"]');
      if (!el) continue;
      var locked = !game.unlocked(i);
      el.classList.toggle('locked', locked);
      var stars = el.querySelectorAll('.st i');
      for (var s = 0; s < stars.length; s++) stars[s].classList.toggle('off', s >= rec.stars);
    }
    $('total-stars').textContent = total;
  };

  /* ── 按钮 ── */
  DomUI.prototype.bind = function () {
    var self = this, game = this.game;
    $('btn-next').addEventListener('click', function () { game.nextLevel(); });
    $('btn-retry').addEventListener('click', function () { game.restart(); });
    $('btn-share').addEventListener('click', function () { self.share(); });
    $('btn-menu').addEventListener('click', function () { game.toMenu(); self.showMenu(); });
    $('btn-sound').addEventListener('click', function () {
      DF.Audio.init();
      var muted = DF.Audio.toggle();
      $('btn-sound').textContent = muted ? '音效 关' : '音效 开';
    });
    this.bus.on('finish', function (r) { self.showResult(r); });
    this.bus.on('levelStart', function () { self.showPlay(); });
  };

  DomUI.prototype.startLevel = function (id) {
    var game = this.game;
    if (!game.unlocked(id)) { this.toast('先通过前一关'); return; }
    DF.Audio.init();
    DF.Audio.click();
    game.startLevel(id);
  };

  DomUI.prototype.share = function () {
    var r = this.game.level && this.game.level.result;
    var text = r ? ('森林求生 第' + this.game.level.id + '关 · ' + r.score + '分 · ' + this.starText(r.stars)) : '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { self.toast('成绩已复制'); },
        function () { self.toast('复制失败'); });
    } else this.toast(text);
  };

  DomUI.prototype.starText = function (stars) {
    var n = 0;
    for (var i = 0; i < stars.length; i++) if (stars[i]) n++;
    return n + ' 星';
  };

  /* ── 屏幕切换 ── */
  DomUI.prototype.show = function (name) {
    this.screen = name;
    $('sc-menu').classList.toggle('active', name === 'menu');
    $('sc-result').classList.toggle('active', name === 'result');
    $('hud').style.opacity = name === 'play' ? '1' : '0';
  };
  DomUI.prototype.showMenu = function () { this.refreshLevelGrid(); this.show('menu'); };
  DomUI.prototype.showPlay = function () { this.show('play'); };
  DomUI.prototype.showResult = function (r) {
    var titles = { survive: '活到天亮', collect: '采集完成', score: '分数达标', gold: '拿到金浆果', cold: '体温耗尽', caught: '被熊抓住了' };
    $('result-title').textContent = r.win ? (titles[r.reason] || '通关') : (titles[r.reason] || '失败');
    var icons = $('result-stars').querySelectorAll('.ic');
    for (var i = 0; i < icons.length; i++) icons[i].classList.toggle('on', !!r.stars[i]);
    $('result-score').textContent = r.score;
    // 星星条件清单
    var list = $('result-conditions');
    list.innerHTML = '';
    var level = this.game.level;
    if (level && level.cfg.stars) {
      for (var si = 0; si < level.cfg.stars.length; si++) {
        var cond = level.cfg.stars[si];
        var li = document.createElement('li');
        if (r.stars[si]) li.className = 'on';
        li.innerHTML = '<i class="dot"></i><span>' + DF.Levels.starText(cond) + '</span>';
        list.appendChild(li);
      }
    }
    var extra = [];
    if (this.game.level) {
      var s = this.game.level.stats;
      extra.push('用时 ' + Math.round(r.time) + ' 秒');
      if (s.gold) extra.push('金浆果 ' + s.gold);
      if (s.decoysUsed) extra.push('引开熊 ' + s.decoysUsed + ' 次');
    }
    $('result-extra').textContent = extra.join(' · ');
    this.show('result');
  };

  DomUI.prototype.toast = function (text) {
    var el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastT);
    var self = this;
    this.toastT = setTimeout(function () { el.classList.remove('show'); }, 1600);
  };

  /* ── 每帧更新 HUD ── */
  DomUI.prototype.draw = function (game, dt) {
    var level = game.level;
    if (!level) return;
    var L = this.last;
    var p = level.player;

    // 关卡信息：关卡号、关卡名、目标
    if (L.lvId !== level.id) {
      L.lvId = level.id;
      $('lv-no').textContent = '第 ' + level.id + ' 关';
      $('lv-name').textContent = level.cfg.name || '';
      $('lv-goal').textContent = level.cfg.goalText || '';
    }
    // 星星实时状态
    var stars = level.starStates();
    var sk = stars.join(',');
    if (L.stars !== sk) {
      L.stars = sk;
      var sicons = $('hud-stars').querySelectorAll('.ic');
      for (var si = 0; si < sicons.length; si++) sicons[si].classList.toggle('on', !!stars[si]);
    }

    // 体温
    var temp = Math.max(0, Math.round(p.temp));
    if (L.temp !== temp) {
      L.temp = temp;
      var pct = U.clamp(temp / P.player.tempMax, 0, 1);
      $('temp-fill').style.transform = 'scaleX(' + pct + ')';
      $('temp-fill').parentNode.classList.toggle('low', pct <= 0.3);
    }
    // 倒计时：白天显示剩余白天，夜晚显示剩余夜晚
    var remain = level.night ? (level.duration - level.time) : (level.dayLength - level.time);
    var secs = Math.max(0, Math.ceil(remain));
    if (L.timer !== secs || L.night !== level.night) {
      L.timer = secs; L.night = level.night;
      $('timer').textContent = secs;
      $('timer').classList.toggle('night', level.night);
    }
    // 分数
    if (L.score !== level.stats.score) {
      L.score = level.stats.score;
      $('score').textContent = level.stats.score;
    }
    // 目标进度
    var g = level.goal;
    var cur, target, icon = '#ico-berry';
    if (g.type === 'collect') { cur = level.stats.collect; target = g.target; }
    else if (g.type === 'gold') { cur = level.stats.gold; target = g.target; icon = '#ico-gold'; }
    else if (g.type === 'score') { cur = level.stats.score; target = g.target; icon = '#ico-score'; }
    else { cur = Math.round(level.time); target = level.duration; icon = '#ico-temp'; }
    var text = cur + '/' + target;
    if (L.goal !== text) {
      L.goal = text;
      $('goal-text').textContent = text;
      $('goal-ico').innerHTML = '<use href="' + icon + '"/>';
    }
  };

  DF.DomUI = DomUI;
  if (typeof module !== 'undefined' && module.exports) { module.exports = DomUI; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));