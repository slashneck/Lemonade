// Small helpers for writing, all working from your own words: your bars that rhyme, saved bars, a note when you lean on
// a word too much, a flow guide made from a mumble, and the rhyme sprint.
(() => {
  const WORD = /[a-z][a-z'’]*/gi;
  const OVERUSED = 5;
  const isSection = (x) => /^\s*\[[^\]]*\]\s*$/.test(x);

  // Where the sounds fell in a bar: 16 steps as hex, plus how many sounds there were.
  function barRhythm(onsets, barStart, barDur) {
    let mask = 0, count = 0;
    for (const t of onsets) {
      const step = Math.floor(((t - barStart) / barDur) * 16 + 0.5);
      if (t < barStart - barDur / 32 || step > 15) continue;
      mask |= 1 << (15 - Math.max(0, step));
      count++;
    }
    return { count, rhythm: mask.toString(16).padStart(4, '0') };
  }
  // The bars of a mumble, without the silence before you came in and after you stopped.
  function flowRows(onsets, t0, bar) {
    if (!onsets.length) return [];
    const last = Math.floor((onsets[onsets.length - 1] - t0) / bar);
    const rows = [];
    for (let i = 0; i <= last; i++) {
      const start = t0 + i * bar;
      rows.push(barRhythm(onsets.filter((t) => t >= start - bar / 32 && t < start + bar - bar / 32), start, bar));
    }
    while (rows.length && !rows[0].count) rows.shift();
    while (rows.length && !rows[rows.length - 1].count) rows.pop();
    return rows;
  }

  function songLines(lyrics) {
    const out = [];
    for (const l of lyrics) for (const line of l.body.split('\n')) {
      if (line.trim() && !isSection(line)) out.push({ line, lyric: l });
    }
    return out;
  }
  function wordCounts(lyrics) {
    const counts = new Map();
    for (const { line } of songLines(lyrics)) {
      for (const t of line.match(WORD) || []) {
        const w = t.toLowerCase().replace(/’/g, "'");
        counts.set(w, (counts.get(w) || 0) + 1);
      }
    }
    return counts;
  }
  // Set when you've used a word a lot: how often, and rhymes for it you have never used.
  function overuse(word, lyrics, engine) {
    const w = (word || '').toLowerCase();
    if (w.length < 3 || engine.isStop(w)) return null;
    const counts = wordCounts(lyrics);
    const count = counts.get(w) || 0;
    if (count < OVERUSED) return null;
    const common = engine.find(w).perfect.filter(([x]) => engine.freq(x) >= 20 && /^[a-z]+$/.test(x) && !Freestyle.BLOCK.has(x));
    const fresh = common.filter(([x]) => !counts.has(x));
    // if you've used none of them, the rhyme list below already says it all
    return { count, fresh: fresh.length < common.length ? fresh.slice(0, 8) : [] };
  }
  function barsThatFit(word, saved, lyrics, openId, engine, limit = 14) {
    if (!word) return [];
    const out = [];
    const add = (text, source, savedId) => {
      const toks = text.match(WORD);
      if (!toks) return;
      const last = toks[toks.length - 1].toLowerCase();
      if (last === word.toLowerCase()) return;
      const level = engine.rhymeLevel(word, last);
      if (level) out.push({ text, source, level, savedId, syl: toks.reduce((a, t) => a + engine.syllables(t), 0) });
    };
    for (const v of saved) add(v.text, 'Saved', v.id);
    for (const { line, lyric } of songLines(lyrics.filter((l) => l.id !== openId))) add(line.trim(), lyric.title || 'Untitled');
    const seen = new Set();
    return out.filter((x) => !seen.has(x.text) && seen.add(x.text)).sort((a, b) => b.level - a.level || (a.savedId ? -1 : 1)).slice(0, limit);
  }

  // ---------- rhyme sprint ----------
  const sprintAnswers = (engine, seed) => engine.find(seed).perfect.map((x) => x[0]).filter((w) => engine.freq(w) >= 40 && /^[a-z]+$/.test(w) && !Freestyle.BLOCK.has(w));
  function sprintSeed(engine, rand = Math.random) {
    const pool = [];
    for (const [w, v] of engine.words) {
      if (v.f >= 1500 && /^[a-z]+$/.test(w) && w.length > 2 && !engine.isStop(w) && !Freestyle.BLOCK.has(w) && engine.syllables(w) <= 2) pool.push(w);
    }
    for (let i = 0; i < 60; i++) {
      const w = pool[Math.floor(rand() * pool.length)];
      if (sprintAnswers(engine, w).length >= 12) return w;
    }
    return 'time';
  }
  // 2 perfect rhyme, 1 same vowels, 0 no. Made-up words don't count.
  function judgeSprint(engine, known, seed, raw) {
    const w = raw.trim().toLowerCase().replace(/’/g, "'");
    if (!w || w === seed || !/^[a-z']+$/.test(w) || !known(w)) return { w, level: 0 };
    return { w, level: engine.rhymeLevel(seed, w) };
  }

  function init(d) {
    const { $, esc, icon, toast } = d;
    const lib = () => d.getLib();
    const songs = () => lib().lyrics.filter((l) => !l.archived);

    function insertBelowCaret(text) {
      const pad = d.pad;
      pad.focus();
      const lineEnd = pad.value.indexOf('\n', pad.selectionStart);
      const at = lineEnd < 0 ? pad.value.length : lineEnd;
      pad.setSelectionRange(at, at);
      document.execCommand('insertText', false, (pad.value.slice(0, at).endsWith('\n') || !at ? '' : '\n') + text);
    }

    // ---------- saved bars and the Mine tab ----------
    function saveBar(text, source) {
      const t = text.trim();
      if (!t) return;
      if (lib().vault.some((v) => v.text === t)) return toast('You already saved that bar', 'star');
      lib().vault.unshift({ id: d.uid(), text: t, source: source || '', created: d.now() });
      d.persist();
      toast('Bar saved. It shows up under Mine when it rhymes.', 'star');
    }
    const fit = (word) => barsThatFit(word, lib().vault, songs(), d.current()?.id, d.engine);
    function mineHtml(list) {
      const saved = lib().vault;
      const bars = list.length
        ? list.map((x, i) => `<button class="mine-bar ${x.level === 2 ? 'perfect' : ''}" data-mine="${i}" data-key="mine|${esc(x.text)}" title="Insert below your current bar"><span>${esc(x.text)}</span><small>${esc(x.source)} · ${x.syl} syllables</small></button>`).join('')
        : '<div class="rh-empty">None of your bars rhyme with this yet. This fills up from your other songs and the bars you save with Ctrl+Shift+B.</div>';
      const all = saved.length ? `<details class="rh-group rare mine-saved"><summary><h4>${icon('chevron', 12)}All saved bars<span class="cnt">${saved.length}</span></h4></summary>
        ${saved.map((v) => `<div class="mine-row"><span>${esc(v.text)}</span><button class="icon-btn xs" data-unsave="${v.id}" title="Delete">${icon('x', 13)}</button></div>`).join('')}</details>` : '';
      return bars + all;
    }
    function bindMine(body, list, rerender) {
      body.addEventListener('click', (e) => {
        const m = e.target.closest('[data-mine]');
        if (m) { insertBelowCaret(list()[+m.dataset.mine].text); return; }
        const x = e.target.closest('[data-unsave]');
        if (x) { lib().vault = lib().vault.filter((v) => v.id !== x.dataset.unsave); d.persist(); rerender(); }
      });
    }

    // ---------- flow guide ----------
    // Shows the mumbled rhythm of the bar you're on, above the lyric.
    function renderFlow() {
      const el = $('#flow-strip');
      const l = d.current();
      const rows = l?.flow?.rows;
      el.hidden = !rows?.length;
      if (el.hidden) return;
      const pad = d.pad;
      const lines = pad.value.split('\n');
      const here = d.lineIndexAt(pad.selectionStart);
      let bar = 0;
      for (let i = 0; i < here; i++) if (lines[i].trim() && !isSection(lines[i])) bar++;
      const row = rows[bar];
      const toks = lines[here] && !isSection(lines[here]) ? lines[here].match(WORD) : null;
      const wrote = toks ? toks.reduce((a, t) => a + d.engine.syllables(t), 0) : 0;
      let cells = '';
      if (row) {
        const mask = parseInt(row.rhythm, 16);
        for (let k = 0; k < 16; k++) cells += `${k && k % 4 === 0 ? '<u></u>' : ''}<i class="${(mask >> (15 - k)) & 1 ? 'on' : ''}"></i>`;
      }
      const take = l.takes?.find((t) => t.id === l.flow.takeId);
      el.innerHTML = `<b>Flow</b>${row ? `<span class="flow-steps">${cells}</span><span class="flow-info">Bar ${bar + 1} of ${rows.length} · ${row.count} sounds${wrote ? ` · you wrote ${wrote}` : ''}</span>` : `<span class="flow-info">Past the end of your mumble</span>`}
        ${take ? `<button class="icon-btn xs" data-flow="play" title="Play the mumble">${icon('play', 13)}</button>` : ''}
        <button class="icon-btn xs" data-flow="close" title="Remove the guide">${icon('x', 13)}</button>`;
    }

    // ---------- mumble ----------
    // One press to start, one to stop. The beat starts from its first downbeat, or a click if none is loaded.
    let mum = null;
    const mumbling = () => !!mum;
    function setMumbleUi(on) {
      const btn = $('#mumble-btn');
      btn.classList.toggle('on', on);
      btn.innerHTML = on ? icon('stop', 13) + 'Stop mumbling' : icon('mic', 14) + 'Mumble';
    }
    async function toggleMumble() {
      if (mum) return stopMumble();
      const l = d.current();
      if (!l) return toast('Open a lyric first', 'x');
      if (d.busy()) return toast('Stop recording first', 'mic');
      d.stopTake();
      let m;
      try { m = await d.openMic(); } catch { return toast('No microphone available', 'x'); }
      const c = LMAudio.ctx();
      const b = d.player.beat?.kind === 'file' && d.player.beat.bpm ? d.player.beat : null;
      const bpm = b ? b.bpm : d.S().metroBpm || 90;
      const onsets = [];
      const det = new Freestyle.OnsetDetector(c.sampleRate, { ratio: 1.7 });
      const size = 512;
      const proc = c.createScriptProcessor(size, 1, 1);
      proc.onaudioprocess = (e) => { for (const t of det.process(e.inputBuffer.getChannelData(0), e.playbackTime - size / c.sampleRate)) onsets.push(t); };
      const mute = c.createGain();
      mute.gain.value = 0;
      m.analyser.connect(proc);
      proc.connect(mute).connect(c.destination);
      d.metro.stop();
      let t0, beatPos = null;
      if (b) {
        const audio = d.audio;
        if (audio.readyState < 1) await new Promise((r) => audio.addEventListener('loadedmetadata', r, { once: true }));
        const offset = b.offset || 0;
        audio.currentTime = offset;
        await audio.play().catch(() => {});
        t0 = c.currentTime + (offset - audio.currentTime);
        beatPos = audio.currentTime;
      } else {
        t0 = c.currentTime + 0.1;
        d.metro.setBpm(bpm);
        d.metro.beats = 4;
        d.metro.start(t0);
      }
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const rec = new MediaRecorder(m.dest.stream, { mimeType: mime, audioBitsPerSecond: 128000 });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.start(250);
      const started = performance.now();
      mum = { l, b, bpm, t0, beatPos, onsets, proc, mute, analyser: m.analyser, rec, chunks, c, started };
      setMumbleUi(true);
    }
    function stopMumble() {
      const u = mum;
      if (!u) return;
      mum = null;
      setMumbleUi(false);
      u.proc.onaudioprocess = null;
      try { u.analyser.disconnect(u.proc); u.proc.disconnect(); u.mute.disconnect(); } catch {}
      if (u.b) d.audio.pause();
      d.metro.stop();
      d.metro.beats = d.S().metroBeats || 4;
      u.rec.onstop = async () => {
        d.closeMic();
        d.metroSync();
        const comp = d.S().fsLatency != null ? d.S().fsLatency / 1000 : u.c.outputLatency || u.c.baseLatency || 0;
        const rows = flowRows(u.onsets.map((t) => t - comp), u.t0, 240 / u.bpm);
        if (rows.reduce((s, r) => s + r.count, 0) < 3) return toast("Didn't hear much. Check your mic level and try again.", 'mic');
        const take = await d.addTake(u.l, new Blob(u.chunks, { type: 'audio/webm' }), { label: 'Mumble', duration: (performance.now() - u.started) / 1000, beatId: u.b?.id || null, beatOffset: u.beatPos });
        u.l.flow = { rows, takeId: take.id };
        d.persist();
        renderFlow();
        toast(`Flow guide ready: ${rows.length} bars. It follows your cursor above the lyric.`, 'mic');
      };
      u.rec.stop();
    }
    $('#flow-strip').addEventListener('click', (e) => {
      const a = e.target.closest('[data-flow]')?.dataset.flow;
      const l = d.current();
      if (!l) return;
      if (a === 'close') { l.flow = null; d.persist(); renderFlow(); }
      if (a === 'play') { const t = l.takes?.find((x) => x.id === l.flow?.takeId); if (t) d.playTake(t); }
    });
    $('#mumble-btn').onclick = toggleMumble;

    // ---------- rhyme sprint, in the freestyle tab ----------
    let sprint = null;
    const page = () => $('#fs-page');
    function startSprint(seed) {
      seed = seed || sprintSeed(d.engine);
      sprint = { running: true, seed, found: [], score: 0, end: performance.now() + 60000 };
      page().innerHTML = `<div class="sk-play"><div class="sk-time"><div id="sk-bar"></div></div>
        <div class="sk-head"><div class="sk-seed">${esc(seed)}</div><div class="sk-score"><b id="sk-score">0</b><span id="sk-left">60</span></div></div>
        <input id="sk-in" class="field sk-in" placeholder="Type a rhyme, press Enter" spellcheck="false" autocomplete="off"/>
        <div id="sk-found" class="chips"></div><div class="pf-hint">Esc to stop</div></div>`;
      $('#sk-in').focus();
      const tick = () => {
        if (!sprint?.running) return;
        const left = sprint.end - performance.now();
        if (left <= 0) return endSprint();
        $('#sk-bar').style.width = left / 600 + '%';
        $('#sk-left').textContent = Math.ceil(left / 1000);
        requestAnimationFrame(tick);
      };
      tick();
    }
    function submitSprint(raw) {
      const inp = $('#sk-in');
      const r = judgeSprint(d.engine, d.spellKnown, sprint.seed, raw);
      inp.value = '';
      if (!r.w) return;
      if (!r.level || sprint.found.some((f) => f.w === r.w)) { inp.classList.remove('nope'); void inp.offsetWidth; inp.classList.add('nope'); return; }
      sprint.found.push(r);
      sprint.score += r.level === 2 ? 10 : 3;
      $('#sk-score').textContent = sprint.score;
      $('#sk-found').insertAdjacentHTML('beforeend', `<span class="chip ${r.level === 2 ? '' : 'near'}">${esc(r.w)}</span>`);
    }
    function endSprint() {
      sprint.running = false;
      const l = lib();
      l.sprint = { best: 0, runs: 0, ...(l.sprint || {}) };
      l.sprint.runs++;
      const nb = sprint.score > l.sprint.best;
      if (nb) l.sprint.best = sprint.score;
      d.persist();
      const got = new Set(sprint.found.map((f) => f.w));
      const missed = sprintAnswers(d.engine, sprint.seed).filter((w) => !got.has(w)).slice(0, 24);
      page().innerHTML = `<div class="sk-res"><div class="fs-big">${sprint.score}<small>${nb ? 'New best' : `${sprint.found.length} words for "${esc(sprint.seed)}"`}</small></div>
        ${missed.length ? `<h4>You missed these. Click one for its meaning.</h4><div class="chips sk-missed">${missed.map((w) => `<button class="chip" data-mean="${esc(w)}">${esc(w)}</button>`).join('')}</div>` : ''}
        <div id="sk-meaning" class="wk-meaning"></div>
        <div class="fs-res-acts"><button class="btn primary" data-sk="go">${icon('play', 14)}New word</button><button class="btn" data-sk="again">${icon('restore', 14)}Same word</button><button class="btn ghost" data-sk="back">Back</button></div></div>`;
    }
    async function showMeaning(w) {
      const el = $('#sk-meaning');
      el.dataset.w = w;
      el.innerHTML = `<b>${esc(w)}</b> <span class="loading-dots"><i></i><i></i><i></i></span>`;
      const defs = await d.getDefs(w);
      if (el.dataset.w !== w) return;
      el.innerHTML = `<b>${esc(w)}</b> ${defs.length ? esc(defs.slice(0, 2).map((x) => x.text).join('; ')) : `<span class="muted">${d.S().online ? 'No definition found.' : 'Definitions need the online dictionary.'}</span>`}`;
    }
    page().addEventListener('click', (e) => {
      const sk = e.target.closest('[data-sk]')?.dataset.sk;
      if (sk === 'go') startSprint();
      if (sk === 'again') startSprint(sprint.seed);
      if (sk === 'back') { sprint = null; d.backToFreestyle(); }
      const mean = e.target.closest('[data-mean]')?.dataset.mean;
      if (mean) showMeaning(mean);
    });
    page().addEventListener('keydown', (e) => {
      if (e.target.id === 'sk-in' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); submitSprint(e.target.value); }
    });

    return {
      saveBar, fit, mineHtml, bindMine, renderFlow, mumbling, stopMumble, startSprint,
      overuse: (word) => overuse(word, songs(), d.engine),
      leaveSprint() { if (sprint) { sprint.running = false; sprint = null; } },
      keys(e) {
        if (sprint?.running && e.key === 'Escape') { sprint.running = false; sprint = null; d.backToFreestyle(); return true; }
        return false;
      },
    };
  }

  window.Craft = { init, barRhythm, flowRows, wordCounts, overuse, barsThatFit, sprintSeed, sprintAnswers, judgeSprint };
})();
