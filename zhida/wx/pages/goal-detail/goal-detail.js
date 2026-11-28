const api = require('../../services/api');
const { confirmSkillProposals } = require('../../utils/skills');
const materialOrigin = require('../../utils/materialOrigin');

const STATUS_LABEL = {
  planning: '待确认',
  active: '进行中',
  paused: '已暂停',
  done: '已完成',
  terminated: '已终止'
};

Page({
  data: {
    goalId: '',
    goal: null,
    stages: [],
    versions: [],
    resources: [],
    learningPath: { summary: '', knowledge: [], frameworks: [] },
    progress: 0,
    statusLabel: '',
    chartBars: [],
    sharing: false,
    shareCode: '',
    shareTitle: '',
    resDetail: null
  },

  noop() {},

  onLoad(q) {
    this.setData({ goalId: q.id });
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const goalId = this.data.goalId;
    api
      .ensureLogin()
      .then(() =>
        Promise.all([
          api.request({ url: `/api/goals/${goalId}` }),
          api.request({ url: `/api/goals/${goalId}/versions` })
        ])
      )
      .then(([data, ver]) => {
        const all = [];
        (data.stages || []).forEach((s) => {
          (s.tasks || []).forEach((t) => all.push(t));
        });
        const done = all.filter((t) => t.status === 'done').length;
        const progress = all.length ? Math.round((done / all.length) * 100) : 0;
        const chartBars = (data.stages || []).map((s) => {
          const tasks = s.tasks || [];
          const d = tasks.filter((t) => t.status === 'done').length;
          const pct = tasks.length ? Math.round((d / tasks.length) * 100) : 0;
          return {
            id: s.id,
            name: s.name,
            pct,
            label: `${d}/${tasks.length}`
          };
        });
        this.setData({
          goal: {
            title: data.goal.title,
            description: data.goal.description,
            deadline: data.goal.deadline,
            status: data.goal.status
          },
          resources: (data.goal.resources || []).map((r) => ({
            title: r.title || '学习资料',
            type: r.type || 'doc',
            type_label: r.type_label || r.type || '资料',
            note: r.note || '',
            content: r.content || '',
            origin: r.origin || '',
            howto_find: r.howto_find || '',
            url: r.url || '',
            stage_name: r.stage_name || ''
          })),
          learningPath: {
            summary: (data.goal.learning_path || {}).summary || '',
            knowledge: (data.goal.learning_path || {}).knowledge || [],
            frameworks: (data.goal.learning_path || {}).frameworks || []
          },
          stages: (data.stages || []).map((s) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            tasks: (s.tasks || []).map((t) => {
              const priority = (t.priority || 'normal').toLowerCase();
              return {
                id: t.id,
                name: t.name,
                plannedDate: t.planned_date,
                status: t.status,
                description: t.description || '',
                priority,
                priorityLabel:
                  priority === 'high' ? '高优' : priority === 'low' ? '可延后' : '普通',
                resourceTitle: ((t.resources || [])[0] || {}).title || ''
              };
            })
          })),
          versions: (ver.items || []).map((v) => ({
            id: v.id,
            version: v.version,
            reason: v.reason || '调整',
            createdAt: (v.created_at || '').replace('T', ' ').slice(0, 19)
          })),
          progress,
          statusLabel: STATUS_LABEL[data.goal.status] || data.goal.status,
          chartBars
        });
      })
      .catch(() => this.setData({ goal: null }));
  },

  onOpenResource(e) {
    const idx = e.currentTarget.dataset.index;
    const item = (this.data.resources || [])[idx];
    if (!item) return;
    const typeLabel = item.type_label || item.type || '资料';
    const content =
      (item.content || '').trim() ||
      (item.note || '').trim() ||
      '暂无详细学习说明，可结合阶段任务练习。';
    const origin = materialOrigin.resolveOrigin(item);
    const howtoFind = materialOrigin.resolveHowto(item, origin);
    this.setData({
      resDetail: {
        title: item.title || '学习资料',
        typeLabel,
        note: (item.note || '').trim(),
        content,
        origin,
        howtoFind,
        url: item.url || '',
        stageName: item.stage_name || ''
      }
    });
  },

  onCloseResource() {
    this.setData({ resDetail: null });
  },

  onCopyUrl(e) {
    const url = e.currentTarget.dataset.url || (this.data.resDetail && this.data.resDetail.url);
    if (!url) {
      wx.showToast({ title: '暂无外部链接', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' })
    });
  },

  onCopyHowto(e) {
    const text =
      e.currentTarget.dataset.text ||
      (this.data.resDetail && this.data.resDetail.howtoFind) ||
      '';
    if (!text) {
      wx.showToast({ title: '暂无查找说明', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制查找方式', icon: 'success' })
    });
  },

  onShareAppMessage() {
    const code = this.data.shareCode;
    const title = this.data.shareTitle || (this.data.goal && this.data.goal.title) || '学习计划';
    return {
      title: `学习计划「${title}」`,
      path: code
        ? `/pages/template-join/template-join?code=${code}`
        : `/pages/goal-detail/goal-detail?id=${this.data.goalId}`
    };
  },

  onShareTemplate() {
    this.setData({ sharing: true });
    api
      .request({
        url: `/api/goals/${this.data.goalId}/share-template`,
        method: 'POST',
        data: {}
      })
      .then((r) => {
        const code = r.template && r.template.share_code;
        this.setData({
          sharing: false,
          shareCode: code || '',
          shareTitle: (r.template && r.template.title) || ''
        });
        wx.setClipboardData({
          data: code || '',
          success: () =>
            wx.showToast({ title: '分享码已复制', icon: 'success' })
        });
      })
      .catch((err) => {
        this.setData({ sharing: false });
        wx.showToast({ title: err.message || '分享失败', icon: 'none' });
      });
  },

  onConfirmPlan() {
    wx.navigateTo({
      url: `/pages/plan-confirm/plan-confirm?id=${this.data.goalId}`
    });
  },

  onCompleteStage(e) {
    const stageId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '完成该阶段？',
      content: '未完成任务也会标为完成。',
      success: (res) => {
        if (!res.confirm) return;
        api
          .request({
            url: `/api/goals/${this.data.goalId}/stages/${stageId}/complete`,
            method: 'POST'
          })
          .then((r) =>
            confirmSkillProposals(r.skill_proposals || []).then(() => {
              this.refresh();
            })
          )
          .catch((err) => wx.showToast({ title: err.message || '失败', icon: 'none' }));
      }
    });
  },

  onCompleteGoal() {
    wx.showModal({
      title: '完成学习目标？',
      content: '完成后可写入技能。',
      success: (res) => {
        if (!res.confirm) return;
        api
          .request({
            url: `/api/goals/${this.data.goalId}/complete`,
            method: 'POST'
          })
          .then((r) =>
            confirmSkillProposals(r.skill_proposals || []).then(() => {
              this.refresh();
            })
          )
          .catch((err) => wx.showToast({ title: err.message || '失败', icon: 'none' }));
      }
    });
  },

  onPause() {
    wx.showActionSheet({
      alertText: '暂停后离开今日/日历，仍占免费名额',
      itemList: ['暂停并重排其他目标日历', '仅暂停，不重排'],
      success: (res) => {
        if (res.tapIndex === 0) this._pause(true);
        else if (res.tapIndex === 1) this._pause(false);
      }
    });
  },

  _pause(rebalance) {
    wx.showLoading({ title: '处理中', mask: true });
    api
      .request({
        url: `/api/goals/${this.data.goalId}/pause`,
        method: 'POST',
        data: { rebalance: !!rebalance }
      })
      .then((r) => {
        wx.hideLoading();
        const n = r.rescheduled_tasks || 0;
        wx.showToast({
          title: rebalance ? `已暂停，重排 ${n} 项` : '已暂停',
          icon: 'none'
        });
        this.refresh();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '暂停失败', icon: 'none' });
      });
  },

  onResume() {
    wx.showActionSheet({
      alertText: '恢复后重新进入今日与日历',
      itemList: ['恢复并重排日历', '仅恢复，不重排'],
      success: (res) => {
        if (res.tapIndex === 0) this._resume(true);
        else if (res.tapIndex === 1) this._resume(false);
      }
    });
  },

  _resume(rebalance) {
    wx.showLoading({ title: '处理中', mask: true });
    api
      .request({
        url: `/api/goals/${this.data.goalId}/resume`,
        method: 'POST',
        data: { rebalance: !!rebalance }
      })
      .then((r) => {
        wx.hideLoading();
        const n = r.rescheduled_tasks || 0;
        wx.showToast({
          title: rebalance ? `已恢复，重排 ${n} 项` : '已恢复',
          icon: 'none'
        });
        this.refresh();
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '恢复失败', icon: 'none' });
      });
  },

  onRollback(e) {
    const versionId = e.currentTarget.dataset.id;
    const version = e.currentTarget.dataset.version;
    wx.showModal({
      title: '回滚计划？',
      content: `将任务安排恢复到 v${version}，并新增一条回滚版本记录。`,
      success: (res) => {
        if (!res.confirm) return;
        api
          .request({
            url: `/api/goals/${this.data.goalId}/versions/${versionId}/rollback`,
            method: 'POST'
          })
          .then((r) => {
            wx.showToast({
              title: `已回滚到 v${r.rolled_back_to}`,
              icon: 'none'
            });
            this.refresh();
          })
          .catch((err) => wx.showToast({ title: err.message || '回滚失败', icon: 'none' }));
      }
    });
  },

  onAbandonDraft() {
    wx.showModal({
      title: '放弃学习目标？',
      content: '草案将终止，仍计入免费名额。',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        api
          .request({
            url: `/api/goals/${this.data.goalId}/confirm`,
            method: 'POST',
            data: { confirm: false }
          })
          .then(() => {
            wx.hideLoading();
            wx.showToast({ title: '已放弃', icon: 'success' });
            setTimeout(() => {
              wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/goals/goals' }) });
            }, 400);
          })
          .catch((err) => {
            wx.hideLoading();
            wx.showToast({ title: err.message || '放弃失败', icon: 'none' });
          });
      }
    });
  },

  onTerminate() {
    wx.showModal({
      title: '终止学习目标？',
      content: '终止后离开今日与日历，仍计入免费名额；其余进行中目标将重排日历。',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        api
          .request({
            url: `/api/goals/${this.data.goalId}/terminate`,
            method: 'POST'
          })
          .then(() => {
            wx.hideLoading();
            wx.showToast({ title: '已终止', icon: 'success' });
            setTimeout(() => {
              wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/goals/goals' }) });
            }, 400);
          })
          .catch((err) => {
            wx.hideLoading();
            wx.showToast({ title: err.message || '终止失败', icon: 'none' });
          });
      }
    });
  }
});
