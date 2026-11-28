const api = require('../../services/api');
const quota = require('../../utils/quota');

Page({
  data: {
    keyword: '',
    domain: 'all',
    categories: [{ key: 'all', label: '全部', count: 0 }],
    items: [],
    usingId: 0,
    loading: false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    this.refresh();
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value || '' });
  },

  onDomain(e) {
    const domain = e.currentTarget.dataset.domain || 'all';
    if (domain === this.data.domain) return;
    this.setData({ domain });
    this.refresh();
  },

  onRefresh() {
    this.refresh();
  },

  refresh() {
    const q = (this.data.keyword || '').trim();
    const domain = this.data.domain === 'all' ? '' : this.data.domain;
    let url = `/api/market?q=${encodeURIComponent(q)}`;
    if (domain) url += `&domain=${encodeURIComponent(domain)}`;
    this.setData({ loading: true });
    api
      .ensureLogin()
      .then(() => api.request({ url }))
      .then((data) => {
        const cats = (data.categories || []).map((c) => ({
          key: c.key,
          label: c.label || c.key,
          count: c.count || 0
        }));
        const total = cats.reduce((s, c) => s + (c.count || 0), 0);
        this.setData({
          loading: false,
          categories: [{ key: 'all', label: '全部', count: total }, ...cats],
          items: (data.items || []).map((it) => ({
            id: it.id,
            title: it.title,
            domain: it.domain || 'generic',
            domainLabel: it.domain_label || it.domainLabel || '综合',
            overview: it.skill_overview || '通用学习路径',
            moduleCount: it.module_count || 0,
            useCount: it.use_count || 0
          }))
        });
      })
      .catch((err) => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  onOpen(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/market-detail/market-detail?id=${id}` });
  },

  onUse(e) {
    this._use(e.currentTarget.dataset.id);
  },

  _use(id) {
    if (!id || this.data.usingId) return;
    this.setData({ usingId: id });
    wx.showLoading({ title: '生成草案', mask: true });
    api
      .request({
        url: `/api/market/${id}/use`,
        method: 'POST'
      })
      .then((draft) => {
        wx.hideLoading();
        this.setData({ usingId: 0 });
        const gid = draft && draft.goal && draft.goal.id;
        if (!gid) {
          wx.showToast({ title: '草案无效', icon: 'none' });
          return;
        }
        wx.navigateTo({ url: `/pages/plan-confirm/plan-confirm?id=${gid}` });
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ usingId: 0 });
        if (quota.handleQuotaError(err)) return;
        wx.showToast({ title: err.message || '选用失败', icon: 'none' });
      });
  }
});
