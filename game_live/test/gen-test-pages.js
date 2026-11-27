/* 从 index.html 生成测试页，避免与源码脱节 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function build(outName, injectFile, extraStyle) {
  let code = fs.readFileSync(path.join(__dirname, injectFile), 'utf8');
  let inject = '<script>' + code + '</script>';
  let html = indexHtml.replace('</body>', inject + '\n</body>');
  html = html.replace(/href="styles\.css"/g, 'href="../styles.css"')
             .replace(/src="src\//g, 'src="../src/');
  if (extraStyle) {
    html = html.replace('<body>', '<body><style>' + extraStyle + '</style>');
  }
  const probe = '<pre id="out" style="position:fixed;left:0;top:0;z-index:999;background:#000;color:#0f0;font:13px monospace;padding:8px;white-space:pre"></pre>';
  html = html.replace('<body>', '<body>' + probe);
  fs.writeFileSync(path.join(__dirname, outName), html, 'utf8');
  console.log('generated test/' + outName);
}

build('soak.html', 'soak-script.js');