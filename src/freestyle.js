// Freestyle trainer: a beat, a bar of four beats, and a word you have to land on beat 4. With the mic on, your voice
// is timed against the beat on this PC. Nothing is recorded or sent anywhere.
(() => {
  // Starting words per topic. Their rhyme partners come from the rhyme engine.
  const TOPICS = {
    money: ['cash', 'bank', 'gold', 'paid', 'rich', 'deal', 'stack', 'bag', 'chain', 'broke', 'grind', 'hustle', 'money', 'paper', 'profit', 'dollar', 'pocket', 'million', 'watch', 'ice', 'cost', 'loan', 'rent', 'trade'],
    street: ['block', 'corner', 'street', 'night', 'crew', 'trap', 'city', 'south', 'gang', 'cold', 'real', 'fight', 'trust', 'loyal', 'snake', 'rat', 'grit', 'concrete', 'alley', 'siren', 'court', 'time', 'jail', 'fence'],
    love: ['love', 'heart', 'kiss', 'tears', 'alone', 'ring', 'trust', 'lies', 'miss', 'night', 'touch', 'home', 'broken', 'promise', 'forever', 'lover', 'phone', 'text', 'rose', 'stay', 'leave', 'hurt', 'girl', 'baby'],
    mind: ['pain', 'mind', 'dark', 'soul', 'head', 'rain', 'ghost', 'demon', 'shadow', 'storm', 'sleep', 'dream', 'fear', 'scar', 'alone', 'silence', 'mirror', 'weight', 'sorrow', 'heal', 'lost', 'doubt', 'calm', 'grave'],
    dreams: ['dream', 'rise', 'crown', 'king', 'throne', 'climb', 'star', 'light', 'fire', 'legend', 'future', 'power', 'believe', 'mountain', 'freedom', 'victory', 'goal', 'fly', 'sky', 'win', 'hope', 'gold', 'name', 'stage'],
    party: ['party', 'dance', 'club', 'night', 'drink', 'bottle', 'vibe', 'lights', 'floor', 'crowd', 'smoke', 'music', 'bass', 'summer', 'weekend', 'shot', 'beat', 'fly', 'style', 'loud', 'fresh', 'wave', 'ride', 'drop'],
  };
  const TOPIC_NAMES = { all: 'All words', money: 'Money and hustle', street: 'Street', love: 'Love and heartbreak', mind: 'Pain and mind', dreams: 'Dreams and power', party: 'Party', slang: 'Slang', song: 'This song' };
  // Never served as a word to rap.
  const BLOCK = new Set(('nigger nigga niggas niggers faggot fag fags retard retarded whore slut cunt rape rapist raped chink coon spic dyke tranny kike jap gook wop homo negro ' +
    'fuck shit bitch cock dick pussy tits nazi incest molest').split(' '));
  const LEVELS = {
    easy: { name: 'Easy', minF: 400, syl: [1, 1], partnerSyl: [1, 2], ahead: 99 },
    medium: { name: 'Medium', minF: 120, syl: [1, 2], partnerSyl: [1, 3], ahead: 3 },
    hard: { name: 'Hard', minF: 40, syl: [2, 3], partnerSyl: [2, 4], ahead: 1 },
  };
  const SCHEMES = { aabb: { name: 'AABB', size: 2, order: [0, 0, 1, 1] }, abab: { name: 'ABAB', size: 2, order: [0, 1, 0, 1] }, chain: { name: 'AAAA', size: 4, order: [0, 0, 0, 0] } };

  // ---------- words ----------
  const pickFrom = (list, rand) => list[Math.floor(rand() * list.length)];
  function shuffle(list, rand) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // A run is a list of bars, each with the word to land and the rhyme family it belongs to.
  function makeRun(engine, opts, rand = Math.random) {
    const level = LEVELS[opts.level] || LEVELS.medium;
    const scheme = SCHEMES[opts.scheme] || SCHEMES.aabb;
    const slang = opts.topic === 'slang';
    const usedKeys = new Set(), usedWords = new Set();
    const sylOf = (w) => engine.syllables(w);
    const usable = (w, minF) => /^[a-z]+$/.test(w) && w.length > 2 && !BLOCK.has(w) && !usedWords.has(w) && (engine.freq(w) >= minF || (slang && engine.slang.has(w)));

    function family(seed, size, minF, partnerSyl) {
      const ph = engine.phones(seed);
      if (!ph) return null;
      const key = engine.perfectKey(ph);
      if (usedKeys.has(key) || BLOCK.has(seed) || usedWords.has(seed)) return null;
      const sounds = new Set([ph.join(' ')]);
      const pool = engine.find(seed).perfect.map((x) => x[0]).filter((w) => {
        if (!usable(w, minF) || w.endsWith(seed) || seed.endsWith(w)) return false;
        const s = sylOf(w);
        return s >= partnerSyl[0] && s <= partnerSyl[1];
      });
      // the most common rhymes first, with a little variety between runs
      const words = [seed];
      for (const w of shuffle(pool.slice(0, 14), rand)) {
        if (words.length >= size) break;
        const sound = engine.phones(w).join(' ');
        if (sounds.has(sound) || words.some((x) => x.endsWith(w) || w.endsWith(x))) continue; // homophones and sometime/time
        sounds.add(sound);
        words.push(w);
      }
      if (words.length < size) return null;
      usedKeys.add(key);
      words.forEach((w) => usedWords.add(w));
      return words;
    }

    let seeds;
    if (slang) seeds = [...engine.slang.keys()].filter((w) => /^[a-z]+$/.test(w));
    else if (opts.topic === 'song') seeds = (opts.songWords || []).map((w) => w.toLowerCase()).filter((w) => /^[a-z]+$/.test(w));
    else seeds = TOPICS[opts.topic] || [];
    const common = [...engine.words.keys()].filter((w) => {
      if (!usable(w, level.minF) || engine.isStop(w)) return false;
      const s = sylOf(w);
      return s >= level.syl[0] && s <= level.syl[1];
    });
    const queue = [...shuffle([...new Set(seeds)], rand), ...shuffle(common, rand)];

    const needed = Math.ceil(opts.bars / scheme.order.length) * (new Set(scheme.order).size);
    const families = [];
    for (const seed of queue) {
      if (families.length >= needed) break;
      const f = family(seed, scheme.size, level.minF, level.partnerSyl) || (seeds.includes(seed) ? family(seed, scheme.size, Math.min(level.minF, 30), [1, 4]) : null);
      if (f) families.push(f);
    }
    const bars = [];
    const groups = new Set(scheme.order).size;
    for (let g = 0; bars.length < opts.bars && g * groups < families.length; g++) {
      const fill = new Array(groups).fill(0);
      for (const slot of scheme.order) {
        if (bars.length >= opts.bars) break;
        const fi = g * groups + slot;
        bars.push({ word: families[fi][fill[slot]++], family: fi % 6 });
      }
    }
    return bars;
  }

  // ---------- timing ----------
  // Finds where a voice starts a sound: the short-term level jumping above the slower average.
  class OnsetDetector {
    constructor(sampleRate, { ratio = 2.2 } = {}) {
      this.sr = sampleRate;
      this.ratio = ratio;
      this.hop = Math.max(32, Math.round(sampleRate * 0.002));
      this.dt = this.hop / sampleRate;
      this.fast = 0; this.slow = 0;
      this.armed = true;
      this.last = -1;
      this.buf = 0; this.count = 0;
      this.aFast = Math.exp(-this.dt / 0.006);
      this.aSlow = Math.exp(-this.dt / 0.16);
    }
    // samples start at time t; returns the onset times found
    process(samples, t) {
      const out = [];
      for (let i = 0; i < samples.length; i++) {
        this.buf += samples[i] * samples[i];
        if (++this.count < this.hop) continue;
        const e = Math.sqrt(this.buf / this.count);
        this.buf = 0; this.count = 0;
        this.fast = e + (this.fast - e) * (e > this.fast ? 0.2 : this.aFast);
        this.slow = e + (this.slow - e) * this.aSlow;
        const now = t + i / this.sr;
        if (this.armed && this.fast > 0.012 && this.fast > this.slow * this.ratio && now - this.last > 0.085) {
          out.push(now);
          this.last = now;
          this.armed = false;
        } else if (!this.armed && this.fast < this.slow * 1.25) this.armed = true;
      }
      return out;
    }
  }

  const POINTS = { perfect: 100, great: 70, ok: 40, miss: 0 };
  // How close the nearest sound was to the landing time. `landing` already includes the timing correction.
  function gradeLanding(onsets, landing) {
    let best = null;
    for (const t of onsets) if (best == null || Math.abs(t - landing) < Math.abs(best - landing)) best = t;
    const delta = best == null ? null : best - landing;
    const a = delta == null ? Infinity : Math.abs(delta);
    const grade = a <= 0.05 ? 'perfect' : a <= 0.1 ? 'great' : a <= 0.2 ? 'ok' : 'miss';
    return { grade, delta: grade === 'miss' ? null : delta };
  }
  // Points for a bar: the landing, doubled up with a streak, halved if there was no rapping before the word.
  function barPoints(grade, flow, streak) {
    if (grade === 'miss') return 0;
    const mult = Math.min(4, 1 + Math.floor(streak / 4));
    return Math.round((flow ? POINTS[grade] : POINTS[grade] / 2) * mult);
  }

  // ---------- metronome ----------
  // One bar of clicks, accent on beat 1, looped for as long as the run lasts.
  async function renderClicks(bpm) {
    const SR = 44100, beat = 60 / bpm;
    const oc = new OfflineAudioContext(1, Math.round(beat * 4 * SR), SR);
    for (let i = 0; i < 4; i++) {
      const t = i * beat;
      const o = oc.createOscillator();
      o.frequency.value = i ? 1000 : 1500;
      const g = oc.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(i ? 0.5 : 0.75, t + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.connect(g).connect(oc.destination);
      o.start(t);
      o.stop(t + 0.06);
    }
    return oc.startRendering();
  }

  // ---------- the game ----------
  function init(d) {
    const { $, $$, esc, icon, logo, toast } = d;
    const page = () => $('#fs-page');
    const defaults = { beat: 'click', bpm: 90, topic: 'all', level: 'easy', scheme: 'aabb', bars: 16, mic: false, volume: 80 };
    const O = () => {
      const s = d.S();
      s.fs = { ...defaults, ...(s.fs || {}) };
      if (!s.fs.beat.startsWith('file:')) s.fs.beat = 'click'; // the built-in beats are gone
      return s.fs;
    };
    const stats = () => { const l = d.getLib(); l.freestyle = { runs: 0, bars: 0, best: 0, days: 0, lastDay: '', ...(l.freestyle || {}) }; return l.freestyle; };
    let g = null; // the run in progress
    let preview = null;
    const beatCache = new Map();

    const localBeats = () => d.getLib().beats.filter((b) => b.kind === 'file');

    async function getBeat(o) {
      if (o.beat.startsWith('file:')) {
        const b = d.getLib().beats.find((x) => 'file:' + x.id === o.beat);
        if (!b) throw new Error('That beat is gone');
        const buf = await LMAudio.decode(await d.api.readMedia('beat', b.file));
        if (!b.bpm || b.grid !== 2) {
          const manual = !!b.bpm && !b.bpmAuto;
          const grid = LMAudio.analyzeBeat(buf, manual ? b.bpm : null);
          if (grid) { b.bpm = grid.bpm; b.offset = grid.offset; b.grid = 2; if (!manual) b.bpmAuto = true; d.persist(); }
        }
        if (!b.bpm) throw new Error("Lemonade couldn't find the tempo of that beat");
        const bar = (60 / b.bpm) * 4;
        const offset = b.offset || 0;
        const bars = Math.floor((buf.duration - offset) / bar);
        if (bars < 1) throw new Error('That beat is shorter than a bar');
        return { buf, bpm: b.bpm, offset, loopEnd: offset + bars * bar };
      }
      if (!beatCache.has(o.bpm)) { beatCache.clear(); beatCache.set(o.bpm, await renderClicks(o.bpm)); }
      const buf = beatCache.get(o.bpm);
      return { buf, bpm: o.bpm, offset: 0, loopEnd: buf.duration };
    }
    function playLoop(beat, when) {
      const c = LMAudio.ctx();
      const src = c.createBufferSource();
      src.buffer = beat.buf;
      src.loop = true;
      src.loopStart = beat.offset;
      src.loopEnd = beat.loopEnd;
      const gain = c.createGain();
      gain.gain.value = O().volume / 100;
      src.connect(gain).connect(c.destination);
      src.start(when, beat.offset);
      return { src, gain };
    }
    function stopLoop(l, fade = 0.08) {
      if (!l) return;
      const c = LMAudio.ctx();
      l.gain.gain.setTargetAtTime(0, c.currentTime, fade / 3);
      try { l.src.stop(c.currentTime + fade); } catch {}
    }
    function stopPreview() {
      if (!preview) return;
      stopLoop(preview);
      preview = null;
      d.onEnd();
      const btn = $('#fs-preview');
      if (btn) btn.innerHTML = icon('play', 13) + 'Listen';
    }

    // The mic for the game: the voice filtered to its own range, with Chromium's echo cancelling taking out the beat.
    async function openVoice(onOnset) {
      const c = LMAudio.ctx();
      const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (d.S().micId) audio.deviceId = { exact: d.S().micId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      const src = c.createMediaStreamSource(stream);
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
      const size = 512;
      const proc = c.createScriptProcessor(size, 1, 1);
      const det = new OnsetDetector(c.sampleRate);
      proc.onaudioprocess = (e) => {
        for (const t of det.process(e.inputBuffer.getChannelData(0), e.playbackTime - size / c.sampleRate)) onOnset(t);
      };
      const mute = c.createGain(); mute.gain.value = 0;
      src.connect(hp).connect(lp).connect(proc).connect(mute).connect(c.destination);
      const close = () => {
        proc.onaudioprocess = null;
        try { src.disconnect(); proc.disconnect(); mute.disconnect(); } catch {}
        stream.getTracks().forEach((t) => t.stop());
      };
      return { close, inputLatency: stream.getAudioTracks()[0].getSettings().latency || 0 };
    }
    const correction = (voice) => {
      const saved = d.S().fsLatency;
      if (saved != null) return saved / 1000;
      const c = LMAudio.ctx();
      return (c.outputLatency || c.baseLatency || 0) + (voice?.inputLatency || 0);
    };

    // ---------- setup screen ----------
    function renderSetup() {
      const o = O(), st = stats();
      const seg = (key, opts) => `<div class="seg" data-fs="${key}">${opts.map(([v, label]) => `<button data-v="${v}" class="${String(o[key]) === String(v) ? 'active' : ''}">${label}</button>`).join('')}</div>`;
      const row = (title, desc, ctl) => `<div class="set-row"><div class="sr-text"><div class="sr-title">${title}</div>${desc ? `<div class="sr-desc">${desc}</div>` : ''}</div><div class="sr-ctl">${ctl}</div></div>`;
      const isFile = o.beat.startsWith('file:');
      const fileBeat = isFile && d.getLib().beats.find((x) => 'file:' + x.id === o.beat);
      const cal = d.S().fsLatency;
      page().innerHTML = `
        <div class="page-head fs-head">
          <div><h1>Freestyle</h1><p class="muted">Rap your bar over the beat and land the word on beat 4.</p></div>
          <div class="fs-stats">
            <div><b>${st.days}</b><span>day streak</span></div><div><b>${st.bars}</b><span>bars</span></div><div><b>${st.best}</b><span>best score</span></div>
          </div>
        </div>
        <div class="set-card fs-card">
          ${row('Beat', '', `<select id="fs-beat">
              <option value="click" ${o.beat === 'click' ? 'selected' : ''}>Metronome</option>
              ${localBeats().length ? `<optgroup label="Your beats">${localBeats().map((b) => `<option value="file:${b.id}" ${o.beat === 'file:' + b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</optgroup>` : ''}
            </select><button class="btn sm" id="fs-preview">${icon('play', 13)}Listen</button>`)}
          ${isFile ? row('Tempo', 'From your beat. Change it in the metronome menu.', `<span class="size-val">${fileBeat?.bpm ? d.fmtBpm(fileBeat.bpm) + ' BPM' : 'found when you start'}</span>`)
            : row('Tempo', '', `<input type="range" id="fs-bpm" min="60" max="170" step="1" value="${o.bpm}"/><span class="size-val" id="fs-bpm-val">${o.bpm} BPM</span>`)}
          ${row('Words', o.topic === 'song' ? 'Rhymes for the line endings and word bank of your open lyric.' : '', `<select id="fs-topic">${Object.entries(TOPIC_NAMES).map(([k, v]) => `<option value="${k}" ${o.topic === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
          ${row('Level', { easy: 'Short, common words. You see every word coming.', medium: 'Longer words. You see three bars ahead.', hard: 'Two syllables and up. You only see the next bar.' }[o.level], seg('level', Object.entries(LEVELS).map(([k, v]) => [k, v.name])))}
          ${row('Rhyme scheme', '', seg('scheme', Object.entries(SCHEMES).map(([k, v]) => [k, v.name])))}
          ${row('Length', '', seg('bars', [[8, '8 bars'], [16, '16 bars'], [32, '32 bars']]))}
          ${row('Volume', '', `<input type="range" id="fs-vol" min="0" max="100" value="${o.volume}"/>`)}
          ${row('Score my timing', 'Times your voice against the beat on this PC. Nothing is recorded. Use headphones. It hears when you land, not which word you said.',
            `<label class="toggle"><input type="checkbox" id="fs-mic" ${o.mic ? 'checked' : ''}/><span></span></label>`)}
          ${o.mic ? row('Timing correction', cal != null ? `Set to ${Math.round(cal)} ms. Run it again after changing mic or headphones.` : 'Say "ta" on eight clicks, so your speakers and mic delay stop costing you points.',
            `<button class="btn sm" id="fs-calibrate">${icon('metronome', 14)}${cal != null ? 'Run again' : 'Set up'}</button>`) : ''}
        </div>
        <div class="fs-go"><button class="btn primary fs-play" id="fs-start">${icon('play', 15)}Start</button></div>
        <div class="fs-sprint"><div><b>Rhyme sprint</b><span>60 seconds, one word. Type every rhyme you can, then see what you missed and what it means.${d.getLib().sprint?.best ? ` Your best: ${d.getLib().sprint.best}.` : ''}</span></div>
          <button class="btn" id="fs-sprint">${icon('play', 13)}Go</button></div>`;
      $$('input[type=range]', page()).forEach(d.setRangeFill);
      requestAnimationFrame(() => d.inkSegs(page()));
    }

    function bind() {
      const root = page();
      root.addEventListener('click', async (e) => {
        const seg = e.target.closest('[data-fs] button');
        if (seg) {
          const key = seg.parentElement.dataset.fs;
          O()[key] = key === 'bars' ? +seg.dataset.v : seg.dataset.v;
          d.persist();
          $$('button', seg.parentElement).forEach((b) => b.classList.toggle('active', b === seg));
          if (key === 'level') renderSetup();
          return;
        }
        const id = e.target.closest('button')?.id;
        if (id === 'fs-start') start();
        if (id === 'fs-calibrate') calibrate();
        if (id === 'fs-sprint') { stopPreview(); d.openSprint(); }
        if (id === 'fs-preview') {
          if (preview) return stopPreview();
          const btn = $('#fs-preview');
          btn.disabled = true;
          try {
            const loop = playLoop(await getBeat(O()), LMAudio.ctx().currentTime + 0.05);
            d.onStart();
            preview = loop;
            btn.innerHTML = icon('stop', 13) + 'Stop';
          } catch (err) { toast(err.message, 'x'); }
          btn.disabled = false;
        }
        const r = e.target.closest('[data-res]')?.dataset.res;
        if (r === 'again') start(g?.lastRun);
        if (r === 'new') start();
        if (r === 'setup') { g = null; renderSetup(); }
        if (r === 'save') saveWords();
        if (e.target.closest('#fs-pause')) togglePause();
        if (e.target.closest('#fs-quit')) quit();
      });
      root.addEventListener('change', (e) => {
        const o = O();
        if (e.target.id === 'fs-beat') {
          stopPreview();
          o.beat = e.target.value;
          d.persist(); renderSetup();
        }
        if (e.target.id === 'fs-topic') { o.topic = e.target.value; d.persist(); renderSetup(); }
        if (e.target.id === 'fs-mic') { o.mic = e.target.checked; d.persist(); renderSetup(); }
        if (e.target.id === 'fs-bpm') { if (preview) { stopPreview(); } d.persist(); }
      });
      root.addEventListener('input', (e) => {
        const o = O();
        if (e.target.id === 'fs-bpm') { o.bpm = +e.target.value; $('#fs-bpm-val').textContent = o.bpm + ' BPM'; d.setRangeFill(e.target); }
        if (e.target.id === 'fs-vol') {
          o.volume = +e.target.value;
          d.setRangeFill(e.target);
          if (preview) preview.gain.gain.value = o.volume / 100;
          d.persist();
        }
      });
    }

    // ---------- calibration ----------
    async function calibrate() {
      if (d.busy()) return toast('Stop recording first', 'mic');
      stopPreview();
      d.onStart();
      const c = LMAudio.ctx();
      const hits = [];
      let voice;
      try { voice = await openVoice((t) => hits.push(t)); } catch { d.onEnd(); return toast('No microphone available', 'x'); }
      const spb = 0.6, lead = 4, count = 8;
      const t0 = c.currentTime + 0.4;
      const clicks = [];
      for (let i = 0; i < lead + count; i++) {
        const t = t0 + i * spb;
        const o = c.createOscillator();
        o.frequency.value = i < lead ? 900 : 1400;
        const a = c.createGain();
        a.gain.setValueAtTime(0.0001, t);
        a.gain.exponentialRampToValueAtTime(0.5, t + 0.002);
        a.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        o.connect(a).connect(c.destination);
        o.start(t); o.stop(t + 0.07);
        if (i >= lead) clicks.push(t);
      }
      const btn = $('#fs-calibrate');
      if (btn) { btn.disabled = true; btn.textContent = 'Listen for 4 clicks, then say "ta" on the high ones'; }
      await new Promise((r) => setTimeout(r, (0.4 + (lead + count) * spb + 0.4) * 1000));
      voice.close();
      d.onEnd();
      const deltas = [];
      for (const t of clicks) {
        let best = null;
        for (const h of hits) if (h > t - 0.2 && h < t + 0.4 && (best == null || Math.abs(h - t) < Math.abs(best - t))) best = h;
        if (best != null) deltas.push(best - t);
      }
      if (deltas.length < 5) { toast("Didn't hear you on enough clicks. Try again a bit louder.", 'mic'); renderSetup(); return; }
      deltas.sort((a, b) => a - b);
      d.S().fsLatency = Math.round(deltas[Math.floor(deltas.length / 2)] * 1000);
      d.persist();
      toast(`Timing correction set to ${d.S().fsLatency} ms`, 'metronome');
      renderSetup();
    }

    // ---------- playing ----------
    async function start(sameRun) {
      if (d.busy()) return toast('Stop recording first', 'mic');
      if (g?.running) return;
      stopPreview();
      const o = O();
      const opts = { ...o, songWords: o.topic === 'song' ? d.songWords() : [] };
      const bars = sameRun && sameRun.length === o.bars ? sameRun : makeRun(d.engine, opts);
      if (bars.length < o.bars) return toast('Not enough rhymes for that setup. Try another topic or level.', 'x');
      const btn = $('#fs-start');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-dots"><i></i><i></i><i></i></span>'; }
      let beat;
      try { beat = await getBeat(o); } catch (err) { if (btn) { btn.disabled = false; btn.innerHTML = icon('play', 15) + 'Start'; } return toast(err.message, 'x'); }
      d.onStart();
      const c = LMAudio.ctx();
      await c.resume();
      const spb = 60 / beat.bpm;
      g = { running: true, paused: false, bars, opts: o, spb, barDur: spb * 4, intro: 1, onsets: [], results: [], score: 0, streak: 0, bestStreak: 0, judged: 0, cur: -2, lastBeat: -1, count: null, voice: null, raf: 0 };
      if (o.mic) {
        try { g.voice = await openVoice((t) => g?.onsets.push(t)); }
        catch { toast('No microphone available, playing without the score', 'x'); }
      }
      g.scored = !!g.voice;
      g.comp = correction(g.voice);
      renderStage();
      g.t0 = c.currentTime + 0.25;
      g.loop = playLoop(beat, g.t0);
      g.end = g.t0 + (g.intro + bars.length) * g.barDur;
      g.outLat = c.outputLatency || c.baseLatency || 0;
      tick();
    }

    const ROW = 62;
    function renderStage() {
      const lvl = LEVELS[g.opts.level];
      page().innerHTML = `
        <div class="fs-stage">
          <div class="fs-hud">
            <div class="fs-hud-l"><span class="fs-barno" id="fs-barno">Get ready</span></div>
            ${g.scored ? '<div class="fs-score"><b id="fs-score">0</b><span id="fs-mult"></span></div>' : ''}
            <div class="fs-hud-r"><button class="icon-btn" id="fs-pause" title="Pause (Space)">${icon('pause', 15)}</button><button class="icon-btn" id="fs-quit" title="Stop (Esc)">${icon('x', 15)}</button></div>
          </div>
          <div class="fs-progress"><div id="fs-prog"></div></div>
          <div class="fs-window" id="fs-window">
            <div class="fs-rows" id="fs-rows">
              ${g.bars.map((b, i) => `<div class="fs-row" data-i="${i}"><div class="fs-cell"></div><div class="fs-cell"></div><div class="fs-cell"></div><div class="fs-word fam${b.family}"><span>${esc(b.word)}</span></div></div>`).join('')}
            </div>
            <div class="fs-ball" id="fs-ball">${logo(30, 'spinning')}</div>
            <div class="fs-count" id="fs-count"></div>
            <div class="fs-paused" id="fs-paused" hidden>Paused<small>Space to carry on</small></div>
          </div>
          <div class="pf-hint">${g.scored ? 'Say the word when the lemon lands on it' : 'Rap your bar and land the word when the lemon hits it'} · Space pause · Esc stop</div>
        </div>`;
      g.rows = $$('.fs-row', page());
      g.ahead = lvl.ahead;
      setCurrent(-1);
    }
    function setCurrent(i) {
      g.cur = i;
      g.rows.forEach((r, k) => {
        r.classList.toggle('cur', k === i);
        r.classList.toggle('past', k < i);
        r.classList.toggle('veil', k > i + g.ahead);
      });
      $('#fs-rows').style.transform = `translateY(${(1 - Math.max(i, 0)) * ROW}px)`;
      const no = $('#fs-barno');
      if (no) no.textContent = i < 0 ? 'Get ready' : `Bar ${i + 1} of ${g.bars.length}`;
    }
    function tick() {
      if (!g?.running) return;
      g.raf = requestAnimationFrame(tick);
      if (g.paused) return;
      const c = LMAudio.ctx();
      const now = c.currentTime;
      const vt = now - g.outLat; // what you hear right now
      const beats = (vt - g.t0) / g.spb;
      const totalIntro = g.intro * 4;
      // the lemon hops from beat to beat, and over to the next bar during the last hop
      const whole = Math.floor(beats), f = Math.max(0, beats - whole);
      const inBar = ((whole % 4) + 4) % 4;
      const win = $('#fs-window');
      const W = win.clientWidth;
      const cell = (W - 24) / 4;
      const cx = (k) => k * (cell + 8) + cell / 2;
      const nextCell = (inBar + 1) % 4;
      const x = cx(inBar) + (cx(nextCell) - cx(inBar)) * f;
      const y = ROW - 16 - 4 * f * (1 - f) * 40; // rests on the top edge of the bar, so the word stays readable
      const ball = $('#fs-ball');
      ball.style.transform = `translate(${x - 15}px, ${y}px)`;
      // the next bar slides in during the hop back
      const barIndex = Math.max(-1, Math.floor((beats - totalIntro + 0.45) / 4));
      if (barIndex !== g.cur && barIndex < g.bars.length) setCurrent(barIndex);
      // count in
      const count = beats < totalIntro && beats >= 0 ? 4 - inBar : null;
      if (count !== g.count) {
        g.count = count;
        $('#fs-count').innerHTML = count ? `<span>${count}</span>` : '';
      }
      // the word lights up as the lemon lands
      if (whole !== g.lastBeat) {
        g.lastBeat = whole;
        if (inBar === 3 && g.cur >= 0) g.rows[g.cur]?.classList.add('land');
      }
      const prog = $('#fs-prog');
      if (prog) prog.style.width = Math.max(0, Math.min(100, ((beats - totalIntro) / (g.bars.length * 4)) * 100)) + '%';
      judge(now);
      if (now >= g.end + 0.3) finish();
    }
    // A bar is judged once its landing time has passed by more than the widest window.
    function judge(now) {
      if (!g.scored) return;
      while (g.judged < g.bars.length) {
        const i = g.judged;
        const barStart = g.t0 + (g.intro + i) * g.barDur + g.comp;
        const landing = barStart + 3 * g.spb;
        if (now < landing + 0.28) break;
        const near = g.onsets.filter((t) => t > landing - 0.3 && t < landing + 0.3);
        const res = gradeLanding(near, landing);
        const flow = g.onsets.filter((t) => t >= barStart - 0.1 && t < landing - 0.12).length >= 2;
        if (res.grade === 'miss') g.streak = 0;
        const pts = barPoints(res.grade, flow, g.streak);
        if (res.grade !== 'miss') g.streak++;
        g.bestStreak = Math.max(g.bestStreak, g.streak);
        g.score += pts;
        g.results.push({ ...res, flow, pts });
        g.judged++;
        const word = g.rows[i]?.querySelector('.fs-word');
        if (word) {
          word.classList.add('g-' + res.grade);
          word.insertAdjacentHTML('beforeend', `<em class="fs-grade">${{ perfect: 'Perfect', great: 'Great', ok: 'OK', miss: 'Miss' }[res.grade]}</em>`);
        }
        $('#fs-score').textContent = g.score;
        const mult = Math.min(4, 1 + Math.floor(g.streak / 4));
        $('#fs-mult').textContent = mult > 1 ? `x${mult}` : '';
      }
    }
    function togglePause() {
      if (!g?.running) return;
      const c = LMAudio.ctx.raw();
      g.paused = !g.paused;
      if (g.paused) c.suspend(); else c.resume();
      $('#fs-paused').hidden = !g.paused;
      $('#fs-pause').innerHTML = icon(g.paused ? 'play' : 'pause', 15);
    }
    function teardown() {
      if (!g) return;
      cancelAnimationFrame(g.raf);
      g.running = false;
      if (g.paused) { g.paused = false; LMAudio.ctx.raw().resume(); }
      stopLoop(g.loop, 0.4);
      g.voice?.close();
      d.onEnd();
    }
    function quit() {
      if (!g?.running) return false;
      teardown();
      g = null;
      renderSetup();
      return true;
    }
    function finish() {
      judge(Infinity);
      teardown();
      const s = stats();
      const day = new Date().toLocaleDateString('en-CA');
      if (s.lastDay !== day) {
        const y = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
        s.days = s.lastDay === y ? s.days + 1 : 1;
        s.lastDay = day;
      }
      s.runs++;
      s.bars += g.bars.length;
      const newBest = g.scored && g.score > s.best;
      if (newBest) s.best = g.score;
      d.persist();
      g.lastRun = g.bars;
      renderResults(newBest);
    }
    function renderResults(newBest) {
      const r = g.results, n = g.bars.length;
      const hit = r.filter((x) => x.grade !== 'miss');
      const perfect = r.filter((x) => x.grade === 'perfect').length;
      const avg = hit.length ? Math.round((hit.reduce((a, x) => a + x.delta, 0) / hit.length) * 1000) : 0;
      const lean = !hit.length ? '' : Math.abs(avg) < 15 ? 'Right on the beat.' : avg > 0 ? `You land about ${avg} ms late.` : `You land about ${-avg} ms early.`;
      page().innerHTML = `
        <div class="fs-results">
          ${g.scored ? `
            <div class="fs-big">${g.score}<small>${newBest ? 'New best' : 'points'}</small></div>
            <div class="fs-res-row"><div><b>${hit.length}/${n}</b><span>words landed</span></div><div><b>${perfect}</b><span>perfect</span></div><div><b>${g.bestStreak}</b><span>best streak</span></div></div>
            <div class="fs-strip">${r.map((x, i) => `<i class="g-${x.grade}" title="Bar ${i + 1}: ${esc(g.bars[i].word)} · ${x.grade}${x.delta != null ? ` (${x.delta > 0 ? '+' : ''}${Math.round(x.delta * 1000)} ms)` : ''}"></i>`).join('')}</div>
            <p class="muted fs-lean">${lean}${r.some((x) => x.grade !== 'miss' && !x.flow) ? ' Some bars only had the last word: rap the whole bar for full points.' : ''}</p>`
            : `<div class="fs-big">${n}<small>bars done</small></div><p class="muted fs-lean">Turn on Score my timing to get graded on your landings.</p>`}
          <div class="fs-res-acts">
            <button class="btn primary" data-res="new">${icon('plus', 14)}New words</button>
            <button class="btn" data-res="again">${icon('restore', 14)}Same words</button>
            <button class="btn" data-res="save" title="Opens these words as a new lyric">${icon('write', 14)}Write with these</button>
            <button class="btn ghost" data-res="setup">Settings</button>
          </div>
        </div>`;
    }
    function saveWords() {
      if (!g?.bars) return;
      d.saveLyric(`Freestyle ${new Date().toLocaleDateString()}`, '[Freestyle]\n' + g.bars.map((b) => `… ${b.word}`).join('\n') + '\n');
    }

    bind();
    return {
      open() { if (!g) renderSetup(); },
      // leaving the view stops whatever is playing
      leave() { stopPreview(); if (g?.running) quit(); },
      keys(e) {
        if (!g?.running) return false;
        if (e.key === 'Escape') { quit(); return true; }
        if (e.key === ' ') { e.preventDefault(); togglePause(); return true; }
        return false;
      },
      get running() { return !!g?.running; },
    };
  }

  window.Freestyle = { BLOCK, init, makeRun, OnsetDetector, gradeLanding, barPoints, TOPICS, LEVELS };
})();
