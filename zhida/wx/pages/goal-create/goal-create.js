const api = require('../../services/api');

const STEP_PCT = {
  start: 8,
  quota: 16,
  market: 28,
  market_hit: 70,
  llm: 36,
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
    recording: false,
    streamMessage: '',
    streamChars: 0,
    streamPct: 0,
    streamLogs: []
  },

  onLoad() {
    this._recorder = null;
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

  onVoiceStart() {
    const recorder = wx.getRecorderManager();
    this._recorder = recorder;
    recorder.onStart(() => this.setData({ recording: true }));
    recorder.onError(() => {
      this.setData({ recording: false });
      wx.showToast({ title: '录音失败，请手动输入', icon: 'none' });
    });
    recorder.onStop(() => {
      this.setData({ recording: false });
      wx.showModal({
        title: '确认语音内容',
        editable: true,
        placeholderText: this.data.rawText || '请输入或粘贴语音转写文字',
        success: (res) => {
          if (!res.confirm) return;
          const text = (res.content || '').trim();
          if (text) this.setData({ rawText: text });
        }
      });
    });
    try {
      recorder.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        format: 'mp3'
      });
    } catch (e) {
      this.setData({ recording: false });
      wx.showToast({ title: '请手动输入学习目标', icon: 'none' });
    }
  },

  onVoiceEnd() {
    if (!this.data.recording || !this._recorder) return;
    try {
      this._recorder.stop();
    } catch (e) {
      this.setData({ recording: false });
    }
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
      .then(() =>
        api.requestStream({
          url: '/api/goals/plan-draft-stream',
          method: 'POST',
          data: {
            raw_text: rawText,
            baseline: this.data.baseline
          },
          onEvent: (ev) => this._pushStream(ev)
        })
      )
      .then((draft) => {
        this.setData({ loading: false, streamPct: 100 });
        const id = draft && draft.goal && draft.goal.id;
        if (!id) {
          wx.showToast({ title: '草案无效', icon: 'none' });
          return;
        }
        const src = (draft.analysis && draft.analysis.source) || '';
        if (src === 'market') {
          wx.showToast({ title: '已从技能市场匹配', icon: 'success' });
        }
        wx.redirectTo({
          url: `/pages/plan-confirm/plan-confirm?id=${id}`
        });
      })
      .catch((err) => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message || '生成失败', icon: 'none' });
      });
  }
});
