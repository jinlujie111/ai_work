/* 森林求生｜H5 浏览器端冒烟测试 */
(function () {
  var out = [], errors = [];
  function log(s) { out.push(s); }
  function ok(name, cond, extra) { log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : '')); }
  window.addEventListener('error', function (e) { errors.push('ERR: ' + (e.message || e.error)); });
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  window.addEventListener('load', function () {
    setTimeout(run, 400);
  });

  function run() {
    var g = window.forestSurvival;
    function step(list) {
      var i = 0;
      (function next() {
        if (i >= list.length) {
          log('ERRORS(' + errors.length + '): ' + (errors.join(' | ') || 'none'));
          document.getElementById('out').textContent = out.join('\n');
          document.title = 'DONE';
          return;
        }
        var s = list[i++];
        try { s.run(); } catch (e) { log('EXCEPTION@' + s.name + ': ' + e.message); }
        wait(s.wait || 120).then(next);
      })();
    }

    step([
      { name: '启动', wait: 0, run: function () {
        ok('游戏已启动', !!g, g ? 'state=' + g.state : 'no game');
        ok('选关界面可见', document.getElementById('sc-menu').classList.contains('active'), '');
        ok('关卡数量', document.getElementById('level-grid').children.length === 50, document.getElementById('level-grid').children.length);
      }},
      { name: '开局', run: function () {
        document.getElementsByClassName('lv')[0].click();
      }},
      { name: '游戏中', run: function () {
        ok('进入第一关', g.state === 'playing' && !!g.level, 'state=' + g.state);
        ok('HUD 显示体温条', document.getElementById('temp-fill').style.transform !== '', document.getElementById('temp-fill').style.transform);
        ok('HUD 显示倒计时', document.getElementById('timer').textContent.length > 0, document.getElementById('timer').textContent);
      }},
      { name: '拖动', wait: 600, run: function () {
        var p = g.level.player;
        var x0 = p.x;
        // 目标点取玩家左侧 400 设计像素（大于 120 的最大偏移，保证角色会走）
        var tx = (p.x - 400) * DF.Input.tx.scale + DF.Input.tx.ox;
        DF.Input.pointerDown(1, tx, 400);
        DF.Input.pointerMove(1, tx, 400);
        window.__x0 = x0;
      }},
      { name: '移动后', run: function () {
        var p = g.level.player;
        ok('角色随拖动移动', Math.abs(p.x - window.__x0) > 20, 'dx=' + (p.x - window.__x0).toFixed(1));
        DF.Input.pointerUp(1);
      }},
      { name: '结算', run: function () {
        g.level.finish(true, 'survive');
      }},
      { name: '结算态', run: function () {
        ok('结算界面出现', document.getElementById('sc-result').classList.contains('active'), '');
        ok('结算有星级', document.getElementById('result-stars').querySelectorAll('.ic').length === 3, '');
        ok('进度已保存', !!g.progress.levels['1'], JSON.stringify(g.progress.levels['1']));
      }},
      { name: '返回选关', run: function () {
        document.getElementById('btn-menu').click();
      }},
      { name: '回菜单', run: function () {
        ok('回到选关', g.state === 'menu' && document.getElementById('sc-menu').classList.contains('active'), 'state=' + g.state);
        ok('第一关已解锁', g.unlocked(2) === true, '');
      }}
    ]);
  }
})();