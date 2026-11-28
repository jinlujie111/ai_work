const api = require('../../services/api');

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftDays(base, days) {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftYears(base, years) {
  const d = new Date(`${base}T12:00:00`);
  d.setFullYear(d.getFullYear() + years);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

Component({
  properties: {
    open: { type: Boolean, value: false },
    defaultDate: { type: String, value: '' }
  },

  data: {
    name: '',
    canSubmit: false,
    dateKey: 'today',
    pickerValue: '',
    pickerStart: '',
    pickerEnd: '',
    saving: false
  },

  observers: {
    open(v) {
      if (!v) return;
      const t = todayStr();
      const def =
        this.data.defaultDate && /^\d{4}-\d{2}-\d{2}$/.test(this.data.defaultDate)
          ? this.data.defaultDate
          : t;
      let dateKey = 'today';
      if (def === shiftDays(t, 1)) dateKey = 'tomorrow';
      else if (def !== t) dateKey = 'custom';
      this.setData({
        name: '',
        canSubmit: false,
        dateKey,
        pickerValue: def,
        pickerStart: t,
        pickerEnd: shiftYears(t, 2),
        saving: false
      });
    }
  },

  methods: {
    noop() {},

    onClose() {
      this.triggerEvent('close');
    },

    onName(e) {
      const name = e.detail.value || '';
      this.setData({
        name,
        canSubmit: !!name.trim()
      });
    },

    onPickKey(e) {
      const key = (e.currentTarget.dataset && e.currentTarget.dataset.key) || 'today';
      const t = todayStr();
      if (key === 'tomorrow') {
        this.setData({ dateKey: 'tomorrow', pickerValue: shiftDays(t, 1) });
        return;
      }
      this.setData({ dateKey: 'today', pickerValue: t });
    },

    onDatePicked(e) {
      const date = (e.detail && e.detail.value) || '';
      if (!date) return;
      const t = todayStr();
      let dateKey = 'custom';
      if (date === t) dateKey = 'today';
      else if (date === shiftDays(t, 1)) dateKey = 'tomorrow';
      this.setData({ pickerValue: date, dateKey });
    },

    resolveDate() {
      const t = todayStr();
      const { dateKey, pickerValue } = this.data;
      if (dateKey === 'tomorrow') return shiftDays(t, 1);
      if (dateKey === 'custom' && pickerValue) return pickerValue;
      return pickerValue || t;
    },

    onConfirm() {
      const name = (this.data.name || '').trim();
      if (!name) {
        wx.showToast({ title: '请先输入内容', icon: 'none' });
        return;
      }
      if (this.data.saving) return;
      const date = this.resolveDate();
      this.setData({ saving: true });
      api
        .ensureLogin()
        .then(() =>
          api.request({
            url: '/api/tasks/quick',
            method: 'POST',
            data: {
              name,
              planned_date: date,
              priority: 'normal',
              estimated_minutes: 25
            }
          })
        )
        .then((item) => {
          this.setData({ saving: false, name: '', canSubmit: false });
          wx.showToast({ title: '已添加', icon: 'success' });
          this.triggerEvent('created', { task: item });
          this.triggerEvent('close');
        })
        .catch((err) => {
          this.setData({ saving: false });
          wx.showToast({ title: err.message || '添加失败', icon: 'none' });
        });
    }
  }
});
