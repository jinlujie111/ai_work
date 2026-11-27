const api = require('../../services/api');

const DOMAINS = ['技术', '语言', '运动', '认知', '职业', '其他'];

Page({
  data: {
    tab: 'list',
    items: [],
    limitText: '',
    domains: [],
    edges: []
  },

  onShow() {
    this.refresh();
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
    this.refresh();
  },

  refresh() {
    if (this.data.tab === 'graph') {
      this.loadGraph();
      return;
    }
    api
      .ensureLogin()
      .then(() => api.request({ url: '/api/skills' }))
      .then((data) => {
        const limit = data.limit;
        this.setData({
          items: data.items || [],
          limitText:
            limit == null
              ? `${data.confirmed_count || 0} 项`
              : `${data.confirmed_count || 0} / ${limit}`
        });
      })
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  loadGraph() {
    api
      .ensureLogin()
      .then(() => api.request({ url: '/api/skills/graph' }))
      .then((data) => {
        const nodes = data.nodes || [];
        const byId = {};
        nodes.forEach((n) => {
          byId[n.id] = n;
        });
        const domains = (data.domains || []).map((d) => ({
          ...d,
          nodes: nodes.filter((n) => n.domain === d.name)
        }));
        const edges = (data.edges || []).map((e, idx) => ({
          idx,
          label: `${(byId[e.from] || {}).name || e.from} → ${(byId[e.to] || {}).name || e.to}（${e.relation}）`
        }));
        this.setData({ domains, edges });
      })
      .catch((err) => wx.showToast({ title: err.message || '图谱失败', icon: 'none' }));
  },

  onAdd() {
    wx.showModal({
      title: '添加技能',
      editable: true,
      placeholderText: '如：Python / 英语听力',
      success: (res) => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (!name) return;
        wx.showActionSheet({
          itemList: DOMAINS,
          success: (a) => {
            const domain = DOMAINS[a.tapIndex];
            api
              .request({
                url: '/api/skills',
                method: 'POST',
                data: {
                  skill_name: name,
                  domain,
                  level: 1,
                  evidence: '用户自报'
                }
              })
              .then(() => {
                wx.showToast({ title: '已添加', icon: 'success' });
                this.refresh();
              })
              .catch((err) => wx.showToast({ title: err.message || '失败', icon: 'none' }));
          }
        });
      }
    });
  },

  onEdit(e) {
    const { name } = e.currentTarget.dataset;
    wx.showActionSheet({
      itemList: ['0 未知', '1 入门', '2 会用', '3 熟练', '4 能教人'],
      success: (res) => {
        api
          .request({
            url: '/api/skills',
            method: 'POST',
            data: {
              skill_name: name,
              level: res.tapIndex,
              evidence: '用户调整程度'
            }
          })
          .then(() => {
            wx.showToast({ title: '已更新', icon: 'success' });
            this.refresh();
          })
          .catch((err) => wx.showToast({ title: err.message || '失败', icon: 'none' }));
      }
    });
  },

  onArchive(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '归档该技能？',
      content: '归档后不再用于新建学习目标时读档。',
      success: (res) => {
        if (!res.confirm) return;
        api
          .request({ url: `/api/skills/${id}`, method: 'DELETE' })
          .then(() => this.refresh())
          .catch((err) => wx.showToast({ title: err.message || '失败', icon: 'none' }));
      }
    });
  },

  onExport() {
    api
      .ensureLogin()
      .then(() => api.request({ url: '/api/skills/export' }))
      .then((data) => {
        const text = JSON.stringify(data, null, 2);
        wx.setClipboardData({
          data: text,
          success: () => wx.showToast({ title: `已复制 ${data.count} 条`, icon: 'success' })
        });
      })
      .catch((err) => wx.showToast({ title: err.message || '导出失败', icon: 'none' }));
  }
});
