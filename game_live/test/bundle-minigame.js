/* 把小游戏源码打成一个可在浏览器里加载的 CommonJS 包（仅用于自动化测试） */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

const FILES = [
  'src/util.js', 'src/audio.js', 'src/input.js',
  'src/spec/params.js', 'src/spec/levels.js',
  'src/game/entities.js', 'src/game/level.js', 'src/game/render.js', 'src/game/core.js',
  'src/ui/canvas.js', 'src/boot/minigame.js'
];

let out = '';
out += '/* 自动生成，请勿手改：node test/bundle-minigame.js */\n';
out += '(function () {\n';
out += 'var __mods = {}, __cache = {};\n';
out += 'function __resolve(base, rel) {\n';
out += '  if (rel.charAt(0) !== ".") return rel.replace(/\\.js$/, "");\n';
out += '  var dir = base.split("/"); dir.pop();\n';
out += '  var segs = rel.split("/");\n';
out += '  for (var i = 0; i < segs.length; i++) {\n';
out += '    var s = segs[i];\n';
out += '    if (s === "." || s === "") continue;\n';
out += '    if (s === "..") dir.pop(); else dir.push(s);\n';
out += '  }\n';
out += '  return dir.join("/");\n';
out += '}\n';
out += 'function __req(rel, from) {\n';
out += '  var name = __resolve(from || "", rel).replace(/\\.js$/, "");\n';
out += '  if (__cache[name]) return __cache[name].exports;\n';
out += '  var m = __cache[name] = { exports: {} };\n';
out += '  __mods[name](m, m.exports, function (r) { return __req(r, name); });\n';
out += '  return m.exports;\n';
out += '}\n';

for (const f of FILES) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  const name = f.replace(/\.js$/, '');
  out += '__mods[' + JSON.stringify(name) + '] = function (module, exports, require) {\n';
  out += code;
  out += '\n};\n';
}

out += 'window.__mgRequire = __req;\n';
out += 'window.__mgBoot = function () { return __req("src/boot/minigame.js", ""); };\n';
out += '})();\n';

fs.writeFileSync(path.join(__dirname, 'minigame-bundle.js'), out, 'utf8');
console.log('bundled ' + FILES.length + ' modules -> test/minigame-bundle.js');