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

function toUint8(buf) {
  if (!buf || typeof buf === 'string') return null;
  if (typeof Uint8Array !== 'undefined' && buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (typeof buf.byteLength === 'number') {
    try {
      return new Uint8Array(buf);
    } catch (e) {
      return null;
    }
  }
  return null;
}

/** 同一次请求共用一个解码器，避免分片把中文从字节中间切开。 */
function createStreamDecoder() {
  let decoder = null;
  if (typeof TextDecoder !== 'undefined') {
    try {
      decoder = new TextDecoder('utf-8');
    } catch (e) {
      decoder = null;
    }
  }
  return {
    decode(buf, flush) {
      if (typeof buf === 'string') return buf;
      const bytes = toUint8(buf);
      if (decoder) {
        try {
          return decoder.decode(bytes || new Uint8Array(0), { stream: !flush });
        } catch (e) {
          /* fall through */
        }
      }
      if (!bytes || !bytes.length) return '';
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      try {
        return decodeURIComponent(escape(s));
      } catch (e2) {
        return '';
      }
    }
  };
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
    let tailTimer = null;
    const streamDecoder = createStreamDecoder();

    const finishOk = (payload) => {
      if (settled) return;
      settled = true;
      if (tailTimer) clearTimeout(tailTimer);
      resolve(payload);
    };
    const finishErr = (err) => {
      if (settled) return;
      settled = true;
      if (tailTimer) clearTimeout(tailTimer);
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
      if (ev.event === 'done') {
        donePayload = ev.data;
        finishOk(donePayload);
      }
      if (ev.event === 'error') finishErr(ev.message || '失败');
    };

    const salvage = (data) => {
      if (donePayload || settled || data == null || data === '') return;
      let text = '';
      if (typeof data === 'string') text = data;
      else if (toUint8(data)) {
        try {
          text = new TextDecoder('utf-8').decode(toUint8(data));
        } catch (e) {
          text = '';
        }
      } else if (typeof data === 'object' && data.event) {
        handleLine(JSON.stringify(data));
        return;
      } else if (typeof data === 'object' && data.goal) {
        finishOk(data);
        return;
      } else {
        return;
      }
      text.split('\n').forEach((line) => {
        const t = (line || '').trim();
        if (!t || t.charAt(0) !== '{') return;
        if (t.indexOf('"done"') < 0 && t.indexOf('"error"') < 0) return;
        handleLine(t);
      });
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
        // 开发者工具经常不回调 onChunkReceived，整包在 success
        if (!gotChunk && res && res.data) {
          if (typeof res.data === 'string') consume(res.data);
          else salvage(res.data);
        } else if (res && res.data) {
          salvage(res.data);
        }
        if (donePayload || settled) return;
        if (!(res.statusCode >= 200 && res.statusCode < 300)) {
          const detail =
            (res.data && (res.data.detail || res.data.message)) ||
            `HTTP ${res.statusCode}`;
          finishErr(detail);
          return;
        }
        // 最后一片可能晚于 success；未收齐前不要把半行丢掉
        tailTimer = setTimeout(() => {
          if (settled) return;
          const rest = streamDecoder.decode(null, true);
          if (rest) consume(rest);
          if (buffer) {
            handleLine(buffer);
            buffer = '';
          }
          if (donePayload) finishOk(donePayload);
          else finishErr('流式响应未完成');
        }, 600);
      },
      fail(err) {
        finishErr((err && err.errMsg) || '网络错误');
      }
    });

    if (task && typeof task.onChunkReceived === 'function') {
      task.onChunkReceived((res) => {
        gotChunk = true;
        consume(streamDecoder.decode(res && res.data, false));
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
