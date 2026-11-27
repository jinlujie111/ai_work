/* 深林 · Deep Forest — 局域网静态服务器（零依赖）
   用法：node tools/serve.js [端口]
   手机与电脑连同一个 Wi-Fi，访问打印出来的地址即可试玩。 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'
};

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function (name) {
    (ifaces[name] || []).forEach(function (i) {
      if (i.family === 'IPv4' && !i.internal) out.push({ name: name, address: i.address });
    });
  });
  return out;
}

const server = http.createServer(function (req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }

  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', function () {
  console.log('');
  console.log('  深林 · Deep Forest  —— 局域网试玩服务已启动');
  console.log('  ───────────────────────────────────────────');
  console.log('  本机：  http://localhost:' + PORT);
  lanAddresses().forEach(function (i) {
    console.log('  手机：  http://' + i.address + ':' + PORT + '   (' + i.name + ')');
  });
  console.log('  ───────────────────────────────────────────');
  console.log('  手机需与电脑连同一个 Wi-Fi；按 Ctrl+C 停止');
  console.log('');
});