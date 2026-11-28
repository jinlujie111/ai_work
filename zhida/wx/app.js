const api = require('./services/api');
const config = require('./utils/config');

function isDevOrTrialClient() {
  try {
    const info = wx.getAccountInfoSync();
    const v = (info.miniProgram && info.miniProgram.envVersion) || '';
    return v === 'develop' || v === 'trial';
  } catch (e) {
    return false;
  }
}

App({
  globalData: {
    config,
    apiBase: config.apiBase,
    user: null,
    // 用户主动退出后为 true，阻止静默重登，直到点「登录」
    forceLoggedOut: false
  },

  onLaunch() {
    if (this.globalData.forceLoggedOut) return;
    this.ensureLogin().catch((err) => {
      console.warn('login failed', err);
      // 开发者工具里避免一启动就弹失败；「我的」页点登录再提示
      if (!isDevOrTrialClient()) {
        wx.showToast({
          title: (err && err.message) || '微信登录失败',
          icon: 'none',
          duration: 2500
        });
      }
    });
  },

  _allowDevFallback() {
    if (config.allowDevLoginFallback) return true;
    return isDevOrTrialClient();
  },

  ensureLogin() {
    if (this.globalData.forceLoggedOut) {
      return Promise.reject(new Error('已退出登录'));
    }
    if (api.getToken()) {
      return Promise.resolve(api.getToken());
    }
    const deviceKey = `${config.storagePrefix}device_id`;
    const deviceId = wx.getStorageSync(deviceKey) || `d_${Date.now()}`;
    wx.setStorageSync(deviceKey, deviceId);

    const applySession = (data) => {
      this.globalData.forceLoggedOut = false;
      api.setSession(data.token, {
        id: data.user_id,
        nickname: data.nickname,
        membership: data.membership
      });
      this.globalData.user = {
        id: data.user_id,
        nickname: data.nickname,
        membership: data.membership
      };
      return data.token;
    };

    const devLogin = () =>
      api.request({
        url: '/api/auth/dev-login',
        method: 'POST',
        data: { device_id: deviceId, nickname: '学习者' },
        auth: false
      });

    return new Promise((resolve, reject) => {
      const failOrDev = (err) => {
        if (!this._allowDevFallback()) {
          reject(err || new Error('login failed'));
          return;
        }
        // 开发环境：先问服务端是否开了 dev-login，再回退
        api
          .request({ url: '/api/auth/mode', method: 'GET', auth: false })
          .then((mode) => {
            if (mode && mode.dev_login_enabled === false) {
              throw err || new Error('开发登录未开启');
            }
            return devLogin();
          })
          .catch(() => {
            // mode 接口失败时仍尝试一次（兼容旧后端）
            return devLogin();
          })
          .then(applySession)
          .then(resolve)
          .catch(reject);
      };

      // 开发者工具优先走稳定的 dev-login，避免 wx.code 与服务器密钥不一致
      if (!config.preferWxLogin || isDevOrTrialClient()) {
        if (this._allowDevFallback()) {
          failOrDev();
          return;
        }
        if (!config.preferWxLogin) {
          failOrDev(new Error('未开启微信登录'));
          return;
        }
      }

      wx.login({
        success: (loginRes) => {
          const code = loginRes.code;
          if (!code) {
            failOrDev(new Error('no wx code'));
            return;
          }
          api
            .request({
              url: '/api/auth/wx-login',
              method: 'POST',
              data: { code },
              auth: false
            })
            .then(applySession)
            .then(resolve)
            .catch(failOrDev);
        },
        fail: failOrDev
      });
    });
  }
});
