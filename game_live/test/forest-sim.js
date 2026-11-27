/* 森林求生｜关卡逻辑模拟（Node，无需浏览器） */
'use strict';
const path = require('path');
const root = path.resolve(__dirname, '..');
global.window = global;
global.GameGlobal = undefined;

function load(rel) {
  const code = require('fs').readFileSync(path.join(root, rel), 'utf8');
  const module = { exports: {} };
  const fn = new Function('module', 'exports', 'require', code + '\nreturn module.exports;');
  const out = fn(module, module.exports, require);
  return out;
}

load('src/util.js');
load('src/spec/params.js');
load('src/spec/levels.js');
load('src/game/entities.js');
load('src/game/level.js');

const DF = global.DF;
const P = DF.Params;
const U = DF.Util;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
}

function makeLevel(id) {
  const cfg = Object.assign({}, DF.Levels.get(id));
  cfg.id = id;
  cfg.seed = (id * 2654435761) >>> 0;
  const bus = U.emitter();
  const level = new DF.Level(cfg, bus);
  return { level, bus };
}

function step(level, bus, seconds, drive) {
  const dt = 1 / 60;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    const ctx = {
      dragActive: !!drive,
      dragPoint: drive ? drive(level, i) : { x: 0, y: 0 },
      world: level.world, player: level.player, night: level.night, bus,
      onCaught: (bear) => level.onCaught(bear)
    };
    level.update(dt, ctx);
    if (level.status !== 'playing') break;
  }
}

/* ── 1. 关卡构建 ── */
{
  const { level } = makeLevel(1);
  ok('第一关模板为 clearing', level.map.template === 'clearing');
  ok('第一关有 5 个浆果', level.resources.filter(r => r.res === 'berry').length === 5, level.resources.length);
  ok('第一关有 1 只熊', level.animals.filter(a => a.type === 'bear').length === 1);
  ok('出生点离熊至少 260', level.animals.every(a => U.dist(a.x, a.y, level.map.spawn.x, level.map.spawn.y) >= 260));
  ok('资源不落在树上', level.resources.every(r => level.map.trees.every(t => U.dist(r.x, r.y, t.x, t.y) > 55)));
}

/* ── 2. 拖动移动：朝手指走，120 像素内停下 ── */
{
  const { level, bus } = makeLevel(1);
  const p = level.player;
  const x0 = p.x;
  const target = { x: p.x + 400, y: p.y };      // 固定目标点
  step(level, bus, 1.0, () => target);
  ok('拖动后角色移动', p.x > x0 + 60, 'dx=' + (p.x - x0).toFixed(1));
  step(level, bus, 3.0, () => target);
  const dist = U.dist(p.x, p.y, target.x, target.y);
  ok('靠近手指后停住（最大偏移 120）', dist < 150, 'dist=' + dist.toFixed(1));
}

/* ── 3. 键盘等价输入 ── */
{
  const { level, bus } = makeLevel(1);
  const p = level.player;
  const y0 = p.y;
  step(level, bus, 0.5, () => ({ x: p.x, y: p.y - 400 }));
  ok('向上拖动改变 y', p.y < y0 - 30, 'dy=' + (p.y - y0).toFixed(1));
}

/* ── 4. 自动采集 0.8 秒 ── */
{
  const { level, bus } = makeLevel(1);
  const berry = level.resources.find(r => r.res === 'berry');
  level.player.x = berry.x; level.player.y = berry.y;
  step(level, bus, 0.4, () => ({ x: berry.x, y: berry.y }));
  ok('0.4 秒时未采集完成', level.stats.collect === 0, 'collect=' + level.stats.collect);
  step(level, bus, 0.6, () => ({ x: berry.x, y: berry.y }));
  ok('0.8 秒后采集完成', level.stats.collect === 1 && level.stats.score >= 1,
    'collect=' + level.stats.collect + ' score=' + level.stats.score);
  ok('浆果回温', level.player.temp >= 100, 'temp=' + level.player.temp);
}

/* ── 5. 采集被惊动时取消 ── */
{
  const { level, bus } = makeLevel(1);
  const berry = level.resources.find(r => r.res === 'berry');
  const bear = level.animals.find(a => a.type === 'bear');
  bear.x = berry.x + 60; bear.y = berry.y; bear.state = 'CHASE'; bear.seen = true;
  level.player.x = berry.x; level.player.y = berry.y;
  step(level, bus, 0.5, () => ({ x: berry.x, y: berry.y }));
  ok('被惊动时采集取消', level.stats.collect === 0 && berry.alive, 'collect=' + level.stats.collect);
}

