/* 从 src/spec/levels.js 生成 doc/level-design.md
   文档与代码同源，改关卡请改代码后重新生成。
   用法：node tools/gen-level-doc.js */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

global.window = global;
function load(rel) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, require);
  return module.exports;
}
load('src/util.js');
const Levels = load('src/spec/levels.js');

const TPL_NAME = {
  clearing: '开阔草地', grove: '密集树林', pond: '水潭区',
  corridor: '狭窄通道', den: '领地中心'
};
const ANIMAL_NAME = { bear: '熊', snake: '蛇', rabbit: '兔' };
const MODE_NAME = { always: '始终追击', night: '仅夜间追击', patrol: '只巡逻不追击' };
const RES_NAME = { berry: '浆果', gold: '金浆果', wood: '木头', herb: '药草' };

function animalText(list) {
  const groups = [];
  (list || []).forEach(function (s) {
    const p = s.split(':');
    const type = p[0], count = parseInt(p[1], 10) || 1, mode = p[2] || 'always';
    const key = type + ':' + count + ':' + mode;
    let hit = groups.filter(function (g) { return g.key === key; })[0];
    if (!hit) { hit = { key: key, type: type, count: count, mode: mode }; groups.push(hit); }
    else hit.count++;
  });
  return groups.map(function (g) {
    return ANIMAL_NAME[g.type] + ' ' + g.count + ' 只（' + MODE_NAME[g.mode] + '）';
  }).join('、') || '无';
}

function resText(res) {
  const out = [];
  for (const k of ['berry', 'gold', 'wood', 'herb']) {
    if (res && res[k]) out.push(RES_NAME[k] + ' ' + res[k]);
  }
  if (res && res.goldOnBearPath) out.push('金浆果刷在熊的巡逻路线上');
  return out.join('、') || '无';
}

const lines = [];
lines.push('# 森林求生｜关卡设计表');
lines.push('');
lines.push('> 本文件由 `node tools/gen-level-doc.js` 从 `src/spec/levels.js` 生成，与代码同源。');
lines.push('> 改关卡请改 `src/spec/levels.js` 后重新生成，不要手改这里。');
lines.push('');
lines.push('设计依据：`doc/game-design-spec.md` 第四章（结构与目标）、2.2（地图模板）、2.3（昼夜）、4.3（难度曲线）。');
lines.push('');

lines.push('## 一、规则速查');
lines.push('');
lines.push('所有关卡共用下面这一套规则，关卡之间只改「地图、时长、动物、资源、目标、星星条件」。');
lines.push('');
lines.push('| 规则 | 内容 |');
lines.push('| --- | --- |');
lines.push('| 操作 | 单指按住拖动，角色朝手指位置移动，最大偏移 120 像素，松手停下。没有其他按键。 |');
lines.push('| 目标 | 每关收敛成一句话，完成即过关。资源是手段，不是目标。 |');
lines.push('| 采集 | 走到资源上自动采集，耗时 0.8 秒，拾取半径 28。被熊惊动会中断，资源不消失。 |');
lines.push('| 体温 | 上限 100。白天不变，夜里火堆内每秒 +6、火堆外每秒 -2.5，归零即失败。 |');
lines.push('| 火堆 | 位置固定不可移动，保温半径 180，每 10 秒烧掉 1 根木头，熄灭后不再回温。 |');
lines.push('| 木头 | 采到后必须送到火堆才生效，没有背包，走过去自动交付。 |');
lines.push('| 药草 | 解除蛇毒。 |');
lines.push('| 熊 | 巡逻到警觉到追击到搜索。感知 260，视锥 90 度，接触 34 即被抓。 |');
lines.push('| 蛇 | 完全静止伏击，触发半径 46，咬击延迟 0.4 秒，中毒扣 30 体温、3 秒后自解。 |');
lines.push('| 兔 | 300 像素内逃跑，捕获得 2 分，被抓在手里可以引开追击中的熊 4 秒。 |');
lines.push('| 昼夜 | 白天视野全开，夜里视野缩到 320 像素圆形，外侧亮度 25%。 |');
lines.push('| 星级 | 每关三条，达成型条件；第一条「完成主目标」必选。 |');
lines.push('| 失败 | 体温归零、被熊抓���、超时未达目标。 |');
lines.push('');

lines.push('## 二、章节总览');
lines.push('');
lines.push('| 章 | 名称 | 关卡 | 模板 | 主题 | 重点 |');
lines.push('| --- | --- | --- | --- | --- | --- |');
const CH = {
  1: '基础：移动、采集、昼夜、火堆',
  2: '蛇出场，机制两两叠加',
  3: '水潭地形决定路线',
  4: '熊的领地，多熊巡逻',
  5: '综合与约束'
};
Levels.CHAPTERS.forEach(function (c, i) {
  const from = i * 10 + 1, to = i * 10 + 10;
  lines.push('| ' + (i + 1) + ' | ' + c.name + ' | ' + from + ' 到 ' + to + ' | ' +
    c.templates.map(function (t) { return TPL_NAME[t]; }).join('、') + ' | ' + c.theme + ' | ' + CH[i + 1] + ' |');
});
lines.push('');

for (let ci = 0; ci < Levels.CHAPTERS.length; ci++) {
  const c = Levels.CHAPTERS[ci];
  lines.push('## 第' + '一二三四五'[ci] + '章 ' + c.name);
  lines.push('');
  for (let id = ci * 10 + 1; id <= ci * 10 + 10; id++) {
    const cfg = Levels.get(id);
    if (!cfg) continue;
    const night = cfg.duration - cfg.dayLength;
    lines.push('### 第 ' + id + ' 关 ' + cfg.name);
    lines.push('');
    lines.push('| 项 | 内容 |');
    lines.push('| --- | --- |');
    lines.push('| 模板 | ' + TPL_NAME[cfg.template] + ' |');
    lines.push('| 时长 | ' + cfg.duration + ' 秒（白天 ' + cfg.dayLength + ' 秒' +
      (night > 0 ? '，夜晚 ' + night + ' 秒' : '，无夜晚') + '） |');
    lines.push('| 动物 | ' + animalText(cfg.__rawAnimals) + ' |');
    lines.push('| 资源 | ' + resText(cfg.resources) + ' |');
    lines.push('| 火堆 | ' + (cfg.fires ? cfg.fires + ' 个' : '无') + ' |');
    lines.push('| 目标 | ' + cfg.goalText + ' |');
    lines.push('| 三星 | ' + cfg.stars.map(function (s) { return Levels.starText(s); }).join(' / ') + ' |');
    lines.push('| 教学目的 | ' + cfg.teach + ' |');
    lines.push('');
  }
}

fs.writeFileSync(path.join(root, 'doc', 'level-design.md'), lines.join('\n'), 'utf8');
console.log('已生成 doc/level-design.md（' + lines.length + ' 行）');