/* 拼车狂飙 · H5 UI */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};
  function $(id) { return document.getElementById(id); }

  function DomUI(bus, game) {
    this.bus = bus;
    this.game = game;
    this.bind();
    this.wire();
  }

  DomUI.prototype.bind = function () {
    var g = this.game;
    $('btn-continue').onclick = function () { g.startRun(); };
    $('btn-levels').onclick = function () { g.openLevels(); };
    $('btn-bag').onclick = function () { g.openBag(); };
    $('btn-shop').onclick = function () { g.openShop(); };
    $('btn-garage').onclick = function () { g.openGarage(); };
    $('btn-levels-back').onclick = function () { g.backMenu(); };
    $('btn-bag-back').onclick = function () { g.backMenu(); };
    $('btn-shop-back').onclick = function () { g.backMenu(); };
    $('btn-garage-back').onclick = function () { g.backMenu(); };
    $('btn-upgrade').onclick = function () { g.upgradeVehicle(); };
    $('btn-again').onclick = function () { g.retry(); };
    $('btn-next').onclick = function () { g.nextLevel(); };
    $('btn-result-menu').onclick = function () { g.backMenu(); };
    $('btn-pause').onclick = function () { g.togglePause(); };
    $('btn-resume').onclick = function () { g.togglePause(); };
    $('btn-pause-menu').onclick = function () { g.backMenu(); };
    $('btn-left').onclick = function () { g.lane(-1); };
    $('btn-right').onclick = function () { g.lane(1); };
    $('btn-skill').onclick = function () { g.skill(); };
    $('btn-cp-rush').onclick = function () { g.chooseCheckpoint('rush'); };

    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'a') g.lane(-1);
      if (e.key === 'ArrowRight' || e.key === 'd') g.lane(1);
      if (e.key === ' ' || e.key === 'f' || e.key === 'F') { e.preventDefault(); g.skill(); }
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') g.togglePause();
    });
  };

  DomUI.prototype.wire = function () {
    var self = this;
    this.bus.on('screen', function (n) { self.showScreen(n); });
    this.bus.on('hud', function (s) { self.renderHud(s); });
    this.bus.on('result', function (r) { self.renderResult(r); });
    this.bus.on('progress', function (p) { self.renderProgress(p); });
    this.bus.on('toast', function (m) { self.toast(m); });
    this.bus.on('pause', function (on) { $('screen-pause').classList.toggle('show', !!on); });
    this.bus.on('checkpoint', function (st) { self.renderCheckpoint(st); });
  };

  DomUI.prototype.showScreen = function (name) {
    ['menu', 'levels', 'bag', 'shop', 'garage', 'play', 'result', 'pause', 'checkpoint'].forEach(function (s) {
      var el = $('screen-' + s);
      if (el) el.classList.toggle('show', s === name);
    });
    if (name === 'levels') this.renderLevelList();
    if (name === 'bag') this.renderBag();
    if (name === 'shop') this.renderShop();
    if (name === 'garage') this.renderGarage();
    if (name !== 'play') {
      $('screen-checkpoint').classList.remove('show');
      $('screen-pause').classList.remove('show');
    }
  };

  DomUI.prototype.renderLevelList = function () {
    var box = $('level-list');
    box.innerHTML = '';
    var p = LY.Save.get();
    var g = this.game;
    LY.Levels.list.slice(0, 30).forEach(function (lv) {
      var unlocked = LY.Levels.isUnlocked(lv.id, p);
      var stars = (p.stageStars && p.stageStars[lv.id]) || 0;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn level-card' + (unlocked ? '' : ' locked');
      btn.disabled = !unlocked;
      btn.innerHTML = '<strong>第' + lv.id + '段 · ' + lv.name + ' ' + starText(stars) + '</strong>' +
        '<span>' + (unlocked ? (lv.blurb + ' · 掉 Lv' + lv.dropLevel) : '通关上一段解锁') + '</span>';
      btn.onclick = function () { g.startRun(lv.id); };
      box.appendChild(btn);
    });
  };

  function starText(n) {
    return '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n);
  }

  DomUI.prototype.renderBag = function () {
    var box = $('bag-list');
    box.innerHTML = '';
    var g = this.game;
    var p = LY.Save.get();
    $('bag-gold').textContent = '金币 ' + (p.gold || 0);
    var any = false;
    for (var lv = 1; lv <= 30; lv++) {
      var c = LY.Save.getItemCount(lv);
      if (!c) continue;
      any = true;
      (function (level, count) {
        var row = document.createElement('div');
        row.className = 'bag-row';
        row.innerHTML = '<span>材料 Lv' + level + ' ×' + count + '</span>';
        var craft = document.createElement('button');
        craft.className = 'btn';
        craft.textContent = '合成';
        craft.disabled = count < 2 || level >= 30;
        craft.onclick = function () { g.craft(level); selfRefresh(); };
        var sell = document.createElement('button');
        sell.className = 'btn ghost';
        sell.textContent = '卖 ' + LY.Params.sellPrice(level);
        sell.onclick = function () { g.sell(level); selfRefresh(); };
        row.appendChild(craft);
        row.appendChild(sell);
        box.appendChild(row);
      })(lv, c);
    }
    if (!any) box.innerHTML = '<p class="hint">背包空空，去闯关捡材料</p>';
    var self = this;
    function selfRefresh() { self.renderBag(); self.renderProgress(LY.Save.get()); }
  };

  DomUI.prototype.renderShop = function () {
    var box = $('shop-list');
    box.innerHTML = '';
    var p = LY.Save.get();
    $('shop-gold').textContent = '金币 ' + (p.gold || 0);
    var g = this.game;
    var drop = LY.Params.dropLevel(p.maxLevel || 1);
    var self = this;
    for (var lv = Math.max(1, drop - 1); lv <= Math.min(30, drop + 1); lv++) {
      (function (level) {
        var row = document.createElement('div');
        row.className = 'bag-row';
        row.innerHTML = '<span>买 Lv' + level + ' · ' + LY.Params.buyPrice(level) + ' 金</span>';
        var buy = document.createElement('button');
        buy.className = 'btn';
        buy.textContent = '购买';
        buy.onclick = function () { g.buy(level); self.renderShop(); self.renderProgress(LY.Save.get()); };
        row.appendChild(buy);
        box.appendChild(row);
      })(lv);
    }
  };

  DomUI.prototype.renderGarage = function () {
    var p = LY.Save.get();
    var v = LY.Vehicles.get(p.vehicleTier || 1);
    $('garage-car').textContent = '当前：' + v.name + '（座位 ' + v.seats + '）';
    $('garage-skill').textContent = '技能：' + v.skill.name + ' — ' + v.skill.desc;
    var cost = LY.Vehicles.upgradeCost(p.vehicleTier || 1);
    if (!cost) $('garage-next').textContent = '已满级';
    else {
      var have = LY.Save.getItemCount(cost.level);
      $('garage-next').textContent = '升阶需 ' + cost.count + '×Lv' + cost.level + '（拥有 ' + have + '）· 下阶技能 ' + LY.Vehicles.get((p.vehicleTier || 1) + 1).skill.name;
    }
  };

  DomUI.prototype.renderHud = function (state) {
    if (!state) return;
    var d = LY.Run.derived(state);
    var ratio = LY.Run.progressRatio(state);
    var maxW = state.level.checkpointMaxWidth || 1.2;
    $('hud-level').textContent = '第' + state.levelId + '段 · ' + state.level.name;
    $('hud-dist').textContent = Math.floor(state.distance) + ' / ' + state.goalDistance + ' m';
    $('hud-width').textContent = '宽 ' + d.width.toFixed(2) + (state.checkpointDone ? '' : (' / 限' + maxW.toFixed(2)));
    $('hud-parts').textContent = '拼装 ' + state.tempParts.length;
    $('hud-progress').style.width = (ratio * 100).toFixed(1) + '%';
    var sk = state.vehicle.skill;
    var cd = Math.max(0, Math.ceil(state.skillCd));
    var left = state.skillChargesFinite ? ('×' + state.skillCharges) : '';
    $('hud-skill-name').textContent = sk.name + (cd > 0 ? (' CD' + cd) : '') + left;
    $('btn-skill').textContent = cd > 0 ? ('CD ' + cd) : (state.teach && state.teach.phase === 'skill' ? '空格·闪身' : sk.name);
    $('btn-skill').disabled = cd > 0 || (state.skillChargesFinite && state.skillCharges <= 0) || state.status !== 'running';
    $('screen-pause').classList.toggle('show', state.status === 'paused');
    var teach = $('hud-teach');
    if (teach) {
      if (state.teach && state.teach.tip && state.teach.phase !== 'done') {
        teach.hidden = false;
        teach.textContent = state.teach.tip;
      } else if (state.teach && state.teach.phase === 'done') {
        teach.hidden = false;
        teach.textContent = state.teach.tip;
      } else {
        teach.hidden = true;
      }
    }
  };

  DomUI.prototype.renderCheckpoint = function (state) {
    var layer = $('screen-checkpoint');
    if (!state) {
      layer.classList.remove('show');
      return;
    }
    layer.classList.add('show');
    var d = LY.Run.derived(state);
    var maxW = state.level.checkpointMaxWidth || 1.2;
    var tooWide = d.width > maxW;
    $('cp-tip').textContent = tooWide
      ? '车太宽了！建议丢掉一件再过'
      : '宽度还行，仍可丢掉零件换更高完整度，或硬闯';
    $('cp-width').textContent = '当前宽 ' + d.width.toFixed(2) + ' / 限宽 ' + maxW.toFixed(2) + (tooWide ? '  ← 超限' : '  ← 可通过');
    var box = $('cp-parts');
    box.innerHTML = '';
    var g = this.game;
    if (!state.tempParts.length) {
      box.innerHTML = '<p class="hint">没有临时零件可丢，只能硬闯</p>';
      return;
    }
    var seen = {};
    state.tempParts.forEach(function (id) {
      if (seen[id]) return;
      seen[id] = true;
      var part = LY.Parts.get(id);
      var btn = document.createElement('button');
      btn.className = 'btn choice';
      btn.type = 'button';
      btn.textContent = '丢掉 ' + ((part && part.name) || id);
      btn.onclick = function () { g.chooseCheckpoint('discard', id); };
      box.appendChild(btn);
    });
  };

  DomUI.prototype.renderResult = function (r) {
    $('result-title').textContent = r.survived ? '到站了' : '翻车了';
    $('result-stars').textContent = starText(r.stars || 0);
    $('result-level').textContent = '第' + r.levelId + '段 · ' + r.levelName + ' · ' + (r.runTime || 0) + 's';
    $('result-gold').textContent = '金币 +' + r.gold;
    $('result-drops').textContent = '掉落：' + ((r.drops && r.drops.length) ? r.drops.map(function (l) { return 'Lv' + l; }).join(' ') : '无');
    var nextBtn = $('btn-next');
    nextBtn.disabled = false;
    if (r.survived && r.nextLevelId) {
      nextBtn.style.display = '';
      nextBtn.textContent = '下一路段';
    } else if (r.survived) {
      nextBtn.style.display = '';
      nextBtn.textContent = '已通关当前列表';
      nextBtn.disabled = true;
    } else nextBtn.style.display = 'none';
  };

  DomUI.prototype.renderProgress = function (p) {
    var v = LY.Vehicles.get(p.vehicleTier || 1);
    $('menu-gold').textContent = '金币 ' + (p.gold || 0);
    $('menu-car').textContent = v.name + ' · ' + v.skill.name;
    var lv = LY.Levels.get(p.selectedLevel || 1);
    $('btn-continue').textContent = '继续 · ' + lv.name;
  };

  DomUI.prototype.toast = function (msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(function () { el.classList.remove('show'); }, 1600);
  };

  LY.DomUI = DomUI;
  if (typeof module !== 'undefined' && module.exports) module.exports = LY.DomUI;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
