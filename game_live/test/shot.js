/* 无头截图工具：Chrome + DevTools Protocol，真实等待后截图
   用法：node test/shot.js <url> <out.png> [等待毫秒] [视口宽] [视口高] [前置脚本] */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));
if (!CHROME) { console.error('未找到 Chrome / Edge'); process.exit(1); }

const url = process.argv[2];
const out = process.argv[3];
const waitMs = parseInt(process.argv[4] || '2500', 10);
const vw = parseInt(process.argv[5] || '430', 10);
const vh = parseInt(process.argv[6] || '932', 10);
const preScript = process.argv[7] || '';
const PORT = 9500 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions',
  '--hide-scrollbars', '--mute-audio',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check',
  '--window-size=' + vw + ',' + vh, url
], { stdio: 'ignore' });

(async function main() {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { /* 还没起来 */ }
    if (!target) await sleep(250);
  }
  if (!target) { console.error('无法连接 Chrome'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params) => {
    const myId = ++id;
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
    return new Promise(res => pend.set(myId, res));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: vw, height: vh, deviceScaleFactor: 1, mobile: true
  });

  await sleep(waitMs);
  if (process.env.SHOT_DEBUG) {
    const dbg = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({rs:document.readyState,df:typeof DF,game:typeof window.forestSurvival,menu:document.getElementById("sc-menu").className,grid:document.getElementById("level-grid").children.length})',
      returnByValue: true
    });
    console.log('状态: ' + (dbg.result && dbg.result.result ? dbg.result.result.value : '?'));
  }
  if (preScript) {
    const r = await send('Runtime.evaluate', { expression: preScript, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      console.log('脚本异常: ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text));
    }
    const v = r.result && r.result.result ? r.result.result.value : '';
    if (v !== undefined && v !== '') console.log('脚本输出: ' + v);
    await sleep(700);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('已保存 ' + out + ' (' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB)');
  } else {
    console.error('截图失败');
  }
  ws.close();
  chrome.kill();
  process.exit(0);
})();