/* ── 6. 夜晚掉温与火堆回温 ── */
{
  const { level, bus } = makeLevel(2);
  level.time = level.dayLength; level.night = true;
  const p = level.player;
  p.temp = 50;
  const fire = level.fires[0];
  p.x = fire.x; p.y = fire.y;
  step(level, bus, 1.0, () => ({ x: fire.x, y: fire.y }));
  ok('火堆内回温', p.temp > 50, 'temp=' + p.temp.toFixed(1));

  p.x = fire.x + 400; p.y = fire.y;
  p.temp = 50;
  step(level, bus, 1.0, () => ({ x: p.x, y: p.y }));
  ok('火堆外掉温', p.temp < 50, 'temp=' + p.temp.toFixed(1));
}

/* ── 7. 体温归零判负 ── */
{
  const { level, bus } = makeLevel(2);
  level.time = level.dayLength; level.night = true;
  level.player.temp = 0.4;
  level.player.x = level.fires[0].x + 500;
  step(level, bus, 1.0, () => ({ x: level.player.x, y: level.player.y }));
  ok('体温归零判负', level.status === 'lost' && level.result.reason === 'cold', level.status + '/' + (level.result && level.result.reason));
}

/* ── 8. 熊的追击与接触判定 ── */
{
  const { level, bus } = makeLevel(3);
  const bear = level.animals.find(a => a.type === 'bear');
  const p = level.player;
  bear.x = p.x + 150; bear.y = p.y;
  bear.facing = Math.atan2(p.y - bear.y, p.x - bear.x);
  step(level, bus, 0.5, () => ({ x: p.x, y: p.y }));
  ok('熊进入追击状态', bear.state === 'CHASE' || bear.state === 'SUSPICIOUS', bear.state);
  bear.x = p.x + 20; bear.y = p.y;
  step(level, bus, 0.2, () => ({ x: p.x, y: p.y }));
  ok('接触熊被抓', level.status === 'lost' && level.result.reason === 'caught', level.status);
}

/* ── 9. 蛇的伏击与中毒 ── */
{
  const { level, bus } = makeLevel(12);
  const snake = level.animals.find(a => a.type === 'snake');
  ok('第十二关有蛇', !!snake);
  if (snake) {
    level.resources.length = 0;      // 避免顺带采到浆果干扰体温判定
    const p = level.player;
    p.x = snake.x + 20; p.y = snake.y;
    const t0 = p.temp;
    step(level, bus, 1.0, () => ({ x: p.x, y: p.y }));
    ok('蛇咬击扣体温 30', p.temp <= t0 - 29, 'temp=' + p.temp.toFixed(1));
    ok('中毒状态存在', p.poison > 0, 'poison=' + p.poison.toFixed(2));
  }
}

/* ── 10. 兔子的诱饵耦合 ── */
{
  const { level, bus } = makeLevel(4);
  const bear = level.animals.find(a => a.type === 'bear');
  const rabbit = level.animals.find(a => a.type === 'rabbit');
  ok('第四关有兔', !!rabbit);
  if (bear && rabbit) {
    bear.state = 'CHASE'; bear.stateT = 0;
    bear.x = rabbit.x + 100; bear.y = rabbit.y;
    rabbit.x = bear.x + 100; rabbit.y = bear.y;
    const before = bear.decoyTarget;
    step(level, bus, 0.2, () => ({ x: level.player.x, y: level.player.y }));
    ok('熊被兔子引开', bear.decoyTarget === rabbit || bear.decoyT > 0,
      'decoyT=' + bear.decoyT.toFixed(2) + ' target=' + (bear.decoyTarget === rabbit));
  }
}

/* ── 11. 目标判定：collect ── */
{
  const { level, bus } = makeLevel(1);
  const berries = level.resources.filter(r => r.res === 'berry').slice(0, 3);
  for (const b of berries) {
    level.player.x = b.x; level.player.y = b.y;
    step(level, bus, 1.0, () => ({ x: b.x, y: b.y }));
  }
  ok('达成采集目标即通关', level.status === 'won', level.status + ' collect=' + level.stats.collect);
  ok('三星结构存在', level.result && level.result.stars.length === 3);
  ok('通关星为真', level.result.stars[0] === true);
}

/* ── 12. 目标判定：survive ── */
{
  const { level, bus } = makeLevel(2);
  level.time = level.duration - 0.05;
  step(level, bus, 0.2, () => ({ x: level.player.x, y: level.player.y }));
  ok('撑到结束即通关', level.status === 'won', level.status);
}

