const api = require('../../services/api');
const quota = require('../../utils/quota');

Page({
  data: {
    itemId: '',
    item: null,
    using: false
  },

  onLoad(q) {
    this.setData({ itemId: q.id || '' });
    this.refresh();
  },

  refresh() {
    const id = this.data.itemId;
    if (!id) return;
    api
      .ensureLogin()
      .then(() => api.request({ url: `/api/market/${id}` }))
      .then((data) => {
        const it = data.item || {};
        const modules = (it.modules || []).map((m, idx) => ({
          key: m.key || `m${idx + 1}`,
          stageNo: idx + 1,
          name: m.name || `阶段 ${idx + 1}`,
          learn: m.learn || '',
          skillsText: (m.skills || []).join('、'),
          difficultyLabel:
            m.difficulty === 'easy' ? '入门' : m.difficulty === 'hard' ? '进阶' : '进阶练习',
          materials: m.materials || m.resources || []
        }));
        this.setData({
          item: {
            id: it.id,
            title: it.title || it.skill_name || '技能',
            domainLabel: it.domain_label || it.domainLabel || '综合',
            overview: it.skill_overview || '',
            scenarios: it.skill_scenarios || [],
            resources: it.resources || [],
            modules,
            moduleCount: modules.length,
            useCount: it.use_count || 0
          }
        });
      })
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  onCopyUrl(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) {
      wx.showToast({ title: '暂无链接', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' })
    });
  },

  onUse() {
    if (this.data.using || !this.data.itemId) return;
    this.setData({ using: true });
    wx.showLoading({ title: '生成草案', mask: true });
    api
      .request({
        url: `/api/market/${this.data.itemId}/use`,
        method: 'POST'
      })
      .then((draft) => {
        wx.hideLoading();
        this.setData({ using: false });
        const gid = draft && draft.goal && draft.goal.id;
        if (!gid) {
          wx.showToast({ title: '草案无效', icon: 'none' });
          return;
        }
        wx.redirectTo({ url: `/pages/plan-confirm/plan-confirm?id=${gid}` });
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ using: false });
        if (quota.handleQuotaError(err)) return;
        wx.showToast({ title: err.message || '选用失败', icon: 'none' });
      });
  }
});
