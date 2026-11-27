const api = require('../../services/api');

const STATUS_LABEL = {
  planning: '待确认',
  active: '进行中',
  paused: '已暂停',
  done: '已完成',
  terminated: '已终止'
};

Page({
  data: {
    pendingGoals: [],
    activeGoals: [],
    pausedGoals: [],
    otherGoals: [],
    summaryLine: '',
    quotaLine: ''
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this.refresh();
  },

  refresh() {
    api
      .ensureLogin()
      .then(() =>
        Promise.all([
          api.request({ url: '/api/goals' }),
          api.request({ url: '/api/me' })
        ])
      )
      .then(([data, me]) => {
        const items = (data.items || []).map((g) => ({
          id: g.id,
          title: g.title,
          deadline: g.deadline || '未设',
          status: g.status,
          statusLabel: STATUS_LABEL[g.status] || g.status,
          progress: g.progress || 0,
          stageName: g.stage_name || '未拆解',
          priorityRank: g.priority_rank || 100
        }));
        const pendingGoals = items.filter((g) => g.status === 'planning');
        const activeGoals = items
          .filter((g) => g.status === 'active')
          .sort((a, b) => a.priorityRank - b.priorityRank)
          .map((g, idx) => ({ ...g, priorityLabel: `优先 ${idx + 1}` }));
        const pausedGoals = items.filter((g) => g.status === 'paused');
        const otherGoals = items.filter(
          (g) => !['active', 'planning', 'paused'].includes(g.status)
        );
        const parts = [];
        if (activeGoals.length) parts.push(`进行中 ${activeGoals.length}`);
        if (pausedGoals.length) parts.push(`暂停 ${pausedGoals.length}`);
        if (pendingGoals.length) parts.push(`待确认 ${pendingGoals.length}`);
        if (!parts.length) parts.push('暂无');

        let quotaLine = '';
        const q = (me && me.goal_quota) || {};
        if (me && !me.is_member) {
          quotaLine = `免费 ${q.used || 0}/${q.limit || 5}`;
        }

        this.setData({
          pendingGoals,
          activeGoals,
          pausedGoals,
          otherGoals,
          summaryLine: parts.join(' · '),
          quotaLine
        });
      })
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  onCreate() {
    wx.navigateTo({ url: '/pages/goal-create/goal-create' });
  },

  onAdjustPriority() {
    const goals = this.data.activeGoals || [];
    if (goals.length < 2) {
      wx.showToast({ title: '至少两个进行中目标', icon: 'none' });
      return;
    }
    // 逐步选择：第1优先、第2优先…
    const remaining = goals.slice();
    const ordered = [];
    const pickNext = () => {
      if (!remaining.length) {
        wx.showLoading({ title: '重排日历中', mask: true });
        api
          .request({
            url: '/api/goals/priority',
            method: 'POST',
            data: { ordered_goal_ids: ordered.map((g) => g.id) }
          })
          .then((r) => {
            wx.hideLoading();
            wx.showToast({
              title: `已重排 ${r.rescheduled_tasks || 0} 项`,
              icon: 'success'
            });
            this.refresh();
          })
          .catch((err) => {
            wx.hideLoading();
            wx.showToast({ title: err.message || '调整失败', icon: 'none' });
          });
        return;
      }
      const n = ordered.length + 1;
      wx.showActionSheet({
        alertText: `选择第 ${n} 优先目标`,
        itemList: remaining.map((g) => g.title),
        success: (res) => {
          const picked = remaining.splice(res.tapIndex, 1)[0];
          ordered.push(picked);
          pickNext();
        },
        fail: () => {
          if (ordered.length) {
            ordered.push(...remaining);
            remaining.length = 0;
            pickNext();
          }
        }
      });
    };
    pickNext();
  },

  onOpen(e) {
    const id = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    if (status === 'planning') {
      wx.navigateTo({ url: `/pages/plan-confirm/plan-confirm?id=${id}` });
      return;
    }
    wx.navigateTo({ url: `/pages/goal-detail/goal-detail?id=${id}` });
  }
});
