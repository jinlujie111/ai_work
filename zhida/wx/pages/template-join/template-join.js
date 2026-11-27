const api = require('../../services/api');

Page({
  data: {
    code: '',
    template: null,
    loadingPreview: false,
    loadingClone: false
  },

  onLoad(q) {
    if (q.code) {
      this.setData({ code: String(q.code).toUpperCase() });
      this.onPreview();
    }
  },

  onShareAppMessage() {
    const t = this.data.template;
    return {
      title: t ? `学习计划「${t.title}」` : '复制学习计划',
      path: `/pages/template-join/template-join?code=${this.data.code || ''}`
    };
  },

  onInput(e) {
    this.setData({ code: (e.detail.value || '').toUpperCase(), template: null });
  },

  onPreview() {
    const code = (this.data.code || '').trim();
    if (code.length < 4) {
      wx.showToast({ title: '请输入分享码', icon: 'none' });
      return;
    }
    this.setData({ loadingPreview: true });
    api
      .ensureLogin()
      .then(() => api.request({ url: `/api/templates/${code}` }))
      .then((data) => {
        this.setData({ loadingPreview: false, template: data.template });
      })
      .catch((err) => {
        this.setData({ loadingPreview: false });
        wx.showToast({ title: err.message || '模板不存在', icon: 'none' });
      });
  },

  onClone() {
    const code = (this.data.code || '').trim();
    this.setData({ loadingClone: true });
    api
      .request({
        url: '/api/templates/clone',
        method: 'POST',
        data: { share_code: code }
      })
      .then((r) => {
        this.setData({ loadingClone: false });
        const id = r.goal && r.goal.id;
        wx.showToast({ title: '已复制', icon: 'success' });
        setTimeout(() => {
          wx.redirectTo({ url: `/pages/plan-confirm/plan-confirm?id=${id}` });
        }, 400);
      })
      .catch((err) => {
        this.setData({ loadingClone: false });
        wx.showToast({ title: err.message || '复制失败', icon: 'none' });
      });
  }
});
