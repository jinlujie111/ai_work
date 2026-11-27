const api = require('../../services/api');

Page({
  data: { code: '', loading: false },

  onLoad(q) {
    if (q.code) this.setData({ code: String(q.code).toUpperCase() });
  },

  onInput(e) {
    this.setData({ code: (e.detail.value || '').toUpperCase() });
  },

  onJoin() {
    const code = (this.data.code || '').trim();
    if (code.length < 4) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    api
      .ensureLogin()
      .then(() =>
        api.request({
          url: '/api/groups/join',
          method: 'POST',
          data: { invite_code: code }
        })
      )
      .then((r) => {
        this.setData({ loading: false });
        wx.redirectTo({ url: `/pages/group-detail/group-detail?id=${r.group_id}` });
      })
      .catch((err) => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加入失败', icon: 'none' });
      });
  }
});
