/* 拼车狂飙 · 存档：金币/背包/合成/商城/车阶/星级 + 云同步 */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  function defaultProgress() {
    return {
      gold: 80,
      vehicleTier: 1,
      inventory: {},
      stageStars: {},
      maxLevel: 1,
      selectedLevel: 1,
      runs: 0,
      bestDistance: 0,
      updatedAt: 0
    };
  }

  function parseLocal(raw) {
    var d = defaultProgress();
    if (!raw) return d;
    try {
      var o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Object.assign(d, o, {
        inventory: Object.assign({}, d.inventory, (o && o.inventory) || {}),
        stageStars: Object.assign({}, d.stageStars, (o && o.stageStars) || {})
      });
    } catch (e) {
      return d;
    }
  }

  function localKey() {
    return (LY.Config && LY.Config.storageKey) || 'luyang_assemble_v1';
  }

  function invKey(level) { return 'L' + level; }

  function initCloud() {
    if (!global.wx || !global.wx.cloud) return false;
    var env = (LY.Config && LY.Config.cloudEnvId) || '';
    if (!env) return false;
    try {
      global.wx.cloud.init({ env: env, traceUser: true });
      return true;
    } catch (e) { return false; }
  }

  LY.Save = {
    init: function () {
      this._cloud = initCloud();
      this._progress = parseLocal(LY.Util.storage.get(localKey(), null));
      return this._progress;
    },

    get: function () {
      return this._progress || this.init();
    },

    commit: function (patch) {
      var p = Object.assign({}, this.get(), patch || {});
      if (patch && patch.inventory) p.inventory = patch.inventory;
      if (patch && patch.stageStars) p.stageStars = patch.stageStars;
      p.updatedAt = Date.now();
      this._progress = p;
      LY.Util.storage.set(localKey(), JSON.stringify(p));
      this.syncToCloud(p);
      return p;
    },

    getItemCount: function (level) {
      var p = this.get();
      return (p.inventory && p.inventory[invKey(level)]) || 0;
    },

    addItems: function (level, count) {
      var p = this.get();
      var inv = Object.assign({}, p.inventory);
      var k = invKey(level);
      inv[k] = (inv[k] || 0) + (count || 0);
      if (inv[k] <= 0) delete inv[k];
      return this.commit({ inventory: inv });
    },

    craft: function (level) {
      level = level | 0;
      if (level < 1 || level >= 30) return { ok: false, reason: '无法合成' };
      if (this.getItemCount(level) < 2) return { ok: false, reason: '需要 2 个 Lv' + level };
      this.addItems(level, -2);
      this.addItems(level + 1, 1);
      return { ok: true, progress: this.get() };
    },

    buy: function (level, count) {
      count = count || 1;
      var cost = LY.Params.buyPrice(level) * count;
      var p = this.get();
      if ((p.gold || 0) < cost) return { ok: false, reason: '金币不足' };
      this.commit({ gold: p.gold - cost });
      this.addItems(level, count);
      return { ok: true, progress: this.get() };
    },

    sell: function (level, count) {
      count = count || 1;
      if (this.getItemCount(level) < count) return { ok: false, reason: '数量不足' };
      var gain = LY.Params.sellPrice(level) * count;
      this.addItems(level, -count);
      var p = this.get();
      this.commit({ gold: (p.gold || 0) + gain });
      return { ok: true, gold: gain, progress: this.get() };
    },

    upgradeVehicle: function () {
      var p = this.get();
      var cost = LY.Vehicles.upgradeCost(p.vehicleTier || 1);
      if (!cost) return { ok: false, reason: '已满级' };
      if (this.getItemCount(cost.level) < cost.count) {
        return { ok: false, reason: '需要 ' + cost.count + ' 个 Lv' + cost.level };
      }
      this.addItems(cost.level, -cost.count);
      p = this.get();
      return { ok: true, progress: this.commit({ vehicleTier: (p.vehicleTier || 1) + 1 }) };
    },

    selectLevel: function (id) {
      var p = this.get();
      if (!LY.Levels.isUnlocked(id, p)) return { ok: false, reason: '尚未解锁' };
      return { ok: true, progress: this.commit({ selectedLevel: id }) };
    },

    recordRun: function (result) {
      var p = this.get();
      var stars = result.stars || 0;
      var gold = result.gold || 0;
      var stageId = result.levelId || 1;
      var stageStars = Object.assign({}, p.stageStars);
      stageStars[stageId] = Math.max(stageStars[stageId] || 0, stars);

      var inv = Object.assign({}, p.inventory);
      var drops = result.drops || [];
      for (var i = 0; i < drops.length; i++) {
        var lv = drops[i];
        var k = invKey(lv);
        inv[k] = (inv[k] || 0) + 1;
      }

      var patch = {
        runs: (p.runs || 0) + 1,
        bestDistance: Math.max(p.bestDistance || 0, result.distance | 0),
        gold: (p.gold || 0) + gold,
        stageStars: stageStars,
        inventory: inv,
        selectedLevel: stageId
      };

      if (result.survived) {
        var next = LY.Levels.nextId(stageId);
        var max = p.maxLevel || 1;
        if (next && next > max) {
          patch.maxLevel = next;
          patch.selectedLevel = next;
        } else {
          patch.maxLevel = Math.max(max, stageId);
        }
      }
      return this.commit(patch);
    },

    syncToCloud: function (progress) {
      if (!this._cloud || !global.wx || !global.wx.cloud) return;
      global.wx.cloud.callFunction({
        name: 'saveProgress',
        data: { progress: progress }
      }).catch(function () {});
    },

    pullFromCloud: function (cb) {
      cb = cb || function () {};
      if (!this._cloud || !global.wx || !global.wx.cloud) {
        cb(null, this.get());
        return;
      }
      var self = this;
      global.wx.cloud.callFunction({ name: 'getProgress', data: {} })
        .then(function (res) {
          var remote = res && res.result && res.result.progress;
          if (remote && remote.updatedAt > (self.get().updatedAt || 0)) {
            self._progress = parseLocal(remote);
            LY.Util.storage.set(localKey(), JSON.stringify(self._progress));
          }
          cb(null, self.get());
        })
        .catch(function (err) { cb(err, self.get()); });
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LY.Save;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
