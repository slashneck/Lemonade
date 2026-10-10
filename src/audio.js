// Audio utilities: metronome, waveform peaks, BPM detection, WAV encoding, mixing.
(() => {
  let _ctx = null;
  const ctx = () => {
    if (!_ctx) _ctx = new AudioContext({ latencyHint: 'interactive' });
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  };

  // ---------- Metronome ----------
  // A classic, soft "tick": a very short sine blip with a tiny noise transient.
  let noiseBuf = null;
  function tick(time, accent, volume) {
    const c = ctx();
    const out = c.createGain();
    out.gain.value = volume;
    out.connect(c.destination);

    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(accent ? 0.55 : 0.38, time + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    osc.connect(g).connect(out);
    osc.start(time);
    osc.stop(time + 0.06);

    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.01), c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    }
    const n = c.createBufferSource();
    n.buffer = noiseBuf;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const ng = c.createGain();
    ng.gain.value = accent ? 0.16 : 0.1;
    n.connect(hp).connect(ng).connect(out);
    n.start(time);
  }

  class Metronome {
    constructor() {
      this.bpm = 90; this.volume = 0.5; this.beats = 4; this.running = false;
      this.onTick = null; this.timer = null;
    }
    // startAt: AudioContext time of beat 1 (defaults to "now")
    start(startAt, firstIndex = 0) {
      const c = ctx();
      this.stop();
      this.running = true;
      this.t0 = startAt ?? c.currentTime + 0.06;
      this.n = firstIndex;
      this.next = this.t0;
      const schedule = () => {
        const spb = 60 / this.bpm;
        while (this.next < c.currentTime + 0.12) {
          const beat = this.n % this.beats;
          if (this.next >= c.currentTime - 0.01) {
            tick(this.next, beat === 0, this.volume);
            const delay = Math.max(0, (this.next - c.currentTime) * 1000);
            const n = this.n;
            setTimeout(() => this.running && this.onTick && this.onTick(beat, n), delay);
          }
          this.n++;
          this.next += spb;
        }
      };
      schedule();
      this.timer = setInterval(schedule, 25);
    }
    stop() { this.running = false; clearInterval(this.timer); this.timer = null; }
    setBpm(bpm) { this.bpm = Math.max(30, Math.min(300, bpm)); }
  }

  // ---------- Analysis ----------
  const toArrayBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const decode = (u8) => ctx().decodeAudioData(toArrayBuffer(u8));

  function peaks(buf, n = 480) {
    const ch = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i));
    const size = Math.floor(buf.length / n) || 1;
    const out = new Array(n).fill(0);
    let max = 0;
    for (let i = 0; i < n; i++) {
      let m = 0;
      const start = i * size, end = Math.min(buf.length, start + size);
      for (let j = start; j < end; j += 16) for (const c of ch) { const v = Math.abs(c[j]); if (v > m) m = v; }
      out[i] = m;
      if (m > max) max = m;
    }
    return out.map((v) => Math.round((v / (max || 1)) * 1000) / 1000);
  }

  // Onset-envelope autocorrelation tempo estimate (good enough for most beats).
  function detectBpm(buf) {
    const sr = buf.sampleRate;
    const hop = 512;
    const len = Math.min(buf.length, sr * 60);
    const ch = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i));
    const frames = Math.floor(len / hop);
    if (frames < 200) return null;
    const env = new Float32Array(frames);
    let prev = 0;
    for (let f = 0; f < frames; f++) {
      let e = 0;
      for (let j = f * hop; j < f * hop + hop; j += 2) { let s = 0; for (const c of ch) s += c[j]; e += s * s; }
      e = Math.log1p(e * 10);
      env[f] = Math.max(0, e - prev);
      prev = e;
    }
    const mean = env.reduce((a, b) => a + b, 0) / frames;
    for (let i = 0; i < frames; i++) env[i] = Math.max(0, env[i] - mean);
    const fps = sr / hop;
    const ac = (lag) => {
      const l0 = Math.floor(lag), fr = lag - l0;
      let s = 0;
      for (let i = 0; i + l0 + 1 < frames; i++) s += env[i] * (env[i + l0] * (1 - fr) + env[i + l0 + 1] * fr);
      return s;
    };
    let best = null, bestScore = -1;
    for (let bpm = 65; bpm <= 175; bpm += 0.5) {
      const lag = (60 * fps) / bpm;
      const score = ac(lag) + 0.5 * ac(lag * 2) + 0.25 * ac(lag / 2);
      if (score > bestScore) { bestScore = score; best = bpm; }
    }
    return best ? Math.round(best) : null;
  }

  // ---------- Export ----------
  function encodeWav(buf) {
    const chs = Math.min(2, buf.numberOfChannels), sr = buf.sampleRate, len = buf.length;
    const out = new DataView(new ArrayBuffer(44 + len * chs * 2));
    const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); out.setUint32(4, 36 + len * chs * 2, true); w(8, 'WAVEfmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, chs, true);
    out.setUint32(24, sr, true); out.setUint32(28, sr * chs * 2, true); out.setUint16(32, chs * 2, true);
    out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, len * chs * 2, true);
    const data = [...Array(chs)].map((_, i) => buf.getChannelData(i));
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < chs; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
    return out.buffer;
  }

  // Vocal over beat, beat starting at `beatOffset` seconds; beat loops if the take runs longer.
  async function mix(vocal, beat, beatOffset = 0, { vocalGain = 1, beatGain = 0.8 } = {}) {
    const sr = 44100;
    const length = Math.ceil(vocal.duration * sr) + sr / 2;
    const oc = new OfflineAudioContext(2, length, sr);
    const b = oc.createBufferSource();
    b.buffer = beat; b.loop = true;
    const bg = oc.createGain(); bg.gain.value = beatGain;
    b.connect(bg).connect(oc.destination);
    b.start(0, beatOffset % beat.duration);
    const v = oc.createBufferSource();
    v.buffer = vocal;
    const vg = oc.createGain(); vg.gain.value = vocalGain;
    v.connect(vg).connect(oc.destination);
    v.start(0);
    const out = await oc.startRendering();
    // gentle peak normalize to avoid clipping
    let max = 0;
    for (let c = 0; c < out.numberOfChannels; c++) for (const s of out.getChannelData(c)) if (Math.abs(s) > max) max = Math.abs(s);
    if (max > 0.98) for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= 0.98 / max; }
    return out;
  }

  window.LMAudio = { ctx, Metronome, decode, peaks, detectBpm, encodeWav, mix };
})();
