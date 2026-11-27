const api = require('../services/api');

/**
 * 弹出技能确认写入（阶段/目标完成时）。
 * proposals: [{ skill_name, domain, suggested_level, reason, goal_id, stage_id }]
 */
function confirmSkillProposals(proposals) {
  if (!proposals || !proposals.length) {
    return Promise.resolve({ skipped: true });
  }
  const lines = proposals
    .slice(0, 5)
    .map((p) => `${p.skill_name} · ${p.suggested_level_label || p.suggested_level}`)
    .join('\n');
  return new Promise((resolve) => {
    wx.showModal({
      title: '写入技能？',
      content: lines,
      confirmText: '写入',
      cancelText: '跳过',
      success(res) {
        if (!res.confirm) {
          resolve({ skipped: true });
          return;
        }
        api
          .request({
            url: '/api/skills/confirm',
            method: 'POST',
            data: {
              items: proposals.map((p) => ({
                skill_name: p.skill_name,
                domain: p.domain || '其他',
                level: p.suggested_level || 2,
                evidence: p.reason || '用户确认',
                goal_id: p.goal_id || 0,
                stage_id: p.stage_id || 0,
                source: 'ai_suggest'
              }))
            }
          })
          .then((r) => {
            wx.showToast({ title: `已写入 ${r.items.length} 项`, icon: 'success' });
            resolve(r);
          })
          .catch((err) => {
            wx.showToast({ title: err.message || '写入失败', icon: 'none' });
            resolve({ error: err });
          });
      },
      fail: () => resolve({ skipped: true })
    });
  });
}

module.exports = {
  confirmSkillProposals
};
