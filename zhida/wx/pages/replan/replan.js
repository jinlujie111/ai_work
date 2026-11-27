const api = require('../../services/api');

Page({
  data: {
    taskIds: [],
    goalId: null,
    reasonOptions: ['临时没时间', '任务太难', '前置知识不足', '优先级变化', '其他'],
    reason: '临时没时间',
    note: '',
    loading: false,
    draft: null,
    diffs: []
  },

  onLoad(q) {
    const taskIds = (q.taskIds || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter(Boolean);
    this.setData({
      taskIds,
      goalId: q.goalId ? Number(q.goalId) : null
    });
  },

  onPickReason(e) {
    this.setData({ reason: e.currentTarget.dataset.v });
  },

  onNote(e) {
    this.setData({ note: e.detail.value });
  },

  onDraft() {
    const { taskIds, goalId, reason, note } = this.data;
    if (!taskIds.length || !goalId) {
      wx.showToast({ title: '缺少任务信息', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    api
      .ensureLogin()
      .then(() =>
        api.request({
          url: '/api/plans/replan-draft',
          method: 'POST',
          data: {
            goal_id: goalId,
            unfinished_task_ids: taskIds,
            reason,
            note
          }
        })
      )
      .then((draft) => {
        const before = draft.before || {};
        const diffs = (draft.analysis && draft.analysis.moved) || [];
        const normalized = diffs.map((m) => ({
          id: m.id,
          name: m.name,
          from: m.from || before[m.id] || '-',
          to: m.to
        }));
        this.setData({
          loading: false,
          draft,
          diffs: normalized
        });
      })
      .catch((err) => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '生成失败', icon: 'none' });
      });
  },

  onAccept() {
    const { draft, reason, note, taskIds, goalId } = this.data;
    if (!draft) return;
    const fullReason = note ? `${reason}：${note}` : reason;
    api
      .request({
        url: '/api/plans/replan-apply',
        method: 'POST',
        data: {
          goal_id: goalId,
          reason: fullReason,
          unfinished_task_ids: taskIds,
          tasks: draft.tasks
        }
      })
      .then(() => {
        wx.showToast({ title: '已更新计划', icon: 'success' });
        setTimeout(() => wx.switchTab({ url: '/pages/today/today' }), 400);
      })
      .catch((err) => wx.showToast({ title: err.message || '保存失败', icon: 'none' }));
  },

  onCancel() {
    wx.navigateBack();
  }
});
