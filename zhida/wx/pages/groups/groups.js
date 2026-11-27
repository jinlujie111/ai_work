const api = require('../../services/api');

Page({
  data: { items: [] },

  onShow() {
    this.refresh();
  },

  refresh() {
    api
      .ensureLogin()
      .then(() => api.request({ url: '/api/groups' }))
      .then((data) => this.setData({ items: data.items || [] }))
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  onCreate() {
    wx.showModal({
      title: '创建学习群',
      editable: true,
      placeholderText: '群名称，如：30天Python同学',
      success: (res) => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (name.length < 2) {
          wx.showToast({ title: '名称至少 2 字', icon: 'none' });
          return;
        }
        api
          .request({
            url: '/api/groups',
            method: 'POST',
            data: { name, topic: '' }
          })
          .then((r) => {
            wx.showToast({ title: '已创建', icon: 'success' });
            wx.navigateTo({ url: `/pages/group-detail/group-detail?id=${r.group.id}` });
          })
          .catch((err) => wx.showToast({ title: err.message || '创建失败', icon: 'none' }));
      }
    });
  },

  onJoin() {
    wx.navigateTo({ url: '/pages/group-join/group-join' });
  },

  onOpen(e) {
    wx.navigateTo({ url: `/pages/group-detail/group-detail?id=${e.currentTarget.dataset.id}` });
  }
});