/* ── 13. 星级条件：time / undetected ── */
{
  const { level, bus } = makeLevel(1);
  level.time = level.duration - 0.05;
  level.player.x = level.resources[0].x; level.player.y = level.resources[0].y;
  level.stats.collect = 3;
  step(level, bus, 0.2, () => ({ x: level.player.x, y: level.player.y }));
  ok('时间星可判定', level.result.stars[1] === (level.time <= 30), 'time=' + level.time.toFixed(1));
  ok('未被熊发现星为真', level.result.stars[2] === true);
}

/* ── 14. 地图模板全部可生成 ── */
{
  let okAll = true, detail = [];
  for (const name of Object.keys(DF.Levels.TEMPLATES)) {
    const map = DF.Levels.buildMap(name, 12345);
    if (!map.trees || !map.spawn) { okAll = false; detail.push(name); }
    for (const t of map.trees) {
      if (t.x < 0 || t.y < 0 || t.x > map.w || t.y > map.h) { okAll = false; detail.push(name + ':out'); }
    }
  }
  ok('五个模板都能生成', okAll, detail.join(','));
}

/* ── 15. 全部 50 关都能构建 ── */
{
  let bad = [];
  for (let i = 1; i <= 50; i++) {
    try {
      const { level } = makeLevel(i);
      if (!level.resources && !level.animals) bad.push(i);
    } catch (e) { bad.push(i + ':' + e.message); }
  }
  ok('50 关全部可构建', bad.length === 0, bad.slice(0, 3).join(','));
}

/* ── 16. 关卡数据完整性 ── */
{
  const STAR_IDS = { complete: 1, time: 1, undetected: 1, no_damage: 1, no_damage_night: 1,
    gold: 1, decoy_used: 1, fire_alive: 1, temp: 1, herb_used: 1 };
  let bad = [];
  for (let i = 1; i <= 50; i++) {
    const cfg = DF.Levels.get(i);
    if (!cfg) { bad.push(i + ':缺配置'); continue; }
    if (!cfg.name || !cfg.teach || !cfg.goalText) bad.push(i + ':缺规则文案');
    if (!cfg.goal || !cfg.goal.type) bad.push(i + ':缺目标');
    if (!cfg.stars || cfg.stars.length !== 3) bad.push(i + ':星星不是三条');
    if (cfg.stars) {
      cfg.stars.forEach(function (s) {
        if (!STAR_IDS[s.id]) bad.push(i + ':未知星星 ' + s.id);
      });
      if (cfg.stars[0].id !== 'complete') bad.push(i + ':第一条星星必须是完成主目标');
    }
    // 目标与资源要匹配
    const res = cfg.resources || {};
    if (cfg.goal.type === 'gold' && !res.gold) bad.push(i + ':金浆果目标但没刷金浆果');
    if (cfg.goal.type === 'herb' && !res.herb) bad.push(i + ':药草目标但没刷药草');
    if (cfg.goal.type === 'collect' && !res.berry && !res.gold) bad.push(i + ':采集目标但没有可采资源');
    // 星星条件与关卡配置要匹配
    const types = (cfg.animals || []).map(function (a) { return a.type; });
    if (cfg.stars) cfg.stars.forEach(function (s) {
      if (s.id === 'decoy_used' && types.indexOf('rabbit') < 0) bad.push(i + ':诱饵星但没有兔子');
      if (s.id === 'fire_alive' && !cfg.fires) bad.push(i + ':火堆星但没有火堆');
      if (s.id === 'undetected' && types.indexOf('bear') < 0) bad.push(i + ':未被发现星但没有熊');
      if (s.id === 'time' && s.value >= cfg.duration) bad.push(i + ':限时星不小于关卡时长');
    });
  }
  ok('50 关规则与星星条件自洽', bad.length === 0, bad.slice(0, 4).join(','));
}

/* ── 17. 每关都能真正开局并跑起来 ── */
{
  let bad = [];
  for (let i = 1; i <= 50; i++) {
    try {
      const { level, bus } = makeLevel(i);
      step(level, bus, 3, null);
      if (level.status !== 'playing') bad.push(i + ':开局就结束');
      if (!level.resources.length && !level.animals.length) bad.push(i + ':空关卡');
    } catch (e) { bad.push(i + ':' + e.message); }
  }
  ok('50 关都能正常开局', bad.length === 0, bad.slice(0, 4).join(','));
}

console.log('\n通过 ' + pass + '，失败 ' + fail);
process.exit(fail === 0 ? 0 : 1);