const api = require('../../services/api');

Page({
  data: {
    statusLabel: '免费版',
    expiresAt: '',
    plans: [],
    loadingPlan: ''
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    api
      .ensureLogin()
      .then(() => api.request({ url: '/api/me' }))
      .then((user) => {
        this.setData({
          statusLabel: user.is_member
            ? `${user.membership === 'year' ? '年' : '月'}会员`
            : (() => {
                const q = user.goal_quota || {};
                const limit = q.limit != null ? q.limit : 5;
                const used = q.used != null ? q.used : 0;
                return `免费版 · 学习目标 ${used}/${limit}`;
              })(),
          expiresAt: (user.membership_expires_at || '').replace('T', ' ').slice(0, 19),
          plans: user.plans || []
        });
      })
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  onActivate(e) {
    const plan = e.currentTarget.dataset.plan;
    wx.showModal({
      title: '开通会员？',
      content: '开发态开通，不扣款。',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ loadingPlan: plan });
        api
          .request({
            url: '/api/me/membership/activate',
            method: 'POST',
            data: { plan, note: 'dev_activate' }
          })
          .then((r) => {
            this.setData({ loadingPlan: '' });
            wx.showToast({ title: `${r.label || '会员'}已开通`, icon: 'success' });
            this.refresh();
          })
          .catch((err) => {
            this.setData({ loadingPlan: '' });
            wx.showToast({ title: err.message || '开通失败', icon: 'none' });
          });
      }
    });
  }
});
