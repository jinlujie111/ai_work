/** 打开草案/已有目标：复用时按状态跳确认页或详情页 */

function openDraftOrGoal(draft, { redirect = false } = {}) {
  const goal = draft && draft.goal;
  const id = goal && goal.id;
  if (!id) {
    wx.showToast({ title: '草案无效', icon: 'none' });
    return false;
  }
  const analysis = (draft && draft.analysis) || {};
  const reused = !!analysis.reused;
  const status = (goal.status || analysis.reused_status || 'planning').toLowerCase();
  const go = redirect ? wx.redirectTo : wx.navigateTo;

  if (reused) {
    wx.showToast({
      title: analysis.message || '已打开已有目标',
      icon: 'none',
      duration: 2200
    });
  }

  if (status === 'planning') {
    go({ url: `/pages/plan-confirm/plan-confirm?id=${id}` });
    return true;
  }
  go({ url: `/pages/goal-detail/goal-detail?id=${id}` });
  return true;
}

module.exports = { openDraftOrGoal };
