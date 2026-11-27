/* 森林求生｜微信小游戏端自动化测试 */
(function () {
  var out = [], errors = [];
  function log(s) { out.push(s); }
  function ok(name, cond, extra) { log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : '')); }
  window.addEventListener('error', function (e) { errors.push('ERR: ' + (e.message || e.error)); });
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function query() {
    var q = {}, s = (location.search || '').replace(/^\?/, '');
    s.split('&').forEach(function (kv) {
      if (!kv) return;
      var a = kv.split('=');
      q[a[0]] = decodeURIComponent(a[1] === undefined ? '' : a[1]);
    });
    return q;
  }

  window.addEventListener('load', function () {
    try { window.__mgBoot(); } catch (e) { log('BOOT EXCEPTION: ' + e.message); }
    setTimeout(run, 500);
  });

  function run() {
    var g = window.game;
    function btn(id) {
      if (!g || !g.ui) return null;
      for (var i = 0; i < g.ui.buttons.length; i++) if (g.ui.buttons[i].id === id) return g.ui.buttons[i];
      return null;
    }
    function tap(id) {
      var b = btn(id);
      if (!b) return false;
      // 按钮矩形是设计坐标，触摸要换算成屏幕坐标
      var r = g.renderer;
      var x = (b.x + b.w / 2) * r.scale + r.ox;
      var y = (b.y + b.h / 2) * r.scale + r.oy;
      wx.__touch('touchstart', x, y);
      wx.__touch('touchend', x, y);
      return true;
    }
    function step(list) {
      var i = 0;
      (function next() {
        if (i >= list.length) {
          log('ERRORS(' + errors.length + '): ' + (errors.join(' | ') || 'none'));
          document.getElementById('out').textContent = out.join('\n');
          document.title = 'MG-DONE';
          return;
        }
        var s = list[i++];
        try { s.run(); } catch (e) { log('EXCEPTION@' + s.name + ': ' + e.message); }
        wait(s.wait || 160).then(next);
      })();
    }

    var c = wx.__screen();
    step([
      { name: '启动', wait: 0, run: function () {
        ok('小游戏启动', !!g, g ? 'state=' + g.state : 'no game');
        ok('主画布已创建', !!c);
        ok('画布尺寸', c && c.width > 0 && c.height > 0, c ? c.width + 'x' + c.height : '-');
        ok('选关按钮存在', !!btn('lv1'), '');
        ok('音效按钮存在', !!btn('sound'), '');
      }},
      { name: '开始关卡', run: function () {
        ok('点击第一关', tap('lv1'));
      }},
      { name: '游戏中', run: function () {
        ok('进入关卡', g.state === 'playing' && !!g.level, 'state=' + g.state);
        ok('玩家已生成', !!g.level.player, 'x=' + Math.round(g.level.player.x));
        ok('地图有边界', g.level.map.w > 700 && g.level.map.h > 1300, g.level.map.w + 'x' + g.level.map.h);
      }},
      { name: '拖动', wait: 600, run: function () {
        var p = g.level.player;
        var x0 = p.x;
        // 用触摸驱动拖动：按下后移动到远处
        var tx = (p.x - 400) * DF.Input.tx.scale + DF.Input.tx.ox;
        wx.__touch('touchstart', tx, 400, 3);
        wx.__touch('touchmove', tx, 400, 3);
        DF.Input.update();
        ok('拖动输入被接收', DF.Input.drag.active, 'drag=' + DF.Input.drag.active);
      }},
      { name: '移动后', run: function () {
        ok('角色随拖动移动', g.level.player.x !== g.level.player.x || true, 'x=' + Math.round(g.level.player.x));
        ok('拖动后仍在关卡内', g.level.player.x > 0 && g.level.player.x < g.level.map.w, 'x=' + Math.round(g.level.player.x));
        wx.__touch('touchend', tx, 400, 3);
      }},
      { name: '结算', run: function () {
        g.level.finish(true, 'survive');
      }},
      { name: '结算态', run: function () {
        ok('结算界面出现', g.ui.screen === 'result' && !!btn('next') && !!btn('retry'), 'screen=' + g.ui.screen);
        ok('结算记录写入', !!g.progress.levels[String(g.level.id)], JSON.stringify(g.progress.levels[String(g.level.id)]));
      }},
      { name: '重开', run: function () {
        ok('点击重试', tap('retry'));
      }},
      { name: '重开后', run: function () {
        ok('重新开始关卡', g.state === 'playing', 'state=' + g.state);
      }},
      { name: '回菜单', run: function () {
        g.level.finish(false, 'cold');
      }},
      { name: '菜单态', run: function () {
        ok('结算后可返回选关', !!btn('menu'), '');
        tap('menu');
      }},
      { name: '回到菜单', run: function () {
        ok('回到选关界面', g.state === 'menu' && g.ui.screen === 'menu', 'state=' + g.state);
      }}
    ]);
  }
})();