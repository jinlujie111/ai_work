const api = require('../../services/api');

function _freeQuotaLabel(user) {
  const q = user.goal_quota || {};
  const limit = q.limit != null ? q.limit : user.free_goal_limit || 5;
  const used = q.used != null ? q.used : 0;
  return `免费 · 目标 ${used}/${limit}`;
}

Page({
  data: {
    loggedIn: false,
    loggingIn: false,
    user: {},
    memberLabel: '',
    dailyMinutes: 60
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 });
    }
    const app = getApp();
    if (app.globalData.forceLoggedOut || !api.getToken()) {
      this.setData({
        loggedIn: false,
        user: {},
        memberLabel: '',
        dailyMinutes: 60
      });
      return;
    }
    this._loadProfile();
  },

  _loadProfile() {
    api
      .ensureLogin()
      .then(() => api.request({ url: '/api/me' }))
      .then((user) => {
        const dailyMinutes = Number(
          user.daily_minutes_weekday || user.dailyMinutesWeekday || 60
        );
        this.setData({
          loggedIn: true,
          user,
          dailyMinutes,
          memberLabel: user.is_member
            ? `${user.membership === 'year' ? '年' : '月'}会员`
            : _freeQuotaLabel(user)
        });
      })
      .catch(() => {
        this.setData({
          loggedIn: false,
          user: {},
          memberLabel: '',
          dailyMinutes: 60
        });
      });
  },

  onLogin() {
    if (this.data.loggingIn) return;
    const app = getApp();
    app.globalData.forceLoggedOut = false;
    this.setData({ loggingIn: true });
    app
      .ensureLogin()
      .then(() => this._loadProfile())
      .then(() => wx.showToast({ title: '已登录', icon: 'success' }))
      .catch((err) => wx.showToast({ title: err.message || '登录失败', icon: 'none' }))
      .then(() => this.setData({ loggingIn: false }));
  },

  onEditNickname() {
    const cur = this.data.user.nickname || '';
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: cur || '学习者',
      success: (res) => {
        if (!res.confirm) return;
        const nickname = (res.content || '').trim().slice(0, 24);
        if (!nickname) {
          wx.showToast({ title: '昵称不能为空', icon: 'none' });
          return;
        }
        api
          .request({
            url: '/api/me/prefs',
            method: 'POST',
            data: { nickname }
          })
          .then(() => {
            wx.showToast({ title: '已更新', icon: 'success' });
            this.onShow();
          })
          .catch((err) => wx.showToast({ title: err.message || '更新失败', icon: 'none' }));
      }
    });
  },

  onTime() {
    wx.showModal({
      title: '每日可用时间',
      editable: true,
      placeholderText: String(this.data.user.daily_minutes_weekday || 60),
      success: (res) => {
        if (!res.confirm) return;
        const n = Number(res.content);
        if (!n || n < 10) {
          wx.showToast({ title: '请输入有效分钟数', icon: 'none' });
          return;
        }
        api
          .request({
            url: '/api/me/prefs',
            method: 'POST',
            data: { daily_minutes_weekday: n }
          })
          .then(() => this.onShow());
      }
    });
  },

  onGroups() {
    wx.navigateTo({ url: '/pages/groups/groups' });
  },

  onTemplateJoin() {
    wx.navigateTo({ url: '/pages/template-join/template-join' });
  },

  onSkills() {
    wx.navigateTo({ url: '/pages/skills/skills' });
  },

  onMembership() {
    wx.navigateTo({ url: '/pages/membership/membership' });
  },

  onReview() {
    wx.navigateTo({ url: '/pages/review/review' });
  },

  onClear() {
    wx.showModal({
      title: '退出登录？',
      content: '云端数据保留，可再次登录。',
      success: (res) => {
        if (!res.confirm) return;
        const app = getApp();
        app.globalData.forceLoggedOut = true;
        app.globalData.user = null;
        api.clearSession();
        this.setData({
          loggedIn: false,
          user: {},
          memberLabel: '',
          dailyMinutes: 60
        });
        wx.showToast({ title: '已退出', icon: 'success' });
      }
    });
  }
});
