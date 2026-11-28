const api = require('../../services/api');
const quota = require('../../utils/quota');
const goalIntent = require('../../utils/goalIntent');
const goalNav = require('../../utils/goalNav');

const STEP_PCT = {
  start: 8,
  intent: 12,
  intent_ok: 16,
  intent_llm: 22,
  intent_llm_ok: 28,
  quota: 32,
  market: 38,
  market_hit: 70,
  llm: 44,
  llm_done: 82,
  fallback: 70,
  save: 92,
  done: 100,
  delta: 50
};

Page({
  data: {
    rawText: '',
    baseline: '',
    profileMinutes: 0,
    loading: false,
    skillsSummary: '',
    streamMessage: '',
    streamChars: 0,
    streamPct: 0,
    streamLogs: []
  },

  onLoad() {
    api
      .ensureLogin()
      .then(() =>
        Promise.all([
          api.request({ url: '/api/skills/context' }),
          api.request({ url: '/api/me' })
        ])
      )
      .then(([ctx, me]) => {
        const profileMinutes = Number(me.daily_minutes_weekday || me.dailyMinutesWeekday || 60);
        this.setData({
          skillsSummary: ctx.summary || '',
          profileMinutes
        });
        if (!this.data.baseline && ctx.items && ctx.items.length) {
          this.setData({
            baseline: ctx.items
              .slice(0, 6)
              .map((s) => `${s.skill_name}·${s.level_label}`)
              .join('；')
          });
        }
      })
      .catch(() => {});
  },

  onUnload() {
    wx.hideLoading();
  },

  noop() {},

  _pushStream(ev) {
    const isDelta = ev && ev.event === 'delta';
    const msg = (ev && ev.message) || '';
    const logs = (this.data.streamLogs || []).slice();
    // 日志只记阶段进度，不刷字数 delta
    if (!isDelta && msg && logs[logs.length - 1] !== msg) {
      logs.push(msg);
      if (logs.length > 6) logs.shift();
    }
    const step = (ev && ev.step) || (isDelta ? 'delta' : '');
    let pct = this.data.streamPct || 0;
    if (STEP_PCT[step] != null) pct = Math.max(pct, STEP_PCT[step]);
    if (isDelta && ev.chars) {
      pct = Math.min(80, Math.max(pct, 36 + Math.floor(ev.chars / 80)));
    }
    this.setData({
      streamMessage: msg || this.data.streamMessage,
      streamChars: (ev && ev.chars) || this.data.streamChars,
      streamPct: pct,
      streamLogs: logs
    });
  },

  onInput(e) {
    this.setData({ rawText: e.detail.value });
  },

  onBaseline(e) {
    this.setData({ baseline: e.detail.value });
  },

  onOpenMine() {
    wx.switchTab({ url: '/pages/mine/mine' });
  },

  onGenerate() {
    const rawText = (this.data.rawText || '').trim();
    if (!rawText) {
      wx.showToast({ title: '请先描述学习目标', icon: 'none' });
      return;
    }
    const intent = goalIntent.classifyGoalIntent(rawText);
    if (!intent.allow_llm) {
      wx.showModal({
        title: '仅支持学习技能类',
        content: intent.reason || goalIntent.REJECT_MSG,
        showCancel: false
      });
      return;
    }
    if (this.data.loading) return;
    this.setData({
      loading: true,
      streamMessage: '开始解析…',
      streamChars: 0,
      streamPct: 6,
      streamLogs: ['开始解析…']
    });
    api
      .ensureLogin()
      .then(() => api.request({ url: '/api/me' }))
      .then((me) => {
        if (quota.isQuotaFull(me)) {
          this.setData({ loading: false });
          return quota.goMembership(
            me.goal_quota && me.goal_quota.message
              ? me.goal_quota.message
              : undefined
          ).then(() => null);
        }
        return api.requestStream({
          url: '/api/goals/plan-draft-stream',
          method: 'POST',
          data: {
            raw_text: rawText,
            baseline: this.data.baseline
          },
          onEvent: (ev) => this._pushStream(ev)
        });
      })
      .then((draft) => {
        if (!draft) return;
        this.setData({ loading: false, streamPct: 100 });
        const src = (draft.analysis && draft.analysis.source) || '';
        const reused = !!(draft.analysis && draft.analysis.reused);
        if (src === 'market' && !reused) {
          wx.showToast({ title: '已从技能市场匹配', icon: 'success' });
        }
        goalNav.openDraftOrGoal(draft, { redirect: true });
      })
      .catch((err) => {
        this.setData({ loading: false });
        if (quota.handleQuotaError(err)) return;
        wx.showToast({ title: err.message || '生成失败', icon: 'none' });
      });
  }
});
