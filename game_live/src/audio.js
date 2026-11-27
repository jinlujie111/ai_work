/* 深林 · Deep Forest — 纯合成音效（无外部音频资源） */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};
  var U = DF.Util;
  var A = DF.Audio = {
    ctx: null, master: null, sfxGain: null, ambGain: null,
    muted: false, ready: false, _noise: null, _night: false, _cricketGain: null
  };

  A.init = function () {
    if (this.ready) { this.resume(); return; }
    var ctx = U.createAudioContext();
    if (!ctx) return;
    this.ctx = ctx;
    var ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ctx.destination);

    this.sfxGain = ctx.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master);
    this.ambGain = ctx.createGain(); this.ambGain.gain.value = 0.0; this.ambGain.connect(this.master);

    this._noise = this._makeNoise(2.2);
    this.ready = true;
    if (this._noise) this._startAmbient();
    this.resume();
  };

  A.resume = function () { if (this.ctx && this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} } };
  A.setMuted = function (m) {
    this.muted = !!m;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
  };
  A.toggle = function () { this.setMuted(!this.muted); return this.muted; };

  A._makeNoise = function (sec) {
    try {
      var ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0), last = 0;
      for (var i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;      // 偏棕噪，听感更自然
        d[i] = last * 3.2;
      }
      return buf;
    } catch (e) { this._noNoise = true; return null; }
  };

  /* ── 环境层：风声 + 夜虫 ───────────────────────────── */
  A._startAmbient = function () {
    var ctx = this.ctx;
    var src = ctx.createBufferSource();
    src.buffer = this._noise; src.loop = true;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.6;
    var g = ctx.createGain(); g.gain.value = 0.5;
    // 缓慢起伏的风
    var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
    var lfoGain = ctx.createGain(); lfoGain.gain.value = 220;
    lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
    src.connect(lp); lp.connect(g); g.connect(this.ambGain);
    src.start(); lfo.start();
    this.ambGain.gain.setTargetAtTime(0.18, ctx.currentTime, 2.5);

    // 夜虫
    var cg = ctx.createGain(); cg.gain.value = 0; cg.connect(this.ambGain);
    for (var i = 0; i < 2; i++) {
      var o = ctx.createOscillator(); o.type = 'square';
      o.frequency.value = 3900 + i * 420;
      var og = ctx.createGain(); og.gain.value = 0.012;
      var trem = ctx.createOscillator(); trem.type = 'sine'; trem.frequency.value = 7 + i * 3.5;
      var tg = ctx.createGain(); tg.gain.value = 0.010;
      trem.connect(tg); tg.connect(og.gain);
      o.connect(og); og.connect(cg);
      o.start(); trem.start();
    }
    this._cricketGain = cg;
  };

  A.setNight = function (isNight) {
    if (!this.ready || this._night === isNight) return;
    this._night = isNight;
    this._cricketGain.gain.setTargetAtTime(isNight ? 1 : 0, this.ctx.currentTime, 1.2);
  };

  /* ── 基础发声单元 ─────────────────────────────────── */
  A._tone = function (o) {
    if (!this.ready) return;
    var ctx = this.ctx, t = ctx.currentTime + (o.delay || 0);
    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + Math.min(0.02, o.dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(t); osc.stop(t + o.dur + 0.02);
  };

  A._noiseHit = function (o) {
    if (!this.ready || !this._noise) return;
    var ctx = this.ctx, t = ctx.currentTime + (o.delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.playbackRate.value = o.rate || 1;
    var f = ctx.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 900, t);
    if (o.freqTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.freqTo), t + o.dur);
    f.Q.value = o.q || 1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(t, Math.random() * 1.5); src.stop(t + o.dur + 0.02);
  };

  /* ── 具体音效 ─────────────────────────────────────── */
  A.step = function () {
    this._noiseHit({ dur: 0.11, freq: 420, freqTo: 180, gain: 0.05, filter: 'lowpass' });
  };
  A.pickup = function () {
    this._tone({ freq: 520, to: 790, dur: 0.11, gain: 0.1, type: 'triangle' });
    this._tone({ freq: 1040, dur: 0.07, gain: 0.035, type: 'sine', delay: 0.05 });
  };
  A.relic = function () {
    var n = [523, 659, 784, 1046];
    for (var i = 0; i < n.length; i++) this._tone({ freq: n[i], dur: 0.42, gain: 0.1, type: 'triangle', delay: i * 0.085 });
  };
  A.hurt = function () {
    this._tone({ freq: 190, to: 70, dur: 0.28, gain: 0.14, type: 'square' });
    this._noiseHit({ dur: 0.22, freq: 1200, freqTo: 240, gain: 0.1 });
  };
  A.growl = function () {
    this._tone({ freq: 96, to: 62, dur: 0.55, gain: 0.075, type: 'sawtooth' });
    this._noiseHit({ dur: 0.5, freq: 320, freqTo: 150, gain: 0.05 });
  };
  A.fire = function () {
    this._noiseHit({ dur: 0.7, freq: 300, freqTo: 2200, gain: 0.11, filter: 'bandpass', q: 0.9 });
    this._tone({ freq: 150, to: 90, dur: 0.4, gain: 0.06, type: 'sine' });
  };
  A.swing = function () {
    this._noiseHit({ dur: 0.22, freq: 2600, freqTo: 500, gain: 0.08, filter: 'bandpass', q: 1.4 });
  };
  A.eat = function () {
    this._tone({ freq: 300, to: 420, dur: 0.14, gain: 0.07, type: 'sine' });
  };
  A.click = function () {
    this._tone({ freq: 880, dur: 0.05, gain: 0.05, type: 'triangle' });
  };
  A.deny = function () {
    this._tone({ freq: 220, to: 160, dur: 0.18, gain: 0.07, type: 'sawtooth' });
  };
  A.win = function () {
    var n = [392, 523, 659, 784, 1046];
    for (var i = 0; i < n.length; i++) this._tone({ freq: n[i], dur: 0.9, gain: 0.1, type: 'triangle', delay: i * 0.13 });
  };
  /* ── 森林求生专用音效（spec 第八章） ── */
  A._collectPitch = 0;
  A.collect = function (score) {
    // 音高随连采递增
    this._collectPitch = Math.min(12, this._collectPitch + 1);
    var base = 620 + this._collectPitch * 28 + (score >= 3 ? 160 : 0);
    this._tone({ freq: base, to: base * 1.5, dur: 0.1, gain: 0.11, type: 'triangle' });
  };
  A.catchRabbit = function () {
    this._tone({ freq: 380, to: 720, dur: 0.14, gain: 0.1, type: 'square' });
  };
  A.bearAlert = function () {
    this._tone({ freq: 130, to: 84, dur: 0.45, gain: 0.11, type: 'sawtooth' });
    this._noiseHit({ dur: 0.3, freq: 300, freqTo: 140, gain: 0.05 });
  };
  A.bearStep = function () {
    this._noiseHit({ dur: 0.13, freq: 260, freqTo: 110, gain: 0.07 });
  };
  A.snakeHiss = function () {
    this._noiseHit({ dur: 0.42, freq: 5200, freqTo: 2600, gain: 0.07, filter: 'bandpass', q: 2.2 });
  };
  A.nightFall = function () {
    this._tone({ freq: 300, to: 72, dur: 1.1, gain: 0.11, type: 'sine' });
  };
  A.dawn = function () {
    var n = [392, 523, 659];
    for (var i = 0; i < n.length; i++) this._tone({ freq: n[i], dur: 0.55, gain: 0.09, type: 'triangle', delay: i * 0.11 });
  };
  A.decoy = function () {
    this._tone({ freq: 880, to: 1320, dur: 0.16, gain: 0.07, type: 'sine' });
  };
  A.lose = function () {
    var n = [330, 262, 208, 165];
    for (var i = 0; i < n.length; i++) this._tone({ freq: n[i], dur: 1.1, gain: 0.1, type: 'sine', delay: i * 0.19 });
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = DF.Audio; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));