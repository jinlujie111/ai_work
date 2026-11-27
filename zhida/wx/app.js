const api = require('./services/api');
const config = require('./utils/config');

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
      wx.showToast({
        title: (err && err.message) || '微信登录失败',
        icon: 'none',
        duration: 2500
      });
    });
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
        if (!config.allowDevLoginFallback) {
          reject(err || new Error('login failed'));
          return;
        }
        devLogin().then(applySession).then(resolve).catch(reject);
      };

      if (!config.preferWxLogin) {
        failOrDev();
        return;
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
