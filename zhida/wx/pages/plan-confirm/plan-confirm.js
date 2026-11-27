const api = require('../../services/api');

const STEP_PCT = {
  start: 8,
  expand: 30,
  expand_done: 72,
  fallback: 60,
  schedule: 88,
  done: 100,
  delta: 45
};

Page({
  data: {
    goalId: '',
    goal: {},
    skillOverview: '',
    skillScenarios: [],
    modules: [],
    selectedCount: 0,
    confirming: false,
    needPriority: false,
    priorityList: [],
    streamMessage: '',
    streamChars: 0,
    streamPct: 0,
    streamLogs: []
  },

  onLoad(query) {
    this.setData({ goalId: query.id });
    this.refresh(query.id);
  },

  noop() {},

  _pushStream(ev) {
    const isDelta = ev && ev.event === 'delta';
    const msg = (ev && ev.message) || '';
    const logs = (this.data.streamLogs || []).slice();
    if (!isDelta && msg && logs[logs.length - 1] !== msg) {
      logs.push(msg);
      if (logs.length > 6) logs.shift();
    }
    const step = (ev && ev.step) || (isDelta ? 'delta' : '');
    let pct = this.data.streamPct || 0;
    if (STEP_PCT[step] != null) pct = Math.max(pct, STEP_PCT[step]);
    if (isDelta && ev.chars) {
      pct = Math.min(70, Math.max(pct, 30 + Math.floor(ev.chars / 80)));
    }
    this.setData({
      streamMessage: msg || this.data.streamMessage,
      streamChars: (ev && ev.chars) || this.data.streamChars,
      streamPct: pct,
      streamLogs: logs
    });
  },

  _syncCount(modules) {
    const selectedCount = (modules || []).filter((m) => m.selected).length;
    this.setData({ modules, selectedCount });
  },

  _buildPriorityList(goalId, goalTitle, activeGoals) {
    const others = (activeGoals || []).map((g) => ({
      id: g.id,
      title: g.title,
      isCurrent: false
    }));
    // 默认：当前草案优先，再按已有目标顺序
    return [
      { id: Number(goalId), title: goalTitle || '当前目标', isCurrent: true },
      ...others
    ].map((g, idx) => ({ ...g, rank: idx + 1 }));
  },

  refresh(goalId) {
    api
      .ensureLogin()
      .then(() => api.request({ url: `/api/goals/${goalId}` }))
      .then((data) => {
        const rawModules = data.modules || (data.goal && data.goal.modules) || [];
        const modules = rawModules.map((m, idx) => {
          const skippable = !!m.skippable;
          const skills = m.skills || [];
          return {
            key: m.key,
            name: m.name,
            stageNo: idx + 1,
            learn: m.learn || '',
            skillsText: skills.join('、'),
            difficultyLabel: m.difficulty_label || m.difficultyLabel || m.difficulty || '',
            materials: m.materials || m.resources || [],
            skippable,
            selected: !skippable
          };
        });
        const needPriority = !!data.need_priority;
        const priorityList = needPriority
          ? this._buildPriorityList(goalId, data.goal.title, data.active_goals || [])
          : [];
        this.setData({
          goal: {
            title: data.goal.title,
            startDate: data.goal.start_date,
            deadline: data.goal.deadline,
            dailyMinutes: data.goal.daily_minutes,
            baseline: data.goal.baseline
          },
          skillOverview:
            data.skill_overview ||
            (data.goal && data.goal.skill_overview) ||
            '',
          skillScenarios:
            data.skill_scenarios ||
            (data.goal && data.goal.skill_scenarios) ||
            [],
          needPriority,
          priorityList
        });
        this._syncCount(modules);
      })
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  onToggleModule(e) {
    const key = e.currentTarget.dataset.key;
    const modules = (this.data.modules || []).map((m) =>
      m.key === key ? { ...m, selected: !m.selected } : m
    );
    this._syncCount(modules);
  },

  onSelectAll() {
    const modules = (this.data.modules || []).map((m) => ({ ...m, selected: true }));
    this._syncCount(modules);
  },

  onSelectNone() {
    const modules = (this.data.modules || []).map((m) => ({ ...m, selected: false }));
    this._syncCount(modules);
  },

  onMovePriority(e) {
    const { index, dir } = e.currentTarget.dataset;
    const list = (this.data.priorityList || []).slice();
    const i = Number(index);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
    this.setData({
      priorityList: list.map((g, idx) => ({ ...g, rank: idx + 1 }))
    });
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

  onConfirm() {
    if (this.data.confirming) return;
    const selected = (this.data.modules || []).filter((m) => m.selected).map((m) => m.key);
    if (!selected.length) {
      wx.showToast({ title: '请至少选择一个模块', icon: 'none' });
      return;
    }
    const dropped = (this.data.modules || []).length - selected.length;
    const needPriority = this.data.needPriority;
    const priorityOrder = (this.data.priorityList || []).map((g) => g.id);

    const run = () => {
      this.setData({
        confirming: true,
        streamMessage: '开始写入日程…',
        streamChars: 0,
        streamPct: 6,
        streamLogs: ['开始写入日程…']
      });
      const payload = {
        confirm: true,
        selected_module_keys: selected
      };
      if (needPriority && priorityOrder.length) {
        payload.goal_priority_order = priorityOrder;
      }
      api
        .requestStream({
          url: `/api/goals/${this.data.goalId}/confirm-stream`,
          method: 'POST',
          data: payload,
          onEvent: (ev) => this._pushStream(ev)
        })
        .then((r) => {
          this.setData({ confirming: false, streamPct: 100 });
          const tip =
            r.kept_tasks != null
              ? `已写入 ${r.kept_tasks} 项任务`
              : dropped > 0
                ? `已确认 ${selected.length} 个模块`
                : '已进入进行中';
          wx.showToast({ title: tip, icon: 'success' });
          setTimeout(() => wx.switchTab({ url: '/pages/today/today' }), 500);
        })
        .catch((err) => {
          this.setData({ confirming: false });
          wx.showToast({ title: err.message || '确认失败', icon: 'none' });
        });
    };

    let content =
      dropped > 0
        ? `将保留 ${selected.length} 个模块、去掉 ${dropped} 个，然后生成任务并写入日历。`
        : `将按 ${selected.length} 个模块生成任务并写入日历。`;
    if (needPriority && priorityOrder.length) {
      const names = (this.data.priorityList || []).map((g, i) => `${i + 1}.${g.title}`).join(' → ');
      content += `\n\n学习优先级：${names}\n将按此顺序重排日历。`;
    }

    wx.showModal({
      title: '确认并生成日程？',
      content,
      success: (res) => {
        if (res.confirm) run();
      }
    });
  },

  onReject() {
    if (this.data.confirming) return;
    wx.showModal({
      title: '放弃草案？',
      content: '草案将终止且仍计入免费名额。',
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
              wx.switchTab({ url: '/pages/goals/goals' });
            }, 400);
          })
          .catch((err) => {
            wx.hideLoading();
            wx.showToast({ title: err.message || '放弃失败', icon: 'none' });
          });
      }
    });
  }
});
