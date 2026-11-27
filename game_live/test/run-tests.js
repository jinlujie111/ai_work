/* 深林 · Deep Forest — 无头逻辑回归测试（Node + Chrome DevTools Protocol，零依赖） */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('未找到 Chrome / Edge');
}

const PORT = 9333 + (process.argv[3] ? parseInt(process.argv[3], 10) : 0);
const pageName = process.argv[2] || 'soak.html';
if (pageName === 'soak.html') require('./gen-test-pages.js');
if (pageName === 'minigame.html') require('./bundle-minigame.js');

const pageUrl = 'file:///' + path.resolve(__dirname, pageName).replace(/\\/g, '/');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'df-test-'));

const chrome = spawn(findChrome(), [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  '--window-size=1000,700',
  pageUrl
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await res.json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('无法连接 Chrome 调试端口');
}

(async function main() {
  let code = 1;
  try {
    const target = await findTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

    function send(method, params) {
      const myId = ++id;
      ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
      return new Promise(res => pending.set(myId, res));
    }

    await send('Runtime.enable');
    let out = '';
    for (let i = 0; i < 80; i++) {
      const r = await send('Runtime.evaluate', {
        expression: "(document.getElementById('out')||{}).textContent || ''",
        returnByValue: true
      });
      out = (r.result && r.result.result && r.result.result.value) || '';
      if (out.indexOf('ERRORS(') >= 0) break;
      await sleep(250);
    }
    console.log(out || '(没有拿到测试输出)');
    code = (out.indexOf('FAIL') >= 0 || out.indexOf('ERRORS(0)') < 0) ? 1 : 0;
    ws.close();
  } catch (e) {
    console.error('测试运行失败:', e.message);
    code = 1;
  } finally {
    try { chrome.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  process.exit(code);
})();