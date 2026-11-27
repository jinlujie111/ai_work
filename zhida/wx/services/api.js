const config = require('../utils/config');

const TOKEN_KEY = `${config.storagePrefix}token`;
const USER_KEY = `${config.storagePrefix}user`;

function getAppSafe() {
  try {
    return getApp();
  } catch (e) {
    return null;
  }
}

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || '';
}

function setSession(token, user) {
  wx.setStorageSync(TOKEN_KEY, token || '');
  if (user) wx.setStorageSync(USER_KEY, user);
}

function clearSession() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
}

function apiBase() {
  const app = getAppSafe();
  if (app && app.globalData && app.globalData.apiBase) {
    return app.globalData.apiBase;
  }
  return config.apiBase || '';
}

function request({ url, method = 'GET', data = {}, auth = true }) {
  const base = apiBase();
  if (!base) {
    return Promise.reject(new Error('apiBase 未配置，请检查 utils/config.js'));
  }
  const header = { 'content-type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) header.Authorization = `Bearer ${token}`;
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${base}${url}`,
      method,
      data,
      header,
      timeout: config.requestTimeout || 60000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // ICS / 纯文本接口直接返回字符串
          resolve(res.data);
          return;
        }
        const detail =
          (res.data && (res.data.detail || res.data.message)) ||
          `HTTP ${res.statusCode}`;
        reject(new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)));
      },
      fail: reject
    });
  });
}

function ensureLogin() {
  const app = getAppSafe();
  if (app && app.globalData && app.globalData.forceLoggedOut) {
    return Promise.reject(new Error('已退出登录'));
  }
  if (getToken()) return Promise.resolve(getToken());
  if (app && typeof app.ensureLogin === 'function') {
    return app.ensureLogin();
  }
  return Promise.reject(new Error('未登录'));
}

function decodeChunk(buf) {
  try {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(buf);
    }
  } catch (e) {
    /* ignore */
  }
  try {
    const arr = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    let s = '';
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return decodeURIComponent(escape(s));
  } catch (e2) {
    return '';
  }
}

/**
 * NDJSON 流式请求（微信 enableChunked）。
 * onEvent(ev) 收到每一行 JSON；最终 resolve done.data。
 */
function requestStream({ url, method = 'POST', data = {}, onEvent }) {
  const base = apiBase();
  if (!base) {
    return Promise.reject(new Error('apiBase 未配置，请检查 utils/config.js'));
  }
  const header = { 'content-type': 'application/json' };
  const token = getToken();
  if (token) header.Authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    let gotChunk = false;
    let donePayload = null;

    const finishOk = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    const finishErr = (err) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err || '请求失败')));
    };

    const handleLine = (line) => {
      const text = (line || '').trim();
      if (!text) return;
      let ev;
      try {
        ev = JSON.parse(text);
      } catch (e) {
        return;
      }
      if (typeof onEvent === 'function') {
        try {
          onEvent(ev);
        } catch (e2) {
          /* ignore ui errors */
        }
      }
      if (ev.event === 'done') donePayload = ev.data;
      if (ev.event === 'error') finishErr(ev.message || '失败');
    };

    const consume = (chunkText) => {
      buffer += chunkText || '';
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';
      parts.forEach(handleLine);
    };

    const task = wx.request({
      url: `${base}${url}`,
      method,
      data,
      header,
      timeout: Math.max(config.requestTimeout || 120000, 180000),
      enableChunked: true,
      success(res) {
        if (buffer) {
          handleLine(buffer);
          buffer = '';
        }
        // 部分环境不触发 chunk，整包在 success
        if (!gotChunk && res && res.data) {
          if (typeof res.data === 'string') {
            consume(res.data);
          } else if (typeof res.data === 'object' && res.data.event) {
            handleLine(JSON.stringify(res.data));
          } else if (typeof res.data === 'object' && res.data.goal) {
            // 兼容非流式回落
            finishOk(res.data);
            return;
          }
        }
        if (donePayload) {
          finishOk(donePayload);
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && !settled) {
          finishErr('流式响应未完成');
          return;
        }
        if (!settled) {
          const detail =
            (res.data && (res.data.detail || res.data.message)) ||
            `HTTP ${res.statusCode}`;
          finishErr(detail);
        }
      },
      fail(err) {
        finishErr((err && err.errMsg) || '网络错误');
      }
    });

    if (task && typeof task.onChunkReceived === 'function') {
      task.onChunkReceived((res) => {
        gotChunk = true;
        consume(decodeChunk(res.data));
        if (donePayload && !settled) {
          // 等 success 再 resolve，避免半包；若长时间无 success，下面保险
        }
      });
    }
  });
}

module.exports = {
  TOKEN_KEY,
  USER_KEY,
  getToken,
  setSession,
  clearSession,
  request,
  requestStream,
  ensureLogin,
  apiBase
};
