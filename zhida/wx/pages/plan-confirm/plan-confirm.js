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
    previewing: false,
    previewReady: false,
    previewTasks: [],
    previewKept: 0,
    needPriority: false,
    priorityList: [],
    streamMessage: '',
    streamChars: 0,
    streamPct: 0,
    streamLogs: []
  },

  onLoad(query) {
    this._skipShowRefresh = true;
    this.setData({ goalId: query.id });
    this.refresh(query.id);
  },

  onShow() {
    // 首次 onLoad 已 refresh；之后从别的页返回时恢复预览缓存
    if (this._skipShowRefresh) {
      this._skipShowRefresh = false;
      return;
    }
    if (!this.data.goalId) return;
    if (this.data.confirming || this.data.previewing) return;
    if (!this.data.previewReady) {
      this.refresh(this.data.goalId);
    }
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
        const cached = data.expand_preview || null;
        const cachedKeys = (cached && cached.selected_module_keys) || [];
        const useCacheSelect = cachedKeys.length > 0;
        // 默认只勾前 2 个不可跳过模块；若已有预览缓存则恢复当时勾选
        let keepBudget = 2;
        const modules = rawModules.map((m, idx) => {
          const skippable = !!m.skippable;
          const skills = m.skills || [];
          let selected = false;
          if (useCacheSelect) {
            selected = cachedKeys.indexOf(m.key) >= 0;
          } else if (!skippable && keepBudget > 0) {
            selected = true;
            keepBudget -= 1;
          }
          return {
            key: m.key,
            name: m.name,
            stageNo: idx + 1,
            learn: m.learn || '',
            skillsText: skills.join('、'),
            difficultyLabel: m.difficulty_label || m.difficultyLabel || m.difficulty || '',
            materials: m.materials || m.resources || [],
            skippable,
            selected
          };
        });
        const needPriority = !!data.need_priority;
        const priorityList = needPriority
          ? this._buildPriorityList(goalId, data.goal.title, data.active_goals || [])
          : [];
        const deadline =
          (cached && cached.deadline) || data.goal.deadline;
        this.setData({
          goal: {
            title: data.goal.title,
            startDate: data.goal.start_date,
            deadline,
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

        const upcoming = (cached && cached.upcoming_preview) || [];
        if (upcoming.length) {
          const previewTasks = upcoming.map((t) => ({
            ...t,
            selected: t.selected !== false
          }));
          this._syncPreviewKept(previewTasks);
          this.setData({ previewReady: true });
        }
      })
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  onToggleModule(e) {
    const key = e.currentTarget.dataset.key;
    const modules = (this.data.modules || []).map((m) =>
      m.key === key ? { ...m, selected: !m.selected } : m
    );
    this._syncCount(modules);
    // 模块变更后需重新预览
    if (this.data.previewReady) {
      this.setData({ previewReady: false, previewTasks: [], previewKept: 0 });
    }
  },

  onSelectAll() {
    const modules = (this.data.modules || []).map((m) => ({ ...m, selected: true }));
    this._syncCount(modules);
    if (this.data.previewReady) {
      this.setData({ previewReady: false, previewTasks: [], previewKept: 0 });
    }
  },

  onSelectNone() {
    const modules = (this.data.modules || []).map((m) => ({ ...m, selected: false }));
    this._syncCount(modules);
    if (this.data.previewReady) {
      this.setData({ previewReady: false, previewTasks: [], previewKept: 0 });
    }
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

  _selectedKeys() {
    return (this.data.modules || []).filter((m) => m.selected).map((m) => m.key);
  },

  _syncPreviewKept(previewTasks) {
    const previewKept = (previewTasks || []).filter((t) => t.selected).length;
    this.setData({ previewTasks, previewKept });
  },

  onTogglePreviewTask(e) {
    const key = e.currentTarget.dataset.key;
    const previewTasks = (this.data.previewTasks || []).map((t) =>
      t.key === key ? { ...t, selected: !t.selected } : t
    );
    this._syncPreviewKept(previewTasks);
  },

  onPreview() {
    if (this.data.previewing || this.data.confirming) return;
    const selected = this._selectedKeys();
    if (!selected.length) {
      wx.showToast({ title: '请至少选择一个模块', icon: 'none' });
      return;
    }
    this.setData({
      previewing: true,
      confirming: true,
      previewReady: false,
      streamMessage: 'AI 拆解可执行任务…',
      streamChars: 0,
      streamPct: 8,
      streamLogs: ['AI 拆解可执行任务…']
    });
    api
      .request({
        url: `/api/goals/${this.data.goalId}/expand-preview`,
        method: 'POST',
        data: { selected_module_keys: selected }
      })
      .then((r) => {
        const previewTasks = (r.upcoming_preview || []).map((t) => ({
          ...t,
          selected: t.selected !== false
        }));
        this._syncPreviewKept(previewTasks);
        const patch = {
          previewing: false,
          confirming: false,
          previewReady: true,
          streamPct: 100,
          streamMessage: '预览已就绪'
        };
        if (r.deadline) {
          patch.goal = { ...this.data.goal, deadline: r.deadline };
        }
        this.setData(patch);
        if (!previewTasks.length) {
          wx.showToast({ title: '未生成可预览任务', icon: 'none' });
        }
      })
      .catch((err) => {
        this.setData({ previewing: false, confirming: false });
        wx.showToast({ title: err.message || '预览失败', icon: 'none' });
      });
  },

  onConfirm() {
    if (this.data.confirming) return;
    const selected = this._selectedKeys();
    if (!selected.length) {
      wx.showToast({ title: '请至少选择一个模块', icon: 'none' });
      return;
    }
    // 尚未预览：先拆解预览，允许删掉虚任务再写入
    if (!this.data.previewReady) {
      this.onPreview();
      return;
    }
    const previewTasks = this.data.previewTasks || [];
    const kept = previewTasks.filter((t) => t.selected);
    if (!kept.length) {
      wx.showToast({ title: '请至少保留一个任务', icon: 'none' });
      return;
    }
    const dropKeys = previewTasks.filter((t) => !t.selected).map((t) => t.key);
    const droppedModules = (this.data.modules || []).length - selected.length;
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
        selected_module_keys: selected,
        drop_task_keys: dropKeys
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
              : droppedModules > 0
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

    let content = `将写入近期待办中保留的 ${kept.length} 项任务`;
    if (dropKeys.length) content += `，去掉 ${dropKeys.length} 项`;
    content += '。';
    if (needPriority && priorityOrder.length) {
      const names = (this.data.priorityList || []).map((g, i) => `${i + 1}.${g.title}`).join(' → ');
      content += `\n\n学习优先级：${names}`;
    }

    wx.showModal({
      title: '确认写入日程？',
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
