/* 深林 · Deep Forest — 打包成单个 HTML 文件
   把 CSS 与所有 JS 内联，产出一个可以直接传到手机上打开的独立文件。 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// 内联 CSS
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="styles\.css">/, '<style>\n' + css + '\n</style>');

// 内联 JS（保持顺序，模块靠全局 DF 命名空间协作）
const scripts = [...html.matchAll(/<script src="src\/([^"]+)"><\/script>/g)].map(m => m[1]);
for (const rel of scripts) {
  const code = fs.readFileSync(path.join(root, 'src', rel), 'utf8');
  html = html.replace(
    new RegExp('<script src="src/' + rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"><\\/script>'),
    '<script>\n' + code + '\n</script>'
  );
}

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'deep-forest-standalone.html');
fs.writeFileSync(outFile, html, 'utf8');

const left = html.match(/<script src="/g);
console.log('内联脚本: ' + scripts.length + ' 个' + (left ? '  ⚠ 仍有外链: ' + left.length : ''));
console.log('输出: ' + path.relative(root, outFile) + '  (' + (fs.statSync(outFile).size / 1024).toFixed(1) + ' KB)');