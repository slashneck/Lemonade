'use strict';
(() => {
  const api = window.api;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = () => Date.now();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SECTION_RE = /^\s*\[[^\]]*\]\s*$/;
  const WORD_RE = /[A-Za-z0-9][A-Za-z0-9'’]*/g;
  const engine = new RhymeEngine();
  const logo = (size, cls = '') => LemonLogo.markup({ size, cls });

  const ACCENTS = [
    ['#ffd60a', 'Lemon'], ['mono', 'Mono'], ['#ff5d5d', 'Red'], ['#ff8a3d', 'Orange'],
    ['#4ade80', 'Green'], ['#22d3ee', 'Cyan'], ['#6d7cff', 'Indigo'], ['#e879f9', 'Pink'],
  ];
  const DEFAULT_SETTINGS = {
    theme: 'dark', accent: '#ffd60a', editorFont: 'sans', fontSize: 17, lineHeight: 1.8,
    showBars: true, showSyllables: true, rhymeHighlight: 'end', online: true, animations: true,
    splash: true, spelling: 'suggest', reopenLast: true, sort: 'updated', volume: 80, loop: true,
    metroBpm: 90, metroVol: 50, metroBeats: 4, checkUpdates: true,
    micId: '', micBoost: 0, micLimiter: true, micAgc: false, micNoise: false, micEcho: false, countIn: false,
  };
  const SECTIONS = ['Intro', 'Verse', 'Pre-Hook', 'Hook', 'Chorus', 'Bridge', 'Outro'];

  let lib = null;
  const st = {
    view: 'write', pane: 'rhymes', openId: null, search: '', rhymeTab: 'perfect', pinned: false,
    rh: null, rhWord: null, chip: null, lastSel: [0, 0], analysis: null,
  };

  // ================= Persistence =================
  const WELCOME = `[Verse 1]
Welcome to the pad where the pen stays hot
Every bar you write gets a rhyme on the spot
Click a word on the right and you'll see what it means
Double-click to drop it right into your scenes

[Hook]
Save it, name it, file it in a folder
Load a beat and let it ride while the night gets colder
`;

  function defaultLibrary() {
    const t = now();
    const p = { id: uid(), name: 'My Songs', created: t, updated: t, archived: false };
    const f = { id: uid(), projectId: p.id, name: 'Drafts', created: t, updated: t, archived: false };
    const l = { id: uid(), projectId: p.id, folderId: null, title: 'Welcome to Lemonade', body: WELCOME, beatId: null, created: t, updated: t, archived: false };
    return { version: 1, projects: [p], folders: [f], lyrics: [l], beats: [], settings: { ...DEFAULT_SETTINGS }, ui: { openId: l.id, open: [p.id] } };
  }

  let saveTimer = null, dirty = false;
  function persist() {
    dirty = true;
    setStatus('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 450);
  }
  async function flush() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    dirty = false;
    try { await api.saveLibrary(JSON.stringify(lib)); setStatus('saved'); }
    catch { dirty = true; setStatus('error'); }
  }
  window.addEventListener('beforeunload', () => { if (dirty) api.saveLibrarySync(JSON.stringify(lib)); });

  function setStatus(s) {
    const el = $('#save-status');
    el.className = 'tb-status ' + s;
    el.innerHTML = `<span class="dot"></span>${s === 'saving' ? 'Saving…' : s === 'error' ? 'Save failed' : 'Saved'}`;
  }

  // ================= Helpers =================
  const S = () => lib.settings;
  const project = (id) => lib.projects.find((p) => p.id === id);
  const folder = (id) => lib.folders.find((f) => f.id === id);
  const lyric = (id) => lib.lyrics.find((l) => l.id === id);
  const beat = (id) => lib.beats.find((b) => b.id === id);
  const current = () => lyric(st.openId);
  const lyricVisible = (l) => !l.archived && project(l.projectId) && !project(l.projectId).archived && !(l.folderId && folder(l.folderId)?.archived);

  function rel(ts) {
    const d = (now() - ts) / 1000;
    if (d < 45) return 'just now';
    if (d < 3600) return Math.round(d / 60) + 'm ago';
    if (d < 86400) return Math.round(d / 3600) + 'h ago';
    if (d < 86400 * 7) return Math.round(d / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }
  const fmtTime = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

  function sortBy(items, mode, nameKey = 'name') {
    const a = [...items];
    if (mode === 'name') a.sort((x, y) => (x[nameKey] || '').localeCompare(y[nameKey] || '', undefined, { numeric: true }));
    else if (mode === 'created') a.sort((x, y) => y.created - x.created);
    else a.sort((x, y) => y.updated - x.updated);
    return a;
  }

  function fillIcons(root = document) {
    $$('[data-icon]', root).forEach((el) => { el.innerHTML = icon(el.dataset.icon, +el.dataset.size || 16); });
  }

  // Puts new html into a list. Only items it hasn't shown before play their entrance animation, so clicking around
  // doesn't make the whole list flash in again. Items carry a stable data-key.
  function renderKeyed(el, html) {
    const seen = el._keys || new Set();
    el.innerHTML = html;
    const keys = new Set();
    let n = 0;
    for (const item of el.querySelectorAll('[data-key]')) {
      const k = item.dataset.key;
      keys.add(k);
      if (seen.has(k)) item.classList.add('still');
      else item.style.setProperty('--n', Math.min(n++, 30));
    }
    el._keys = keys;
  }

  // Big visual changes (theme, accent, focus mode) crossfade instead of snapping.
  function crossfade(fn) {
    if (document.startViewTransition && lib && S().animations) document.startViewTransition(fn);
    else fn();
  }
  // The highlight of a segmented control slides to the chosen option.
  function inkSegs(root = document) {
    for (const seg of $$('.seg', root)) {
      let ink = seg.querySelector('.seg-ink');
      if (!ink) { ink = document.createElement('i'); ink.className = 'seg-ink'; seg.prepend(ink); }
      const a = seg.querySelector('button.active');
      if (!a || !a.offsetWidth) { ink.style.opacity = 0; continue; }
      ink.style.opacity = 1;
      ink.style.width = a.offsetWidth + 'px';
      ink.style.transform = `translateX(${a.offsetLeft}px)`;
      if (!seg.classList.contains('inked')) requestAnimationFrame(() => seg.classList.add('inked'));
    }
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('.seg button'); if (b) requestAnimationFrame(() => inkSegs(b.parentElement.parentElement)); });

  function dismissToast(t) {
    if (t.classList.contains('out')) return;
    clearTimeout(t._t);
    t.classList.add('out');
    setTimeout(() => t.remove(), 280);
  }
  function toast(msg, ic = 'check') {
    const box = $('#toasts');
    const live = [...box.children].filter((t) => !t.classList.contains('out'));
    const same = live.find((t) => t.dataset.msg === msg);
    if (same) { // the same message again just stays a little longer
      clearTimeout(same._t);
      same.classList.remove('bump'); void same.offsetWidth; same.classList.add('bump');
      same._t = setTimeout(() => dismissToast(same), 2400);
      return;
    }
    if (live.length >= 3) dismissToast(live[0]);
    const t = document.createElement('div');
    t.className = 'toast';
    t.dataset.msg = msg;
    t.innerHTML = icon(ic, 16) + `<span>${esc(msg)}</span>`;
    t.onclick = () => dismissToast(t);
    box.appendChild(t);
    t._t = setTimeout(() => dismissToast(t), 2400);
  }

  // ================= Modals & menus =================
  function modal(html, onMount) {
    return new Promise((resolve) => {
      const root = $('#modal');
      const token = (root._token = {});
      root.classList.remove('closing');
      root.innerHTML = `<div class="modal">${html}</div>`;
      root.classList.add('open');
      fillIcons(root);
      const close = (v) => {
        document.removeEventListener('keydown', key, true);
        root.classList.add('closing');
        setTimeout(() => { if (root._token === token) { root.classList.remove('open', 'closing'); root.innerHTML = ''; } }, 150);
        resolve(v);
      };
      const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
      document.addEventListener('keydown', key, true);
      root.onmousedown = (e) => { if (e.target === root) close(null); };
      onMount(root.firstElementChild, close);
    });
  }
  function promptModal(title, value = '', placeholder = '') {
    return modal(`<h3>${esc(title)}</h3><input class="field" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false"/>
      <div class="m-acts"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></div>`, (m, close) => {
      const inp = $('input', m);
      inp.focus(); inp.select();
      const ok = () => close(inp.value.trim() || null);
      inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
      $('[data-ok]', m).onclick = ok;
      $('[data-x]', m).onclick = () => close(null);
    });
  }
  function confirmModal(title, text, okLabel = 'Delete', danger = true) {
    return modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="m-acts"><button class="btn ghost" data-x>Cancel</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`, (m, close) => {
      $('[data-ok]', m).onclick = () => close(true);
      $('[data-x]', m).onclick = () => close(false);
      $('[data-ok]', m).focus();
    });
  }
  function pickModal(title, options, selected) {
    return modal(`<h3>${esc(title)}</h3><div class="pick-list">${options.map((o, i) =>
      `<button data-i="${i}" class="${o.value === selected ? 'sel' : ''}">${icon(o.icon || 'folder', 15)}<span>${esc(o.label)}</span></button>`).join('')}</div>
      <div class="m-acts">${options.extra || ''}<button class="btn ghost" data-x>Cancel</button></div>`, (m, close) => {
      $$('[data-i]', m).forEach((b) => (b.onclick = () => close(options[+b.dataset.i])));
      $('[data-x]', m).onclick = () => close(null);
      $$('[data-extra]', m).forEach((b) => (b.onclick = () => close({ extra: b.dataset.extra })));
    });
  }

  const ctx = $('#ctx');
  function showCtx(x, y, items) {
    ctx.innerHTML = items.map((it, i) => (it === '-' ? '<hr/>' : it.head ? `<div class="ctx-head">${esc(it.head)}</div>` :
      `<button data-i="${i}" class="${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''} ${it.strong ? 'strong' : ''}">${icon(it.icon || 'chevron', 15)}<span>${esc(it.label)}</span>${it.kbd ? `<span class="kbd">${it.kbd}</span>` : ''}</button>`)).join('');
    ctx.classList.add('open');
    const r = ctx.getBoundingClientRect();
    ctx.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    ctx.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
    $$('[data-i]', ctx).forEach((b) => (b.onclick = () => { hideCtx(); items[+b.dataset.i].run(); }));
  }
  const hideCtx = () => ctx.classList.remove('open');
  document.addEventListener('mousedown', (e) => {
    if (!ctx.contains(e.target)) hideCtx();
    if (!e.target.closest('.dropdown')) $$('.menu.open').forEach((m) => m.classList.remove('open'));
  });
  window.addEventListener('blur', hideCtx);

  // ================= Settings / theme =================
  function hexLum(hex) {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const mql = matchMedia('(prefers-color-scheme: dark)');
  function applySettings() {
    const s = S();
    const theme = s.theme === 'system' ? (mql.matches ? 'dark' : 'light') : s.theme;
    document.documentElement.dataset.theme = theme;
    const root = document.documentElement.style;
    if (s.accent === 'mono') {
      root.setProperty('--accent', 'var(--fg)');
      root.setProperty('--accent-fg', 'var(--bg)');
    } else {
      root.setProperty('--accent', s.accent);
      root.setProperty('--accent-fg', hexLum(s.accent) > 0.4 ? '#0a0a0a' : '#ffffff');
    }
    root.setProperty('--ed-font', { sans: 'var(--ui)', serif: 'Georgia, "Times New Roman", serif', mono: 'var(--mono)' }[s.editorFont]);
    root.setProperty('--ed-size', s.fontSize + 'px');
    root.setProperty('--ed-lh', s.lineHeight);
    document.body.classList.toggle('no-motion', !s.animations);
    $('#pad').spellcheck = false;
    if (s.spelling === 'off') hideSpellPop();
    const cs = getComputedStyle(document.documentElement);
    api.setTitlebar({ color: cs.getPropertyValue('--bg').trim(), symbolColor: cs.getPropertyValue('--fg').trim() });
    renderBackdrop();
  }
  mql.addEventListener('change', () => S().theme === 'system' && applySettings());
  function setSetting(k, v) {
    S()[k] = v;
    applySettings();
    persist();
  }

  // ================= Views =================
  function setView(v) {
    if (st.view === 'settings' && v !== 'settings' && mic.monitoring && !rec.on) closeMic();
    st.view = v;
    $$('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $$('.view').forEach((s) => s.classList.toggle('active', s.dataset.view === v));
    placeIndicator();
    if (v === 'beats') renderBeats();
    if (v === 'dictionary') renderDictionary();
    if (v === 'archive') renderArchive();
    if (v === 'settings') renderSettings();
    if (v === 'write') { renderTree(); requestAnimationFrame(syncBackdropSize); }
    renderCrumbs();
  }

  function placeIndicator() {
    const btn = $(`.rail-btn[data-view="${st.view}"]`);
    $('#rail-indicator').style.top = '0px';
    $('#rail-indicator').style.transform = `translateY(${btn.offsetTop}px)`;
  }

  function renderCrumbs() {
    const el = $('#crumbs');
    if (st.view !== 'write') {
      el.innerHTML = `<span class="cur">${{ beats: 'Beats', dictionary: 'Word library', archive: 'Archive', settings: 'Settings' }[st.view]}</span>`;
      return;
    }
    const l = current();
    if (!l) { el.innerHTML = ''; return; }
    const parts = [project(l.projectId)?.name, l.folderId && folder(l.folderId)?.name].filter(Boolean);
    el.innerHTML = parts.map((p) => `<span>${esc(p)}</span><span class="sep">/</span>`).join('') + `<span class="cur">${esc(l.title || 'Untitled')}</span>`;
  }

  // ================= Tree =================
  const openSet = () => new Set(lib.ui.open || []);
  function toggleOpen(id, force) {
    const s = openSet();
    const on = force ?? !s.has(id);
    on ? s.add(id) : s.delete(id);
    lib.ui.open = [...s];
    persist();
  }

  function renderTree() {
    const tree = $('#tree');
    const q = st.search.trim().toLowerCase();
    const row = (type, item, depth, extra = '') => {
      const isOpen = openSet().has(item.id);
      const name = type === 'lyric' ? item.title || 'Untitled' : item.name;
      const ic = type === 'project' ? 'project' : type === 'folder' ? 'folder' : 'file';
      const count = type === 'lyric' ? '' : lib.lyrics.filter((l) => lyricVisible(l) && (type === 'project' ? l.projectId === item.id : l.folderId === item.id)).length;
      const active = item.id === st.openId;
      const opening = item.id === st.treeOpening;
      return `<div class="t-row ${type} ${isOpen ? 'open' : ''} ${active ? 'active' : ''} ${active && tree._active !== item.id ? 'just' : ''} ${opening ? 'opening' : ''}" data-type="${type}" data-id="${item.id}"
        data-key="${type}:${item.id}" draggable="${type !== 'project'}" style="--d:${depth}">
        ${type === 'lyric' ? '<span style="width:14px"></span>' : `<span class="chev">${icon('chevron', 14)}</span>`}
        <span class="t-ic">${icon(ic, 15)}</span><span class="t-name">${esc(name)}</span>${extra}
        ${type !== 'lyric' ? `<span class="t-count">${count || ''}</span>` : ''}
        <span class="t-acts">${type !== 'lyric' ? `<button class="icon-btn" data-act="add" title="New lyric here">${icon('plus', 14)}</button>` : ''}
        <button class="icon-btn" data-act="save" title="${type === 'lyric' ? 'Save as a text file' : 'Save every lyric as a text file'}">${icon('download', 14)}</button>
        <button class="icon-btn" data-act="menu" title="More">${icon('more', 14)}</button></span></div>`;
    };

    if (q) {
      const hits = lib.lyrics.filter((l) => lyricVisible(l) && ((l.title || '').toLowerCase().includes(q) || l.body.toLowerCase().includes(q)));
      let html = `<div class="t-section">${hits.length} result${hits.length === 1 ? '' : 's'}</div>`;
      for (const l of sortBy(hits, S().sort, 'title')) {
        html += row('lyric', l, 0);
        const line = l.body.split('\n').find((x) => x.toLowerCase().includes(q));
        if (line) {
          const i = line.toLowerCase().indexOf(q);
          html += `<div class="t-snippet">${esc(line.slice(Math.max(0, i - 20), i))}<mark>${esc(line.substr(i, q.length))}</mark>${esc(line.slice(i + q.length, i + 60))}</div>`;
        }
      }
      renderKeyed(tree, html);
      tree._active = st.openId;
      return;
    }

    const open = openSet();
    let html = '';
    const projects = S().sort === 'name' ? sortBy(lib.projects, 'name') : [...lib.projects].sort((a, b) => a.created - b.created);
    for (const p of projects.filter((x) => !x.archived)) {
      html += row('project', p, 0);
      if (!open.has(p.id)) continue;
      html += `<div class="t-kids" data-kids="${p.id}">`;
      const folders = sortBy(lib.folders.filter((f) => f.projectId === p.id && !f.archived), 'name');
      for (const f of folders) {
        html += row('folder', f, 1);
        if (!open.has(f.id)) continue;
        const ls = sortBy(lib.lyrics.filter((l) => l.folderId === f.id && !l.archived), S().sort, 'title');
        html += `<div class="t-kids" data-kids="${f.id}">` + (ls.map((l) => row('lyric', l, 2)).join('') || '<div class="t-empty" style="--d:1">Empty folder</div>') + '</div>';
      }
      const loose = sortBy(lib.lyrics.filter((l) => l.projectId === p.id && !l.folderId && !l.archived), S().sort, 'title');
      html += loose.map((l) => row('lyric', l, 1)).join('');
      if (!folders.length && !loose.length) html += '<div class="t-empty">No lyrics yet</div>';
      html += '</div>';
    }
    if (!html) html = '<div class="t-empty" style="padding:20px 8px">No projects. Create one with the folder button above.</div>';
    renderKeyed(tree, html);
    tree._active = st.openId;
  }

  // Folders and projects slide open and shut instead of the whole tree being redrawn at once.
  function toggleTreeNode(t) {
    const opening = !openSet().has(t.id);
    const smooth = S().animations;
    const kids = $(`.t-kids[data-kids="${t.id}"]`);
    if (!opening) {
      t.row.classList.remove('open');
      if (!kids || !smooth) { toggleOpen(t.id, false); renderTree(); return; }
      kids.style.overflow = 'hidden';
      kids.animate([{ height: kids.offsetHeight + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 190, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' })
        .onfinish = () => { toggleOpen(t.id, false); renderTree(); };
      return;
    }
    toggleOpen(t.id, true);
    st.treeOpening = t.id;
    renderTree();
    st.treeOpening = null;
    const added = $(`.t-kids[data-kids="${t.id}"]`);
    if (!added || !smooth) return;
    const h = added.offsetHeight;
    added.style.overflow = 'hidden';
    added.animate([{ height: '0px', opacity: 0.2 }, { height: h + 'px', opacity: 1 }], { duration: 230, easing: 'cubic-bezier(.2,.8,.2,1)' })
      .onfinish = () => { added.style.overflow = ''; };
  }

  function treeItem(el) {
    const r = el?.closest?.('.t-row');
    if (!r) return null;
    const { type, id } = r.dataset;
    return { row: r, type, id, item: type === 'project' ? project(id) : type === 'folder' ? folder(id) : lyric(id) };
  }

  function bindTree() {
    const tree = $('#tree');
    tree.addEventListener('click', (e) => {
      const t = treeItem(e.target);
      if (!t) return;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'add') {
        e.stopPropagation();
        return t.type === 'project' ? newLyric(t.id, null) : newLyric(t.item.projectId, t.id);
      }
      if (act === 'save') {
        e.stopPropagation();
        return t.type === 'lyric' ? exportLyric(t.item) : exportGroup(t.type, t.item);
      }
      if (act === 'menu') {
        e.stopPropagation();
        const r = e.target.closest('[data-act]').getBoundingClientRect();
        return itemMenu(t, r.left, r.bottom + 4);
      }
      if (t.type === 'lyric') openLyric(t.id);
      else toggleTreeNode(t);
    });
    tree.addEventListener('dblclick', (e) => {
      const t = treeItem(e.target);
      if (t && e.target.closest('.t-name')) inlineRename(t);
    });
    tree.addEventListener('contextmenu', (e) => {
      const t = treeItem(e.target);
      if (!t) return;
      e.preventDefault();
      itemMenu(t, e.clientX, e.clientY);
    });
    // drag & drop
    let drag = null;
    tree.addEventListener('dragstart', (e) => {
      const t = treeItem(e.target);
      if (!t || t.type === 'project') return;
      drag = t;
      t.row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
    });
    tree.addEventListener('dragend', () => { drag = null; $$('.dragging, .drop-target', tree).forEach((x) => x.classList.remove('dragging', 'drop-target')); });
    tree.addEventListener('dragover', (e) => {
      if (!drag) return;
      const t = treeItem(e.target);
      $$('.drop-target', tree).forEach((x) => x.classList.remove('drop-target'));
      if (!t || t.type === 'lyric' || (drag.type === 'folder' && t.type !== 'project')) return;
      e.preventDefault();
      t.row.classList.add('drop-target');
    });
    tree.addEventListener('drop', (e) => {
      const t = treeItem(e.target);
      if (!drag || !t) return;
      e.preventDefault();
      if (drag.type === 'lyric') {
        const l = drag.item;
        if (t.type === 'project') { l.projectId = t.id; l.folderId = null; }
        else { l.projectId = t.item.projectId; l.folderId = t.id; }
        toggleOpen(t.id, true);
        if (t.type === 'folder') toggleOpen(t.item.projectId, true);
      } else if (drag.type === 'folder' && t.type === 'project') {
        drag.item.projectId = t.id;
        lib.lyrics.filter((l) => l.folderId === drag.id).forEach((l) => (l.projectId = t.id));
        toggleOpen(t.id, true);
      }
      persist(); renderTree(); renderCrumbs();
    });
  }

  function inlineRename(t) {
    const nameEl = $('.t-name', t.row);
    const key = t.type === 'lyric' ? 'title' : 'name';
    const inp = document.createElement('input');
    inp.className = 'rename';
    inp.value = t.item[key] || '';
    nameEl.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const finish = (save) => {
      if (done) return; done = true;
      if (save && inp.value.trim()) { t.item[key] = inp.value.trim(); t.item.updated = now(); persist(); }
      renderTree(); renderCrumbs();
      if (t.type === 'lyric' && t.id === st.openId) $('#lyric-title').value = t.item.title;
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); };
    inp.onblur = () => finish(true);
    inp.onclick = (e) => e.stopPropagation();
  }

  function itemMenu(t, x, y) {
    const items = [];
    if (t.type === 'project') {
      items.push({ label: 'New lyric', icon: 'plus', run: () => newLyric(t.id, null) });
      items.push({ label: 'New folder', icon: 'folderPlus', run: () => newFolder(t.id) });
      items.push({ label: 'Import text files…', icon: 'upload', run: () => importTextDialog(t.id, null) });
      items.push({ label: 'Save as text files…', icon: 'download', run: () => exportGroup('project', t.item) });
    }
    if (t.type === 'folder') {
      items.push({ label: 'New lyric', icon: 'plus', run: () => newLyric(t.item.projectId, t.id) });
      items.push({ label: 'Import text files…', icon: 'upload', run: () => importTextDialog(t.item.projectId, t.id) });
      items.push({ label: 'Save as text files…', icon: 'download', run: () => exportGroup('folder', t.item) });
    }
    if (t.type === 'lyric') {
      items.push({ label: 'Open', icon: 'file', run: () => openLyric(t.id) });
      items.push({ label: 'Duplicate', icon: 'copy', run: () => duplicateLyric(t.item) });
      items.push({ label: 'Move to…', icon: 'move', run: () => moveLyric(t.item) });
      items.push({ label: 'Export .txt', icon: 'download', run: () => exportLyric(t.item) });
      items.push({ label: 'Export PDF', icon: 'book', run: () => exportPdf(t.item) });
    }
    items.push({ label: 'Rename', icon: 'edit', run: () => inlineRename(treeItem($(`.t-row[data-id="${t.id}"]`)) || t) });
    items.push('-');
    items.push({ label: 'Archive', icon: 'archive', run: () => archiveItem(t.type, t.item) });
    items.push({ label: 'Delete', icon: 'trash', danger: true, run: () => deleteItem(t.type, t.item) });
    showCtx(x, y, items);
  }

  // ================= CRUD =================
  async function newProject() {
    const name = await promptModal('New project', '', 'Album, EP, mixtape…');
    if (!name) return;
    const p = { id: uid(), name, created: now(), updated: now(), archived: false };
    lib.projects.push(p);
    toggleOpen(p.id, true);
    persist(); renderTree();
    toast(`Project “${name}” created`, 'project');
  }
  async function newFolder(projectId) {
    const name = await promptModal('New folder', '', 'Verses, Hooks, Ideas…');
    if (!name) return;
    const f = { id: uid(), projectId, name, created: now(), updated: now(), archived: false };
    lib.folders.push(f);
    toggleOpen(projectId, true); toggleOpen(f.id, true);
    persist(); renderTree();
  }
  function newLyric(projectId, folderId) {
    const cur = current();
    if (!projectId) {
      projectId = cur?.projectId || lib.projects.find((p) => !p.archived)?.id;
      folderId = cur ? cur.folderId : null;
    }
    if (!projectId) {
      const p = { id: uid(), name: 'My Songs', created: now(), updated: now(), archived: false };
      lib.projects.push(p); projectId = p.id;
    }
    const l = { id: uid(), projectId, folderId: folderId || null, title: '', body: '', beatId: null, created: now(), updated: now(), archived: false };
    lib.lyrics.push(l);
    toggleOpen(projectId, true);
    if (folderId) toggleOpen(folderId, true);
    persist();
    if (st.view !== 'write') setView('write');
    openLyric(l.id);
    $('#lyric-title').focus();
  }
  function duplicateLyric(l) {
    const c = { ...l, id: uid(), title: (l.title || 'Untitled') + ' (copy)', created: now(), updated: now() };
    lib.lyrics.push(c);
    persist(); openLyric(c.id);
  }
  async function moveLyric(l) {
    const opts = [];
    for (const p of lib.projects.filter((x) => !x.archived)) {
      opts.push({ label: p.name, icon: 'project', value: p.id + ':', p: p.id, f: null });
      for (const f of lib.folders.filter((x) => x.projectId === p.id && !x.archived)) opts.push({ label: `${p.name} / ${f.name}`, icon: 'folder', value: p.id + ':' + f.id, p: p.id, f: f.id });
    }
    const pick = await pickModal(`Move “${l.title || 'Untitled'}”`, opts, l.projectId + ':' + (l.folderId || ''));
    if (!pick || pick.extra) return;
    l.projectId = pick.p; l.folderId = pick.f;
    toggleOpen(pick.p, true); if (pick.f) toggleOpen(pick.f, true);
    persist(); renderTree(); renderCrumbs();
    toast('Moved to ' + pick.label, 'move');
  }
  function archiveItem(type, item) {
    item.archived = true; item.archivedAt = now();
    const cur = current();
    if (cur && !lyricVisible(cur)) closeEditor();
    persist(); renderTree();
    toast(`${type[0].toUpperCase() + type.slice(1)} archived`, 'archive');
  }
  async function deleteItem(type, item) {
    const name = item.title || item.name || 'Untitled';
    if (type === 'project') {
      const n = lib.lyrics.filter((l) => l.projectId === item.id).length;
      if (!(await confirmModal(`Delete “${name}”?`, `This permanently deletes the project, its folders and ${n} lyric${n === 1 ? '' : 's'}.`))) return;
      lib.lyrics.filter((l) => l.projectId === item.id).forEach(dropTakes);
      lib.lyrics = lib.lyrics.filter((l) => l.projectId !== item.id);
      lib.folders = lib.folders.filter((f) => f.projectId !== item.id);
      lib.projects = lib.projects.filter((p) => p.id !== item.id);
    } else if (type === 'folder') {
      if (!(await confirmModal(`Delete folder “${name}”?`, 'Lyrics inside will move to the project root.'))) return;
      lib.lyrics.forEach((l) => { if (l.folderId === item.id) l.folderId = null; });
      lib.folders = lib.folders.filter((f) => f.id !== item.id);
    } else {
      if (!(await confirmModal(`Delete “${name}”?`, 'This lyric and its takes will be gone for good. Archive it instead if you might want it back.'))) return;
      dropTakes(item);
      lib.lyrics = lib.lyrics.filter((l) => l.id !== item.id);
    }
    if (st.openId && !lyric(st.openId)) closeEditor();
    persist(); renderTree();
    if (st.view === 'archive') renderArchive();
    toast('Deleted', 'trash');
  }
  const dropTakes = (l) => (l.takes || []).forEach((t) => api.deleteTake(t.file));
  async function exportLyric(l = current()) {
    if (!l) return;
    const text = (l.title ? l.title + '\n\n' : '') + l.body;
    if (await api.exportText(l.title || 'lyric', text)) toast('Exported', 'download');
  }

  // ================= Editor =================
  const pad = $('#pad');
  const titleInput = $('#lyric-title');

  function openLyric(id) {
    const l = lyric(id);
    if (!l) return;
    if (st.openId && st.openId !== id) { snapshot(current()); stopTake(); }
    st.openId = id;
    lib.ui.openId = id;
    $('#editor-empty').hidden = true;
    const pane = $('#editor-pane');
    pane.hidden = false;
    pane.style.animation = 'none'; pane.offsetHeight; pane.style.animation = '';
    titleInput.value = l.title || '';
    pad.value = l.body;
    pad.scrollTop = 0;
    pad.setSelectionRange(pad.value.length, pad.value.length);
    st.lastSel = [pad.value.length, pad.value.length];
    syncBackdropSize();
    renderBackdrop();
    renderMeta();
    renderAttach();
    renderTree();
    renderCrumbs();
    if (!st.pinned) updateRhymeTarget(true);
    if (l.beatId && beat(l.beatId) && (!player.beat || !player.playing)) loadBeat(beat(l.beatId), false);
    snapshot(l, 'Opened');
    renderPane();
    persist();
  }
  function closeEditor() {
    if (current()) snapshot(current());
    stopTake();
    st.openId = null;
    lib.ui.openId = null;
    $('#editor-pane').hidden = true;
    $('#editor-empty').hidden = false;
    renderCrumbs();
    renderPane();
  }

  titleInput.addEventListener('input', () => {
    const l = current(); if (!l) return;
    l.title = titleInput.value; l.updated = now();
    persist(); renderCrumbs();
    clearTimeout(titleInput._t); titleInput._t = setTimeout(renderTree, 300);
  });
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); pad.focus(); } });

  let rhymeTimer = null;
  pad.addEventListener('input', () => {
    const l = current(); if (!l) return;
    l.body = pad.value; l.updated = now();
    autoSnapshot(l);
    persist();
    scheduleBackdrop();
    renderMeta();
    clearTimeout(rhymeTimer);
    rhymeTimer = setTimeout(() => updateRhymeTarget(), 380);
  });
  const caretMoved = () => {
    st.lastSel = [pad.selectionStart, pad.selectionEnd];
    markCurrentLine();
    if (spell.skip && (pad.selectionStart < spell.skip[0] || pad.selectionStart > spell.skip[1])) scheduleBackdrop();
    clearTimeout(rhymeTimer);
    rhymeTimer = setTimeout(() => updateRhymeTarget(), 140);
  };
  pad.addEventListener('keyup', (e) => { if (/Arrow|Home|End|Page/.test(e.key)) caretMoved(); });
  pad.addEventListener('mouseup', caretMoved);
  pad.addEventListener('blur', () => { st.lastSel = [pad.selectionStart, pad.selectionEnd]; if (spell.skip) scheduleBackdrop(); });
  pad.addEventListener('scroll', () => { $('#backdrop-inner').style.transform = `translateY(${-pad.scrollTop}px)`; });
  pad.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); }
  });

  function syncBackdropSize() {
    $('#backdrop-inner').style.width = pad.clientWidth + 'px';
  }
  new ResizeObserver(() => { syncBackdropSize(); }).observe(pad);

  const lineIndexAt = (pos) => pad.value.slice(0, pos).split('\n').length - 1;
  const lastWordOf = (line) => { const m = line.match(WORD_RE); return m ? m[m.length - 1] : null; };

  function analyze(text) {
    const lines = text.split('\n');
    const res = lines.map((line) => ({ line, sec: SECTION_RE.test(line), words: [...line.matchAll(WORD_RE)] }));
    let bar = 0;
    const endCount = new Map();
    for (const r of res) {
      if (r.sec) { bar = 0; continue; }
      if (!r.words.length) continue;
      r.bar = ++bar;
      r.syl = r.words.reduce((a, m) => a + (engine.ready ? engine.syllables(m[0]) : RhymeEngine.heuristicSyllables(m[0])), 0);
      r.end = r.words[r.words.length - 1];
      r.endKey = engine.ready ? engine.endKey(r.end[0]) : null;
      if (r.endKey) endCount.set(r.endKey, (endCount.get(r.endKey) || 0) + 1);
    }
    // colors: rhyme sounds used by 2+ line endings
    const color = new Map();
    for (const r of res) if (r.endKey && endCount.get(r.endKey) > 1 && !color.has(r.endKey)) color.set(r.endKey, color.size % 10);
    // scheme letters, restarting per section
    let letters = new Map();
    for (const r of res) {
      if (r.sec) { letters = new Map(); continue; }
      if (!r.endKey) continue;
      if (!letters.has(r.endKey)) letters.set(r.endKey, String.fromCharCode(65 + (letters.size % 26)));
      r.letter = letters.get(r.endKey);
      r.color = color.get(r.endKey);
    }
    // internal rhymes ("all" mode)
    let wordColor = null;
    if (S().rhymeHighlight === 'all' && engine.ready) {
      const counts = new Map();
      for (const r of res) if (!r.sec) for (const m of r.words) {
        if (m[0].length < 2 || engine.isStop(m[0])) continue;
        const k = engine.endKey(m[0]);
        if (k) counts.set(k, (counts.get(k) || 0) + 1);
      }
      wordColor = new Map();
      [...color.keys()].forEach((k) => counts.get(k) > 1 && wordColor.set(k, color.get(k)));
      [...counts.entries()].filter(([k, c]) => c > 2 && !wordColor.has(k)).sort((a, b) => b[1] - a[1]).slice(0, 10 - wordColor.size)
        .forEach(([k]) => wordColor.set(k, wordColor.size % 10));
    }
    return { res, wordColor };
  }

  let bdFrame = null;
  const scheduleBackdrop = () => { cancelAnimationFrame(bdFrame); bdFrame = requestAnimationFrame(renderBackdrop); };

  function renderBackdrop() {
    if (!lib || !current()) return;
    const { res, wordColor } = (st.analysis = analyze(pad.value));
    const s = S();
    const caret = pad.selectionStart;
    const curLine = lineIndexAt(caret);
    const typing = document.activeElement === pad;
    const flash = spell.flash && spell.flash.until > now() ? spell.flash : null;
    const checking = spellReady();
    spell.skip = null;
    let abs = 0;
    const html = res.map((r, i) => {
      const lineStart = abs;
      abs += r.line.length + 1;
      let body = '', last = 0;
      if (!r.sec) for (const m of r.words) {
        let c = null;
        if (s.rhymeHighlight !== 'off') {
          if (wordColor) { const k = engine.isStop(m[0]) ? null : engine.endKey(m[0]); if (k && wordColor.has(k)) c = wordColor.get(k); }
          else if (r.end && m.index === r.end.index && r.color !== undefined) c = r.color;
        }
        const a = lineStart + m.index, b = a + m[0].length;
        let bad = false;
        if (checking) {
          // the word being typed isn't judged until you leave it
          if (typing && caret >= a && caret <= b) spell.skip = [a, b];
          else bad = isMisspelled(m[0], m.index === r.words[0].index);
        }
        const fx = flash && flash.start === a;
        if (c == null && !bad && !fx) continue;
        const cls = [c != null ? 'rc' + c : '', bad ? 'sp' : '', fx ? 'fixed' : ''].filter(Boolean).join(' ');
        body += esc(r.line.slice(last, m.index)) + `<mark class="${cls}"${bad ? ` data-li="${i}" data-at="${m.index}"` : ''}>${esc(m[0])}</mark>`;
        last = b - lineStart;
      }
      body += esc(r.line.slice(last));
      const num = s.showBars && r.bar ? r.bar : '';
      const right = r.bar ? `<span class="g-right">${s.showSyllables ? `<span class="g-syl">${r.syl}</span>` : ''}${r.letter ? `<span class="g-letter ${r.color !== undefined ? 'rc' + r.color : ''}">${r.letter}</span>` : ''}</span>` : '';
      return `<div class="bl${i === curLine ? ' cur' : ''}${r.sec ? ' sec' : ''}"><span class="g-num">${num}</span>${body || '​'}${right}</div>`;
    }).join('');
    $('#backdrop-inner').innerHTML = html;
  }

  function markCurrentLine() {
    const i = lineIndexAt(pad.selectionStart);
    const lines = $('#backdrop-inner').children;
    for (const el of $$('.bl.cur', $('#backdrop-inner'))) el.classList.remove('cur');
    lines[i]?.classList.add('cur');
  }

  function renderMeta() {
    const l = current(); if (!l) return;
    const text = pad.value;
    const lines = text.split('\n');
    const bars = lines.filter((x) => x.trim() && !SECTION_RE.test(x)).length;
    const words = (text.match(WORD_RE) || []).length;
    const b = l.beatId && beat(l.beatId);
    const bpm = b?.bpm;
    const dur = bpm ? fmtTime((bars * 4 * 60) / bpm) : null;
    $('#ed-meta').innerHTML = `<span><b>${bars}</b> bars</span><span><b>${words}</b> words</span>` +
      (dur ? `<span class="acc">≈ ${dur} at ${bpm} BPM</span>` : '') + `<span>edited ${rel(l.updated)}</span>`;
  }
  setInterval(() => st.view === 'write' && renderMeta(), 30000);

  function insertAtCursor(text, asWord = true) {
    pad.focus();
    const [a, b] = st.lastSel;
    pad.setSelectionRange(a, b);
    const before = pad.value.slice(0, a);
    const needSpace = asWord && before && !/[\s(\["']$/.test(before);
    document.execCommand('insertText', false, (needSpace ? ' ' : '') + text);
    st.lastSel = [pad.selectionStart, pad.selectionEnd];
  }

  function renderSectionMenu() {
    $('#section-menu').innerHTML = SECTIONS.map((s) => `<button data-s="${s}">${icon('tag', 14)}${s}</button>`).join('');
  }
  function insertSection(name) {
    if (!current()) return;
    if (name === 'Verse') {
      const n = (pad.value.match(/^\s*\[Verse[^\]]*\]/gim) || []).length;
      name = `Verse ${n + 1}`;
    }
    const [a] = st.lastSel;
    const before = pad.value.slice(0, a);
    const lineStart = before.lastIndexOf('\n') + 1;
    const lineHasText = before.slice(lineStart).trim().length > 0;
    const prefix = !before.trim() ? '' : lineHasText ? '\n\n' : before.endsWith('\n\n') || before.length === 0 ? '' : '\n';
    insertAtCursor(`${prefix}[${name}]\n`, false);
  }

  function renderAttach() {
    const l = current();
    const b = l?.beatId && beat(l.beatId);
    $('#attach-label').textContent = b ? b.name : 'Beat';
    $('#attach-beat').classList.toggle('on', !!b);
  }
  async function attachBeat() {
    const l = current(); if (!l) return;
    const opts = [{ label: 'No beat', icon: 'x', value: null }, ...lib.beats.map((b) => ({ label: b.name, icon: b.kind === 'file' ? 'music' : 'link', value: b.id }))];
    opts.extra = '<button class="btn" data-extra="import">' + icon('upload', 14) + 'Import audio…</button>';
    const pick = await pickModal('Attach a beat', opts, l.beatId);
    if (!pick) return;
    if (pick.extra === 'import') {
      const added = await importBeats();
      if (added[0]) { l.beatId = added[0].id; loadBeat(added[0], false); }
    } else {
      l.beatId = pick.value;
      if (pick.value) loadBeat(beat(pick.value), false);
    }
    persist(); renderAttach(); renderMeta();
  }

  // ================= Rhyme panel =================
  function updateRhymeTarget(force) {
    if (!engine.ready || st.pinned || !current()) return;
    const v = pad.value;
    const [a, b] = [pad.selectionStart, pad.selectionEnd];
    const sel = v.slice(a, b).trim();
    const lines = v.split('\n');
    const li = lineIndexAt(a);
    if (sel && /^[A-Za-z'’]+$/.test(sel) && sel.length < 30) return setRhymeWord(sel, '', `Selected word`, force);
    let target = li;
    if (!lastWordOf(lines[li] || '') || SECTION_RE.test(lines[li] || '')) {
      target = -1;
      for (let j = li - 1; j >= 0; j--) if (lastWordOf(lines[j]) && !SECTION_RE.test(lines[j])) { target = j; break; }
    }
    if (target < 0) { st.rhWord = null; st.rh = null; renderRhymeHead(); renderRhymes(); return; }
    const line = lines[target];
    const bar = st.analysis?.res[target]?.bar;
    setRhymeWord(lastWordOf(line), line, `${target === li ? 'End of this bar' : 'End of previous bar'}${bar ? ` · bar ${bar}` : ''}`, force);
  }

  const webCache = new Map();
  function setRhymeWord(word, line = '', sub = '', force = false) {
    const w = RhymeEngine.clean(word);
    if (!w) return;
    const key = w + '|' + line.trim().toLowerCase().split(/\s+/).slice(-3).join(' ');
    if (!force && st.rhKey === key) { st.rhSub = sub; renderRhymeHead(false); return; }
    st.rhKey = key;
    st.rhWord = w;
    st.rhSub = sub;
    st.rh = engine.find(w, line);
    st.chip = null;
    hideDef();
    renderRhymeHead(true);
    renderRhymes();
    if (S().online) fetchWebRhymes(w);
  }

  async function fetchWebRhymes(w) {
    let data = webCache.get(w);
    if (!data) {
      try {
        const q = (rel) => fetch(`https://api.datamuse.com/words?${rel}=${encodeURIComponent(w)}&md=sf&max=120`).then((r) => r.json());
        const [perf, near, similar] = await Promise.all([q('rel_rhy'), q('rel_nry'), q('ml')]);
        data = { perfect: perf, near, similar };
        webCache.set(w, data);
      } catch { return; }
    }
    if (st.rhWord !== w || !st.rh) return;
    // Datamuse also knows a lot of rare names and odd phrases: keep words people use, and phrases made of them
    const common = (t) => (spell.words?.get(t) || engine.freq(t) || 0) >= 50;
    const goodWeb = (list) => (x) => {
      if (x.word === w || !/^[a-z' -]+$/.test(x.word)) return false;
      const top = Math.max(1, ...list.map((y) => y.score || 0));
      if ((x.score || 0) < Math.max(10, top * 0.02)) return false; // Datamuse ranks its odd guesses far down
      const f = +((x.tags || []).find((t) => t.startsWith('f:')) || 'f:0').slice(2);
      return x.word.includes(' ') ? x.word.split(/[ -]/).every(common) : (spell.words?.has(x.word) ?? true) && (f >= 0.3 || common(x.word));
    };
    for (const k of ['perfect', 'near']) {
      const have = new Set([...st.rh.perfect, ...st.rh.near, ...st.rh.slant, ...st.rh.multi].map((x) => x[0]));
      st.rh['web_' + k] = data[k].filter((x) => !have.has(x.word) && goodWeb(data[k])(x)).slice(0, 60).map((x) => [x.word, x.numSyllables || 1]);
    }
    st.rh.similar = (data.similar || []).filter(goodWeb(data.similar || [])).slice(0, 80).map((x) => [x.word, x.numSyllables || 1]);
    renderRhymeHead(false);
    renderRhymes(true);
  }

  function renderRhymeHead(animate) {
    const el = $('#rh-word');
    const r = st.rh;
    if (!st.rhWord) {
      el.textContent = '·';
      $('#rh-sub').textContent = 'Type a bar. The last word gets rhymed.';
    } else {
      const ph = r?.phones ? r.phones.join(' ').replace(/\d/g, '').toLowerCase() : '';
      el.innerHTML = `${esc(st.rhWord)}<span class="ph">${esc(ph)}</span>`;
      const sl = engine.slang.get(st.rhWord);
      $('#rh-sub').innerHTML = (sl ? `<span class="slang-tag">slang</span>` : '') + esc(st.pinned ? 'Pinned' : st.rhSub || '');
      if (animate) { el.classList.remove('swap'); el.offsetWidth; el.classList.add('swap'); }
    }
    $('#rh-pin').classList.toggle('on', st.pinned);
    const counts = r ? {
      perfect: r.perfect.length + (r.web_perfect?.length || 0), near: r.near.length + (r.slant?.length || 0) + (r.web_near?.length || 0),
      multi: r.multi.length, slang: r.slang.length, similar: r.similar?.length || 0,
    } : {};
    $$('#rh-tabs button').forEach((b) => {
      const c = counts[b.dataset.tab];
      b.innerHTML = b.dataset.tab[0].toUpperCase() + b.dataset.tab.slice(1) + (c ? `<span class="cnt">${c > 99 ? '99+' : c}</span>` : '');
    });
    moveInk();
  }
  function moveInk() {
    const btn = $(`#rh-tabs button[data-tab="${st.rhymeTab}"]`);
    const ink = $('#rh-tabs .tab-ink');
    if (!btn) return;
    ink.style.width = btn.offsetWidth - 16 + 'px';
    ink.style.transform = `translateX(${btn.offsetLeft + 8}px)`;
  }

  function chips(list, cls = '') {
    return `<div class="chips">${list.map(([w]) => {
      const sl = engine.slang.has(w);
      return `<button class="chip ${sl ? 'slang' : ''} ${cls} ${st.chip === w ? 'sel' : ''}" data-key="${esc(st.rhKey + '|' + st.rhymeTab + '|' + w)}" data-w="${esc(w)}" title="${sl ? esc(engine.slang.get(w).def) : ''}">${esc(w)}</button>`;
    }).join('')}</div>`;
  }
  const isRare = ([w]) => engine.freq(w) < 3 && !engine.slang.has(w) && !w.includes(' ');
  function syllableGroups(list) {
    let html = '';
    for (const [syl, items] of bySyllables(list)) html += `<div class="rh-group"><h4>${syl}${syl === 5 ? '+' : ''} syllable${syl === 1 ? '' : 's'}</h4>${chips(items)}</div>`;
    return html;
  }
  function rareGroup(list) {
    if (!list.length) return '';
    return `<details class="rh-group rare" ${st.showRare ? 'open' : ''}><summary><h4>${icon('chevron', 12)}Rare and unusual words<span class="cnt">${list.length}</span></h4></summary>${chips(list, 'rare')}</details>`;
  }
  function bySyllables(list) {
    const g = new Map();
    for (const x of list) { const k = Math.min(x[1], 5); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
    return [...g.entries()].sort((a, b) => a[0] - b[0]);
  }

  function renderRhymes(settled = false) {
    const body = $('#rh-body');
    const r = st.rh;
    const empty = (msg) => `<div class="rh-empty">${logo(54, 'pulse')}${msg}</div>`;
    if (!engine.ready) { body.innerHTML = `<div class="rh-empty"><span class="loading-dots"><i></i><i></i><i></i></span><br/><br/>Loading the dictionary…</div>`; return; }
    if (!r) { body.innerHTML = empty('Start writing. Rhymes for the last word of your bar show up here.'); return; }
    const tab = st.rhymeTab;
    let html = '';
    if (tab === 'similar') {
      if (!S().online) html = empty('Similar words come from the online dictionary. Turn it on in Settings.');
      else if (!r.similar) html = `<div class="rh-group"><h4>Similar meaning</h4><span class="loading-dots"><i></i><i></i><i></i></span></div>`;
      else if (r.similar.length) html = `<div class="rh-group"><h4>Words with a similar meaning</h4>${chips(r.similar)}</div>`;
    } else if (tab === 'slang') {
      html = r.slang.length
        ? `<div class="rh-group"><h4>Slang & hip-hop</h4>${chips(r.slang)}</div>` +
          `<div class="rh-group"><h4>Meanings</h4>${r.slang.slice(0, 30).map(([w]) => `<div style="margin:0 0 8px;font-size:12.5px"><b>${esc(engine.slang.get(w).word)}</b> <span class="muted">${esc(engine.slang.get(w).def)}</span></div>`).join('')}</div>`
        : '';
    } else {
      const list = r[tab] || [];
      const rare = list.filter(isRare);
      html += syllableGroups(list.filter((x) => !isRare(x)));
      if (tab === 'near') {
        const slant = (r.slant || []).filter((x) => !isRare(x));
        if (slant.length) html += `<div class="rh-group"><h4>Slant rhymes · similar vowels</h4>${chips(slant, 'slant')}</div>`;
      }
      const web = r['web_' + tab];
      if (web?.length) html += `<div class="rh-group"><h4>${icon('globe', 12)} From the web · phrases & more</h4>${chips(web, 'web')}</div>`;
      else if (S().online && (tab === 'perfect' || tab === 'near') && !webCache.has(r.word)) html += `<div class="rh-group"><h4>From the web</h4><span class="loading-dots"><i></i><i></i><i></i></span></div>`;
      html += rareGroup(rare);
    }
    if (!html) html = empty(tab === 'multi' ? 'No multisyllable matches. Try a longer line ending.' : `No ${tab} rhymes for “${esc(r.word)}”. Check the other tabs.`);
    renderKeyed(body, html);
  }

  const defCache = new Map();
  async function getDefs(word) {
    const w = word.toLowerCase();
    const out = [];
    const sl = engine.slang.get(w);
    if (sl) out.push({ pos: 'slang', text: sl.def });
    if (!S().online) return out;
    if (!defCache.has(w)) {
      try {
        const j = await (await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(w)}&md=d&max=1`)).json();
        defCache.set(w, j[0] && j[0].word === w && j[0].defs ? j[0].defs.slice(0, 5).map((d) => { const [pos, text] = d.split('\t'); return { pos, text }; }) : []);
      } catch { return out; }
    }
    return out.concat(defCache.get(w));
  }
  const POS = { n: 'noun', v: 'verb', adj: 'adj', adv: 'adv', u: '', slang: 'slang' };
  const defList = (defs) => defs.map((d) => `<li><i>${esc(POS[d.pos] ?? d.pos)}</i>${esc(d.text)}</li>`).join('');

  function hideDef() {
    const card = $('#def-card');
    if (card.hidden || card.classList.contains('out')) return;
    card.classList.add('out');
    setTimeout(() => { card.hidden = true; card.classList.remove('out'); }, 170);
  }
  async function showDef(word) {
    const card = $('#def-card');
    card.classList.remove('out');
    const sl = engine.slang.get(word);
    const syl = engine.syllables(word);
    card.hidden = false;
    card.innerHTML = `<div class="dc-top"><div class="dc-word">${esc(word)}</div>${sl ? '<span class="slang-tag">' + esc(sl.cat || 'slang') + '</span>' : ''}
      <button class="icon-btn xs" data-dc="close">${icon('x', 14)}</button></div>
      <div class="dc-meta">${syl} syllable${syl === 1 ? '' : 's'}</div>
      <ol class="dc-defs">${sl ? defList([{ pos: 'slang', text: sl.def }]) : ''}<li class="muted dc-loading" style="list-style:none;margin-left:-18px"><span class="loading-dots"><i></i><i></i><i></i></span></li></ol>
      <div class="dc-acts"><button class="btn primary sm" data-dc="insert">${icon('plus', 14)}Insert</button>
      <button class="btn sm" data-dc="rhyme">${icon('search', 14)}Rhymes</button>
      <button class="btn ghost sm ${inBank(word) ? 'on' : ''}" data-dc="bank" title="Save to this song's word bank">${icon(inBank(word) ? 'starFill' : 'star', 14)}Save</button>
      <button class="icon-btn" data-dc="copy" title="Copy">${icon('copy', 14)}</button></div>`;
    card.dataset.word = word;
    const defs = await getDefs(word);
    if (card.dataset.word !== word) return;
    $('.dc-defs', card).innerHTML = defList(defs) || '<li class="muted" style="list-style:none;margin-left:-18px">No definition found.</li>';
  }

  function bindRhymes() {
    const body = $('#rh-body');
    body.addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      st.chip = c.dataset.w;
      $$('.chip.sel', body).forEach((x) => x.classList.remove('sel'));
      c.classList.add('sel');
      showDef(c.dataset.w);
    });
    body.addEventListener('dblclick', (e) => {
      const c = e.target.closest('.chip');
      if (c) { insertAtCursor(c.dataset.w); toast(`Inserted “${c.dataset.w}”`, 'plus'); }
    });
    $('#def-card').addEventListener('click', (e) => {
      const a = e.target.closest('[data-dc]')?.dataset.dc;
      const w = $('#def-card').dataset.word;
      if (a === 'close') hideDef();
      if (a === 'insert') insertAtCursor(w);
      if (a === 'copy') { navigator.clipboard.writeText(w); toast('Copied', 'copy'); }
      if (a === 'bank') {
        if (!current()) return toast('Open a lyric first', 'x');
        const added = toggleBank(w);
        const b = e.target.closest('[data-dc]');
        b.classList.toggle('on', added);
        b.innerHTML = icon(added ? 'starFill' : 'star', 14) + 'Save';
        toast(added ? `Saved “${w}” to the word bank` : 'Removed from word bank', 'star');
      }
      if (a === 'rhyme') { st.pinned = true; $('#rh-search').value = w; setRhymeWord(w, '', 'Lookup'); }
    });
    body.addEventListener('toggle', (e) => { if (e.target.classList.contains('rare')) st.showRare = e.target.open; }, true);
    $$('#rh-tabs button').forEach((b) => (b.onclick = () => {
      st.rhymeTab = b.dataset.tab;
      $$('#rh-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      moveInk(); renderRhymes();
    }));
    const search = $('#rh-search');
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && search.value.trim()) { st.pinned = true; setRhymeWord(search.value.trim().split(/\s+/).pop(), search.value, 'Lookup', true); }
      if (e.key === 'Escape') { search.value = ''; st.pinned = false; updateRhymeTarget(true); pad.focus(); }
    });
    search.addEventListener('input', () => { if (!search.value) { st.pinned = false; updateRhymeTarget(true); } });
    $('#rh-pin').onclick = () => {
      st.pinned = !st.pinned;
      if (!st.pinned) { search.value = ''; updateRhymeTarget(true); } else renderRhymeHead(false);
    };
  }

  // ================= Beats & player =================
  const audio = $('#audio');
  const player = { beat: null, playing: false, embed: false, taps: [] };

  function beatKind(url) {
    const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
    if (yt) return { kind: 'youtube', vid: yt[1] };
    if (/soundcloud\.com\//i.test(url)) return { kind: 'soundcloud' };
    return { kind: 'link' };
  }
  const KIND_LABEL = { file: 'Local file', youtube: 'YouTube', soundcloud: 'SoundCloud', link: 'Web link' };

  async function importBeats(paths) {
    const files = paths ? await api.importBeatPaths(paths) : await api.importBeats();
    const added = files.map((f) => ({ id: uid(), name: f.name, kind: 'file', file: f.file, bpm: guessBpm(f.name), added: now() }));
    lib.beats.unshift(...added);
    if (added.length) { persist(); toast(`${added.length} beat${added.length > 1 ? 's' : ''} imported`, 'music'); }
    if (st.view === 'beats') renderBeats();
    return added;
  }
  function guessBpm(name) {
    const m = name.match(/(\d{2,3})\s*bpm/i) || name.match(/\b(6\d|[7-9]\d|1[0-9]\d)\b/);
    return m ? +m[1] : null;
  }

  async function addLink(url, name) {
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const k = beatKind(url);
    const b = { id: uid(), name: name || url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60), kind: k.kind, url, vid: k.vid, bpm: null, added: now() };
    lib.beats.unshift(b);
    persist(); renderBeats();
    toast('Link saved', 'link');
    if (!name && (k.kind === 'youtube' || k.kind === 'soundcloud') && S().online) {
      try {
        const o = k.kind === 'youtube' ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}` : `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
        const j = await (await fetch(o)).json();
        if (j.title) { b.name = j.title; b.bpm = b.bpm || guessBpm(j.title); persist(); renderBeats(); }
      } catch {}
    }
  }

  function renderBeats() {
    const list = $('#beat-list');
    if (!lib.beats.length) {
      list.innerHTML = `<div class="empty-block">${logo(64, 'pulse')}<div style="font-weight:600;color:var(--fg)">No beats yet</div><div>Import an mp3 / wav or paste a link above.</div></div>`;
      return;
    }
    const cur = current();
    list._html = lib.beats.map((b) => {
      const uses = lib.lyrics.filter((l) => l.beatId === b.id).length;
      const playing = player.beat?.id === b.id && player.playing;
      return `<div class="beat ${playing ? 'playing' : ''}" data-id="${b.id}" data-key="${b.id}">
        <button class="b-play" data-b="play">${icon(playing ? 'pause' : b.kind === 'link' ? 'external' : 'play', 16)}</button>
        <div class="b-info"><div class="b-name" title="Double-click to rename">${esc(b.name)}</div>
          <div class="b-sub">${playing ? '<span class="bars-anim"><i></i><i></i><i></i></span>' : ''}<span>${KIND_LABEL[b.kind]}</span>${uses ? `<span>· used in ${uses} lyric${uses > 1 ? 's' : ''}</span>` : ''}</div></div>
        <input class="field b-bpm" data-b="bpm" type="number" min="40" max="240" placeholder="BPM" value="${b.bpm || ''}"/>
        <div class="b-acts">
          ${cur ? `<button class="btn ghost sm" data-b="attach" title="Attach to “${esc(cur.title || 'Untitled')}”">${icon(cur.beatId === b.id ? 'check' : 'pin', 14)}${cur.beatId === b.id ? 'Attached' : 'Attach'}</button>` : ''}
          ${b.url ? `<button class="icon-btn" data-b="open" title="Open in browser">${icon('external', 15)}</button>` : ''}
          <button class="icon-btn" data-b="rename" title="Rename">${icon('edit', 15)}</button>
          <button class="icon-btn" data-b="delete" title="Delete">${icon('trash', 15)}</button>
        </div></div>`;
    }).join('');
    renderKeyed(list, list._html);
  }

  function bindBeats() {
    const list = $('#beat-list');
    list.addEventListener('click', async (e) => {
      const row = e.target.closest('.beat'); if (!row) return;
      const b = beat(row.dataset.id);
      const a = e.target.closest('[data-b]')?.dataset.b;
      if (a === 'play') {
        if (b.kind === 'link') return api.openExternal(b.url);
        if (player.beat?.id === b.id) togglePlay(); else loadBeat(b, true);
      }
      if (a === 'open') api.openExternal(b.url);
      if (a === 'attach') {
        const l = current(); if (!l) return;
        l.beatId = l.beatId === b.id ? null : b.id;
        persist(); renderBeats(); renderAttach(); renderMeta();
        toast(l.beatId ? `Attached to “${l.title || 'Untitled'}”` : 'Detached', 'music');
      }
      if (a === 'rename') {
        const n = await promptModal('Rename beat', b.name);
        if (n) { b.name = n; persist(); renderBeats(); if (player.beat?.id === b.id) $('#pl-name').textContent = n; }
      }
      if (a === 'delete') {
        if (!(await confirmModal(`Delete “${b.name}”?`, b.kind === 'file' ? 'The imported audio file will be removed from Lemonade.' : 'The saved link will be removed.'))) return;
        if (player.beat?.id === b.id) closePlayer();
        if (b.file) api.deleteBeat(b.file);
        lib.beats = lib.beats.filter((x) => x.id !== b.id);
        lib.lyrics.forEach((l) => { if (l.beatId === b.id) l.beatId = null; });
        persist(); renderBeats(); renderAttach();
      }
    });
    list.addEventListener('dblclick', async (e) => {
      if (!e.target.closest('.b-name')) return;
      const b = beat(e.target.closest('.beat').dataset.id);
      const n = await promptModal('Rename beat', b.name);
      if (n) { b.name = n; persist(); renderBeats(); }
    });
    list.addEventListener('change', (e) => {
      if (e.target.dataset.b !== 'bpm') return;
      const b = beat(e.target.closest('.beat').dataset.id);
      setBeatBpm(b, +e.target.value || null);
    });
    $('#import-beats').onclick = () => importBeats();
    $('#link-form').onsubmit = (e) => {
      e.preventDefault();
      const url = $('#link-url').value.trim();
      if (!url) return;
      addLink(url, $('#link-name').value.trim());
      $('#link-url').value = ''; $('#link-name').value = '';
    };
  }

  async function loadBeat(b, autoplay) {
    if (!b) return;
    if (b.kind === 'link') { if (autoplay) api.openExternal(b.url); return; }
    stopEmbed();
    audio.pause();
    player.beat = b;
    $('#player').classList.remove('hidden');
    document.body.classList.add('has-player');
    $('#pl-name').textContent = b.name;
    $('#pl-kind').textContent = KIND_LABEL[b.kind] + (b.bpm ? ` · ${fmtBpm(b.bpm)} BPM` : '');
    const isFile = b.kind === 'file';
    $('.pl-seek').style.visibility = isFile ? '' : 'hidden';
    $('#pl-back').style.visibility = isFile ? '' : 'hidden';
    $('#pl-loop').style.visibility = isFile ? '' : 'hidden';
    $('#pl-ab').style.visibility = isFile ? '' : 'hidden';
    $('#pl-vol').style.display = $('.vol-i').style.display = isFile ? '' : 'none';
    $('#pl-video').hidden = b.kind !== 'youtube';
    $('#pl-ext').hidden = isFile;
    updateBpmLabel();
    if (isFile) {
      audio.src = await api.beatUrl(b.file);
      audio.loop = S().loop;
      prepareWave(b);
      if (autoplay) audio.play().catch(() => toast('Could not play this file', 'x'));
    } else if (autoplay) startEmbed();
    setPlaying(isFile ? !audio.paused : player.embed);
    metroSync();
  }

  function startEmbed() {
    const b = player.beat;
    const wrap = $('#embed-wrap');
    let src;
    if (b.kind === 'youtube') src = `https://www.youtube-nocookie.com/embed/${b.vid}?autoplay=1&loop=1&playlist=${b.vid}&rel=0&modestbranding=1`;
    else src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(b.url)}&auto_play=true&visual=false&show_comments=false&color=${encodeURIComponent((S().accent === 'mono' ? '#ffffff' : S().accent).replace('#', ''))}`;
    wrap.className = 'embed-wrap' + (b.kind === 'soundcloud' ? ' sc' : '');
    wrap.innerHTML = `<div class="embed-bar">${icon(b.kind === 'youtube' ? 'video' : 'music', 14)}<span class="eb-name">${esc(b.name)}</span>
      <button class="icon-btn xs" data-e="min" title="Hide (keeps playing)">${icon('minus', 14)}</button>
      <button class="icon-btn xs" data-e="close" title="Stop">${icon('x', 14)}</button></div>
      <iframe src="${src}" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
    player.embed = true;
    setPlaying(true);
  }
  function stopEmbed() {
    $('#embed-wrap').innerHTML = '';
    $('#embed-wrap').className = 'embed-wrap hidden';
    player.embed = false;
  }

  function togglePlay() {
    const b = player.beat;
    if (!b) return;
    if (b.kind === 'file') audio.paused ? audio.play() : audio.pause();
    else { player.embed ? stopEmbed() : startEmbed(); setPlaying(player.embed); }
  }
  function setPlaying(on) {
    player.playing = on;
    $('#pl-play').innerHTML = icon(on ? 'pause' : 'play', 16);
    $$('.lemon-logo.disc, #tb-brand .lemon-logo').forEach((l) => l.classList.toggle('spinning', on));
    if (on && player.beat?.kind === 'file') waveLoop();
    if (st.view === 'beats') renderBeats();
  }
  function closePlayer() {
    audio.pause(); audio.removeAttribute('src'); stopEmbed();
    player.beat = null;
    setPlaying(false);
    $('#player').classList.add('hidden');
    document.body.classList.remove('has-player');
    if (st.metroOn) metroToggle(false);
  }
  function updateBpmLabel() { $('#pl-bpm').textContent = player.beat?.bpm ? fmtBpm(player.beat.bpm) : ''; }
  function setRangeFill(el) { el.style.setProperty('--p', (el.value / el.max) * 100 + '%'); }

  function bindPlayer() {
    $('#pl-disc').innerHTML = logo(40, 'disc');
    LMAudio.routeMedia(audio);
    audio.addEventListener('play', () => { LMAudio.ctx(); setPlaying(true); });
    audio.addEventListener('pause', () => setPlaying(false));
    audio.addEventListener('ended', () => setPlaying(false));
    audio.addEventListener('loadedmetadata', () => { $('#pl-dur').textContent = fmtTime(audio.duration); });
    audio.addEventListener('timeupdate', () => {
      $('#pl-cur').textContent = fmtTime(audio.currentTime);
      if (!player.playing) drawWave();
    });
    audio.addEventListener('seeked', () => drawWave());
    const vol = $('#pl-vol');
    vol.value = S().volume; audio.volume = S().volume / 100; setRangeFill(vol);
    vol.addEventListener('input', () => { audio.volume = vol.value / 100; S().volume = +vol.value; setRangeFill(vol); persist(); });
    $('#pl-play').onclick = togglePlay;
    $('#pl-back').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 5); };
    const loopBtn = $('#pl-loop');
    loopBtn.classList.toggle('on', S().loop);
    loopBtn.onclick = () => { S().loop = !S().loop; audio.loop = S().loop; loopBtn.classList.toggle('on', S().loop); persist(); toast(S().loop ? 'Loop on' : 'Loop off', 'repeat'); };
    $('#pl-close').onclick = closePlayer;
    $('#pl-ext').onclick = () => player.beat?.url && api.openExternal(player.beat.url);
    $('#pl-video').onclick = () => { if (!player.embed) return startEmbed(); $('#embed-wrap').classList.toggle('collapsed'); };
    $('#pl-tap').onclick = () => {
      const t = performance.now();
      const btn = $('#pl-tap');
      btn.classList.remove('hit'); btn.offsetWidth; btn.classList.add('hit');
      if (player.taps.length && t - player.taps[player.taps.length - 1] > 2000) player.taps = [];
      player.taps.push(t);
      player.taps = player.taps.slice(-8);
      if (player.taps.length >= 3) {
        const iv = (player.taps[player.taps.length - 1] - player.taps[0]) / (player.taps.length - 1);
        const bpm = Math.round(60000 / iv);
        $('#pl-bpm').textContent = bpm;
        if (player.beat && player.taps.length >= 4) setBeatBpm(player.beat, bpm);
      }
    };
  }

  // Text files saved by Notepad can be UTF-8 or the old Windows code page.
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
  }

  // file drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; $('#drop-hint').classList.add('on'); } });
  window.addEventListener('dragleave', (e) => { if (e.dataTransfer.types.includes('Files') && --dragDepth <= 0) { dragDepth = 0; $('#drop-hint').classList.remove('on'); } });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    dragDepth = 0; $('#drop-hint').classList.remove('on');
    const all = [...e.dataTransfer.files];
    const texts = all.filter((f) => /\.(txt|text|md|lrc)$/i.test(f.name));
    if (texts.length) {
      const target = treeItem(e.target); // dropped onto a project or folder in the library
      const pid = target ? (target.type === 'project' ? target.id : target.item.projectId) : null;
      const fid = target?.type === 'folder' ? target.id : target?.type === 'lyric' ? target.item.folderId : null;
      importTextFiles(await Promise.all(texts.map(async (f) => ({ name: f.name, text: decodeText(await f.arrayBuffer()) }))), pid, fid);
    }
    const paths = all.filter((f) => !texts.includes(f)).map((f) => api.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    const added = await importBeats(paths);
    if (!added.length) toast('No supported audio files', 'x');
    else if (st.view === 'write' && current() && !current().beatId) { current().beatId = added[0].id; loadBeat(added[0], false); renderAttach(); renderMeta(); persist(); }
  });

  // ================= Dictionary =================
  let dictCat = 'all';
  function renderDictionary() {
    const cats = {};
    for (const s of engine.slang.values()) cats[s.cat] = (cats[s.cat] || 0) + 1;
    const mine = (lib.customWords || []).length;
    $('#dict-count').textContent = `${engine.slang.size} slang & hip-hop terms${mine ? ` (${mine} yours)` : ''} · ${engine.words.size.toLocaleString()} words in the rhyme dictionary`;
    $('#dict-cats').className = 'chips cats';
    $('#dict-cats').innerHTML = [['all', engine.slang.size], ...Object.entries(cats).sort((a, b) => b[1] - a[1])]
      .map(([c, n]) => `<button class="chip cat ${dictCat === c ? 'active' : ''}" data-cat="${c}">${c === 'all' ? 'All' : c[0].toUpperCase() + c.slice(1)} <span class="muted" style="font-size:11px">${n}</span></button>`).join('');
    renderDictGrid();
  }
  function renderDictGrid() {
    const q = $('#dict-search').value.trim().toLowerCase();
    const items = [...engine.slang.entries()]
      .filter(([k, s]) => (dictCat === 'all' || s.cat === dictCat) && (!q || k.includes(q) || s.def.toLowerCase().includes(q)))
      .sort((a, b) => (q ? (b[0].startsWith(q) - a[0].startsWith(q)) : 0) || a[0].localeCompare(b[0]));
    $('#dict-grid')._html = items.map(([k, s]) => `<div class="d-card" data-w="${esc(k)}" data-key="${esc(k)}">
      <div class="w"><span>${esc(s.word)}</span><span class="acts">${s.custom ? `<button class="del" data-del="${esc(k)}" title="Remove your word">${icon('trash', 13)}</button>` : ''}<span class="slang-tag">${esc(s.custom && s.cat === 'yours' ? 'yours' : s.cat)}</span></span></div><div class="d">${esc(s.def)}</div></div>`).join('')
      || (q ? '' : '<div class="muted">Nothing here.</div>');
    renderKeyed($('#dict-grid'), $('#dict-grid')._html);
  }
  async function lookup(word) {
    word = RhymeEngine.clean(word);
    const box = $('#dict-lookup');
    if (!word) { box.innerHTML = ''; return; }
    const ph = engine.phones(word);
    const syl = engine.syllables(word);
    const r = engine.find(word);
    box.innerHTML = `<div class="lookup-card"><button class="icon-btn lc-close" data-lookup-close title="Close (Esc)">${icon('x', 15)}</button><div style="display:flex;align-items:center;gap:10px"><h3>${esc(word)}</h3>${engine.slang.has(word) ? '<span class="slang-tag">slang</span>' : ''}</div>
      <div class="lc-meta">${syl} syllable${syl === 1 ? '' : 's'}${ph ? ' · ' + esc(ph.join(' ').replace(/\d/g, '').toLowerCase()) : ''}${engine.has(word) ? '' : ' · not in dictionary, pronunciation guessed'}</div>
      <ol class="lc-defs"><li style="list-style:none;margin-left:-18px"><span class="loading-dots"><i></i><i></i><i></i></span></li></ol>
      <div class="rh-group"><h4>Top rhymes</h4>${chips([...r.slang.slice(0, 8), ...r.perfect.slice(0, 24)].filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i))}</div>
      <button class="btn primary sm" data-lookup-rhyme="${esc(word)}">${icon('write', 14)}Open in rhyme panel</button>
      ${engine.slang.has(word) ? '' : `<button class="btn sm" data-add-word="${esc(word)}">${icon('plus', 14)}Add to my library</button>`}</div>`;
    const defs = await getDefs(word);
    if (box.querySelector('h3')?.textContent !== word) return;
    $('.lc-defs', box).innerHTML = defList(defs) || '<li class="muted" style="list-style:none;margin-left:-18px">No definition found' + (S().online ? '' : ' (online dictionary is off in Settings)') + '.</li>';
  }
  function closeLookup() {
    const box = $('#dict-lookup');
    const card = $('.lookup-card', box);
    if (!card) return;
    card.classList.add('out');
    setTimeout(() => { box.innerHTML = ''; }, 160);
    if ($('#dict-search').value) { $('#dict-search').value = ''; renderDictGrid(); }
  }
  function bindDictionary() {
    let t;
    $('#dict-search').addEventListener('input', (e) => {
      renderDictGrid();
      clearTimeout(t);
      const v = e.target.value.trim();
      t = setTimeout(() => lookup(/^[a-zA-Z']+$/.test(v) ? v : ''), 300);
    });
    $('#dict-cats').addEventListener('click', (e) => {
      const c = e.target.closest('[data-cat]'); if (!c) return;
      dictCat = c.dataset.cat;
      $$('#dict-cats .chip').forEach((x) => x.classList.toggle('active', x === c));
      renderDictGrid();
    });
    $('#dict-grid').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) { e.stopPropagation(); return removeCustomWord(del.dataset.del); }
      const c = e.target.closest('.d-card'); if (!c) return;
      lookup(c.dataset.w);
      $('.page', $('section[data-view="dictionary"]')).scrollTo({ top: 0, behavior: 'smooth' });
    });
    $('#dict-lookup').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) { $('#dict-search').value = chip.dataset.w; lookup(chip.dataset.w); renderDictGrid(); }
      if (e.target.closest('[data-lookup-close]')) return closeLookup();
      const aw = e.target.closest('[data-add-word]');
      if (aw) return addWordModal({ word: aw.dataset.addWord });
      const b = e.target.closest('[data-lookup-rhyme]');
      if (b) {
        setView('write');
        st.pinned = true;
        $('#rh-search').value = b.dataset.lookupRhyme;
        setRhymeWord(b.dataset.lookupRhyme, '', 'Lookup', true);
      }
    });
  }

  // ================= Archive =================
  function renderArchive() {
    const el = $('#archive-list');
    const groups = [
      ['Projects', 'project', lib.projects.filter((p) => p.archived), (p) => `${lib.lyrics.filter((l) => l.projectId === p.id).length} lyrics`],
      ['Folders', 'folder', lib.folders.filter((f) => f.archived), (f) => project(f.projectId)?.name || ''],
      ['Lyrics', 'lyric', lib.lyrics.filter((l) => l.archived), (l) => [project(l.projectId)?.name, l.folderId && folder(l.folderId)?.name].filter(Boolean).join(' / ')],
    ];
    let html = '';
    for (const [title, type, items, sub] of groups) {
      if (!items.length) continue;
      html += `<div class="arch-group"><h3>${title}</h3>` + items.map((it) => `<div class="arch-row" data-type="${type}" data-id="${it.id}" data-key="${type}:${it.id}">
        ${icon(type === 'project' ? 'project' : type === 'folder' ? 'folder' : 'file', 16)}
        <div class="a-name">${esc(it.title || it.name || 'Untitled')}<span class="a-sub">${esc(sub(it))}${it.archivedAt ? ' · archived ' + rel(it.archivedAt) : ''}</span></div>
        <button class="btn sm" data-a="restore">${icon('restore', 14)}Restore</button>
        <button class="icon-btn" data-a="delete" title="Delete forever">${icon('trash', 15)}</button></div>`).join('') + '</div>';
    }
    el.innerHTML = html || `<div class="empty-block">${logo(64, 'pulse')}<div style="font-weight:600;color:var(--fg)">Archive is empty</div><div>Right-click any project, folder or lyric → Archive.</div></div>`;
  }
  function bindArchive() {
    $('#archive-list').addEventListener('click', (e) => {
      const row = e.target.closest('.arch-row'); if (!row) return;
      const a = e.target.closest('[data-a]')?.dataset.a;
      const { type, id } = row.dataset;
      const item = type === 'project' ? project(id) : type === 'folder' ? folder(id) : lyric(id);
      if (a === 'restore') {
        item.archived = false;
        if (type === 'lyric' && !project(item.projectId)) item.projectId = lib.projects[0]?.id;
        persist(); renderArchive(); renderTree();
        toast('Restored', 'restore');
      }
      if (a === 'delete') deleteItem(type, item);
    });
  }

  // ================= Settings =================
  async function renderSettings() {
    const s = S();
    const info = await api.appInfo();
    const seg = (key, opts) => `<div class="seg" data-seg="${key}">${opts.map(([v, label, ic]) =>
      `<button data-v="${v}" class="${String(s[key]) === String(v) ? 'active' : ''}">${ic ? icon(ic, 14) : ''}${label}</button>`).join('')}</div>`;
    const tog = (key) => `<label class="toggle"><input type="checkbox" data-tog="${key}" ${s[key] ? 'checked' : ''}/><span></span></label>`;
    const row = (title, desc, ctl) => `<div class="set-row"><div class="sr-text"><div class="sr-title">${title}</div>${desc ? `<div class="sr-desc">${desc}</div>` : ''}</div><div class="sr-ctl">${ctl}</div></div>`;
    const section = (title, rows, n, id = '') => `<div class="set-section" ${id ? `id="${id}"` : ''} style="--n:${n}"><h3>${title}</h3><div class="set-card">${rows}</div></div>`;
    const isCustom = !ACCENTS.some(([c]) => c === s.accent);

    $('#settings-page').innerHTML = `
      <div class="set-hero">${logo(64, 'hoverable spin-hero')}<div><h1>Lemonade</h1><div class="ver">Version ${esc(info.version)} · your lyric pad</div></div></div>
      ${section('Appearance', [
        row('Theme', 'Black, white, or follow Windows.', seg('theme', [['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['system', 'System', 'monitor']])),
        row('Accent color', 'Used for highlights, the logo and the active state.', `<div class="swatches">${ACCENTS.map(([c, n]) =>
          `<button class="swatch ${s.accent === c ? 'active' : ''}" data-accent="${c}" title="${n}" style="--c:${c === 'mono' ? 'var(--fg)' : c}"></button>`).join('')}
          <label class="swatch custom ${isCustom ? 'active' : ''}" title="Custom" style="--c:${isCustom ? s.accent : 'var(--fg)'}"><input type="color" id="accent-custom" value="${isCustom ? s.accent : '#ffd60a'}"/></label></div>`),
        row('Animations', 'Motion for transitions, the logo and lists.', tog('animations')),
        row('Splash screen', 'Show the animated logo when the app starts.', tog('splash')),
      ].join(''), 0)}
      ${section('Editor', [
        row('Font', '', seg('editorFont', [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']])),
        row('Font size', '', `<input type="range" min="13" max="28" step="1" data-range="fontSize" value="${s.fontSize}"/><span class="size-val">${s.fontSize}px</span>`),
        row('Line spacing', '', `<input type="range" min="1.3" max="2.6" step="0.1" data-range="lineHeight" value="${s.lineHeight}"/><span class="size-val">${(+s.lineHeight).toFixed(1)}</span>`),
        row('Rhyme highlighting', 'Color rhyming line endings, or every rhyming word.', seg('rhymeHighlight', [['off', 'Off'], ['end', 'Line ends'], ['all', 'All rhymes']])),
        row('Bar numbers', 'Numbered bars, restarting with each [Section].', tog('showBars')),
        row('Syllable count', 'Syllables per bar, shown on the right.', tog('showSyllables')),
        row('Spelling', 'Off only underlines misspelled words. Suggest also lists fixes when you point at one. Auto fixes a word as soon as you finish it, and Ctrl+Z puts yours back.',
          seg('spelling', [['off', 'Off'], ['suggest', 'Suggest'], ['auto', 'Auto']])),
        row('Your dictionary', `${lib.dictionary.length} word${lib.dictionary.length === 1 ? '' : 's'} you added. They are never marked as misspelled.`, `<button class="btn sm" data-act="dict">${icon('book', 14)}Edit</button>`),
      ].join(''), 1)}
      ${section('Recording', [
        row('Microphone', 'The mic takes are recorded with.', `<select id="mic-select" class="mic-select"><option value="">Windows default</option></select>`),
        row('Mic boost', 'Turns a quiet mic up before it is recorded.', `<input type="range" class="boost-range" data-boost min="0" max="24" step="1" value="${s.micBoost || 0}"/><span class="size-val boost-val">+${s.micBoost || 0} dB</span>`),
        `<div class="set-row set-level"><div class="sr-text"><div class="sr-title">Level</div><div class="sr-desc mic-hint">Check the level while you rap a few bars.</div>
          <div class="lvl wide"><i class="lvl-fill"></i><i class="lvl-peak"></i></div></div>
          <div class="sr-ctl"><button class="btn sm mic-check" data-act="miccheck">${icon('mic', 14)}Check level</button></div></div>`,
        row('Limiter', 'Keeps boosted takes from clipping on loud parts.', tog('micLimiter')),
        row('Auto gain', 'Lets Windows even out your volume. It can pump on loud and quiet parts.', tog('micAgc')),
        row('Noise suppression', 'Filters out steady noise like fans. It can make vocals sound thinner.', tog('micNoise')),
        row('Echo cancellation', 'Only needed without headphones.', tog('micEcho')),
        row('Count-in', 'One bar of clicks before a take starts.', tog('countIn')),
      ].join(''), 2, 'set-recording')}
      ${section('Rhymes & dictionary', [
        row('Online dictionary', 'Adds rhymes, phrases and definitions from Datamuse. The words you look up are sent there. Rhymes work offline without it.', tog('online')),
      ].join(''), 2)}
      ${section('Library', [
        row('Reopen last lyric', 'Continue where you left off on startup.', tog('reopenLast')),
        row('Backup', 'Export or restore all projects, lyrics and beat links as one file.', `<button class="btn sm" data-act="export">${icon('download', 14)}Export</button><button class="btn sm" data-act="import">${icon('upload', 14)}Import</button>`),
        row('Data folder', esc(info.dataPath), `<button class="btn sm" data-act="data">${icon('folder', 14)}Open</button>`),
      ].join(''), 3)}
      ${section('System', [
        row('Desktop shortcut', 'Put a Lemonade icon on your desktop.', `<button class="btn primary sm" data-act="shortcut">${icon('shortcut', 14)}Create shortcut</button>`),
        row('Start menu', 'Find Lemonade in the Windows Start menu.', `<button class="btn sm" data-act="startmenu">${icon('plus', 14)}Add to Start</button>`),
      ].join(''), 4)}
      ${section('Updates', `<div id="update-rows">${updateRows()}</div>`, 5)}
      ${section('Keyboard shortcuts', `<div class="kbd-list">
        <span>New lyric</span><span><kbd>Ctrl</kbd> <kbd>N</kbd></span>
        <span>Save now</span><span><kbd>Ctrl</kbd> <kbd>S</kbd></span>
        <span>Search lyrics</span><span><kbd>Ctrl</kbd> <kbd>F</kbd></span>
        <span>Look up a word</span><span><kbd>Ctrl</kbd> <kbd>K</kbd></span>
        <span>Play / pause beat</span><span><kbd>Ctrl</kbd> <kbd>Space</kbd></span>
        <span>Export lyric</span><span><kbd>Ctrl</kbd> <kbd>E</kbd></span>
        <span>Focus mode</span><span><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>F</kbd></span>
        <span>Perform mode</span><span><kbd>Ctrl</kbd> <kbd>P</kbd></span>
        <span>Record a take</span><span><kbd>Ctrl</kbd> <kbd>R</kbd></span>
        <span>Metronome on / off</span><span><kbd>Ctrl</kbd> <kbd>M</kbd></span>
        <span>Toggle library / side panel</span><span><kbd>Ctrl</kbd> <kbd>B</kbd> · <kbd>Ctrl</kbd> <kbd>J</kbd></span>
        <span>Switch views</span><span><kbd>Ctrl</kbd> <kbd>1</kbd>-<kbd>4</kbd> · <kbd>Ctrl</kbd> <kbd>,</kbd></span>
        <span>Insert a rhyme</span><span>double-click a rhyme chip</span></div>`, 5)}
      ${section('About', `<div class="set-row"><div class="sr-text"><div class="sr-desc">Free and open source under the GNU GPL 3.0. Pronunciations from the CMU Pronouncing Dictionary, word frequencies from SUBTLEX-US, online rhymes and definitions from the Datamuse API. Electron ${esc(info.electron)}.</div></div><div class="sr-ctl"><button class="btn sm" data-act="repo">${icon('external', 14)}GitHub</button></div></div>`, 7)}`;
    $$('#settings-page input[type=range]').forEach(setRangeFill);
    fillMicSelect();
    requestAnimationFrame(() => inkSegs($('#settings-page')));
  }

  async function fillMicSelect() {
    const sel = $('#mic-select');
    if (!sel) return;
    const devs = await refreshMicName();
    sel.innerHTML = '<option value="">Windows default</option>' + devs.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === S().micId ? 'selected' : ''}>${esc(d.label || `Microphone ${i + 1}`)}</option>`).join('');
  }

  async function editDictionary() {
    const words = await modal(`<h3>Your dictionary</h3><p>Words here are never marked as misspelled. One per line.</p>
      <textarea class="field dict-edit" spellcheck="false">${esc(lib.dictionary.join('\n'))}</textarea>
      <div class="m-acts"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Save</button></div>`, (m, close) => {
      const ta = $('textarea', m);
      ta.focus();
      $('[data-x]', m).onclick = () => close(null);
      $('[data-ok]', m).onclick = () => close(ta.value);
    });
    if (words == null) return;
    lib.dictionary = [...new Set(words.split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter(Boolean))].sort();
    dictSet = new Set(lib.dictionary);
    spell.cache.clear();
    persist();
    scheduleBackdrop();
    renderSettings();
  }

  function bindSettings() {
    const page = $('#settings-page');
    page.addEventListener('click', async (e) => {
      const segBtn = e.target.closest('.seg button');
      if (segBtn) {
        const key = segBtn.parentElement.dataset.seg;
        let v = segBtn.dataset.v;
        $$('button', segBtn.parentElement).forEach((b) => b.classList.toggle('active', b === segBtn));
        if (key === 'theme') crossfade(() => setSetting(key, v)); else setSetting(key, v);
        return;
      }
      const sw = e.target.closest('[data-accent]');
      if (sw) {
        crossfade(() => setSetting('accent', sw.dataset.accent));
        $$('.swatch', page).forEach((x) => x.classList.toggle('active', x === sw));
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'shortcut' || act === 'startmenu') {
        const r = await api.createShortcut(act === 'shortcut' ? 'desktop' : 'startmenu');
        r.ok ? toast(act === 'shortcut' ? 'Desktop shortcut created' : 'Added to Start menu', 'check') : toast(r.error, 'x');
      }
      if (act === 'export') { await flush(); if (await api.exportBackup(JSON.stringify(lib, null, 2))) toast('Backup exported', 'download'); }
      if (act === 'import') {
        if (rec.on) stopRecording();
        const txt = await api.importBackup();
        if (!txt) return;
        try {
          const data = JSON.parse(txt);
          if (!Array.isArray(data.lyrics) || !Array.isArray(data.projects)) throw 0;
          if (!(await confirmModal('Replace your library?', `The backup has ${data.projects.length} projects and ${data.lyrics.length} lyrics. Your current library will be replaced.`, 'Replace', true))) return;
          lib = normalize(data);
          persist(); applySettings(); closeEditor(); renderTree(); renderSettings();
          toast('Backup restored', 'restore');
        } catch { toast('That file is not a Lemonade backup', 'x'); }
      }
      if (act === 'data') api.openDataFolder();
      if (act === 'repo') api.openExternal('https://github.com/slashneck/Lemonade');
      if (act === 'dict') editDictionary();
      if (act === 'miccheck') toggleMicCheck();
      if (act === 'check') api.checkForUpdate();
      if (act === 'restart') installUpdate();
      if (act === 'release') api.openExternal(st.update?.pageUrl || 'https://github.com/slashneck/Lemonade/releases');
    });
    page.addEventListener('change', (e) => {
      if (e.target.dataset.tog) setSetting(e.target.dataset.tog, e.target.checked);
      if (e.target.dataset.tog === 'checkUpdates') { api.updateConfig({ enabled: e.target.checked }); renderUpdateUi(); }
      if (['micLimiter', 'micAgc', 'micNoise', 'micEcho'].includes(e.target.dataset.tog) && mic.stream) openMic();
      if (e.target.dataset.tog === 'countIn') $('#rec-countin').checked = e.target.checked;
      if (e.target.id === 'mic-select') { S().micId = e.target.value; persist(); if (mic.stream) openMic(); else refreshMicName(); }
      if (e.target.id === 'accent-custom') {
        setSetting('accent', e.target.value);
        $$('.swatch', page).forEach((x) => x.classList.toggle('active', x.classList.contains('custom')));
      }
    });
    page.addEventListener('input', (e) => {
      if (e.target.dataset.boost !== undefined) return setMicBoost(+e.target.value);
      const k = e.target.dataset.range;
      if (k) {
        const v = +e.target.value;
        e.target.nextElementSibling.textContent = k === 'fontSize' ? v + 'px' : v.toFixed(1);
        setRangeFill(e.target);
        S()[k] = v;
        clearTimeout(e.target._t);
        e.target._t = setTimeout(() => { applySettings(); syncBackdropSize(); persist(); }, 30);
      }
      if (e.target.id === 'accent-custom') {
        document.documentElement.style.setProperty('--accent', e.target.value);
        e.target.parentElement.style.setProperty('--c', e.target.value);
      }
    });
  }

  // ================= Side panes & panels =================
  function setPane(name) {
    if (st.pane === 'takes' && name !== 'takes' && mic.monitoring && !rec.on) closeMic();
    st.pane = name;
    $$('#side-switch button').forEach((b) => b.classList.toggle('active', b.dataset.pane === name));
    $$('#rhymes .pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
    if (name === 'rhymes') requestAnimationFrame(moveInk);
    renderPane(name);
  }
  function renderPane(name = st.pane) {
    if (name === 'notes') renderNotes();
    if (name === 'takes') renderTakes();
    if (name === 'history') renderHistory();
  }
  function setPanels() {
    $('#sidebar').classList.toggle('collapsed', !!lib.ui.leftHidden);
    $('#rhymes').classList.toggle('collapsed', !!lib.ui.rightHidden);
    document.body.classList.toggle('left-hidden', !!lib.ui.leftHidden);
    document.body.classList.toggle('right-hidden', !!lib.ui.rightHidden);
  }
  function togglePanel(side) {
    const k = side === 'left' ? 'leftHidden' : 'rightHidden';
    lib.ui[k] = !lib.ui[k];
    setPanels();
    persist();
  }

  // ================= Word bank & notes =================
  function renderNotes() {
    const l = current();
    const bank = $('#bank');
    $('#notes').disabled = !l;
    $('#notes').value = l?.notes || '';
    if (!l) { bank.innerHTML = '<div class="bank-empty">Open a lyric to use the word bank.</div>'; return; }
    const items = l.bank || [];
    bank._html = items.length
      ? items.map((w, i) => `<div class="bank-item ${/\s/.test(w.trim()) && w.length > 16 ? 'line' : ''}" data-i="${i}" data-key="${esc(w)}" title="Click for rhymes">
          <span>${esc(w)}</span><button data-ins="${i}" title="Insert into lyric">${icon('plus', 12)}</button><button data-x="${i}" title="Remove">${icon('x', 12)}</button></div>`).join('')
      : '<div class="bank-empty">Nothing saved yet.</div>';
    renderKeyed(bank, bank._html);
  }
  const inBank = (w) => !!current()?.bank?.some((x) => x.toLowerCase() === w.toLowerCase());
  function toggleBank(text) {
    const l = current();
    const t = (text || '').trim();
    if (!l || !t) return false;
    l.bank = l.bank || [];
    const i = l.bank.findIndex((x) => x.toLowerCase() === t.toLowerCase());
    if (i >= 0) l.bank.splice(i, 1); else l.bank.unshift(t);
    persist();
    if (st.pane === 'notes') renderNotes();
    return i < 0;
  }
  function bindNotes() {
    $('#bank-form').onsubmit = (e) => {
      e.preventDefault();
      const inp = $('#bank-input');
      if (!inBank(inp.value) && toggleBank(inp.value)) inp.value = '';
    };
    $('#bank').addEventListener('click', (e) => {
      const l = current(); if (!l) return;
      const x = e.target.closest('[data-x]');
      if (x) { l.bank.splice(+x.dataset.x, 1); persist(); renderNotes(); return; }
      const ins = e.target.closest('[data-ins]');
      if (ins) { insertAtCursor(l.bank[+ins.dataset.ins]); toast('Inserted', 'plus'); return; }
      const it = e.target.closest('.bank-item'); if (!it) return;
      const w = l.bank[+it.dataset.i];
      const last = (w.match(WORD_RE) || []).pop();
      if (last) { setPane('rhymes'); st.pinned = true; $('#rh-search').value = last; setRhymeWord(last, w, 'From word bank', true); }
    });
    $('#notes').addEventListener('input', (e) => {
      const l = current(); if (!l) return;
      l.notes = e.target.value; l.updated = now();
      persist();
    });
  }

  // ================= Recording takes =================
  const rec = { on: false, mr: null, stream: null, chunks: [], t0: 0, timer: null, analyser: null, raf: 0 };
  const takeAudio = new Audio();
  const tp = { id: null, withBeat: false, raf: 0 };

  // ================= Microphone =================
  // The mic runs through a boost and a limiter before it is recorded, so a quiet mic can be turned up without the
  // loud parts clipping. The same chain feeds the level meters.
  const mic = { stream: null, key: '', gain: null, limiter: null, analyser: null, dest: null, monitoring: false, raf: 0, peakHold: 0, recent: [], stopT: 0 };
  const dbToGain = (db) => Math.pow(10, db / 20);
  const micKey = () => { const m = S(); return [m.micId, m.micAgc, m.micNoise, m.micEcho, m.micLimiter].join('|'); };

  async function openMic() {
    if (mic.stream && mic.key === micKey()) return mic;
    closeMic();
    const m = S();
    const audioOpts = { echoCancellation: !!m.micEcho, noiseSuppression: !!m.micNoise, autoGainControl: !!m.micAgc };
    if (m.micId) audioOpts.deviceId = { exact: m.micId };
    try {
      mic.stream = await navigator.mediaDevices.getUserMedia({ audio: audioOpts });
    } catch (err) {
      if (m.micId) { m.micId = ''; persist(); return openMic(); } // that mic is gone: use the default one
      throw err;
    }
    mic.key = micKey();
    const c = LMAudio.ctx();
    const src = c.createMediaStreamSource(mic.stream);
    mic.gain = c.createGain();
    mic.gain.gain.value = dbToGain(m.micBoost || 0);
    mic.limiter = c.createDynamicsCompressor();
    mic.limiter.threshold.value = -2; mic.limiter.knee.value = 0; mic.limiter.ratio.value = 20;
    mic.limiter.attack.value = 0.002; mic.limiter.release.value = 0.12;
    mic.analyser = c.createAnalyser();
    mic.analyser.fftSize = 1024;
    mic.dest = c.createMediaStreamDestination();
    src.connect(mic.gain);
    if (m.micLimiter !== false) mic.gain.connect(mic.limiter).connect(mic.analyser); else mic.gain.connect(mic.analyser);
    mic.analyser.connect(mic.dest);
    refreshMicName();
    micMeterLoop();
    return mic;
  }
  function closeMic() {
    if (!mic.stream) return;
    mic.stream.getTracks().forEach((t) => t.stop());
    mic.stream = null;
    mic.monitoring = false;
    cancelAnimationFrame(mic.raf);
    clearTimeout(mic.stopT);
    $$('.lvl').forEach((el) => { el.style.setProperty('--lvl', '0%'); el.style.setProperty('--peak', '0%'); el.classList.remove('hot'); });
    $$('.mic-check').forEach((b) => b.classList.remove('on'));
    setMicHint('');
  }
  function setMicBoost(db) {
    S().micBoost = db;
    if (mic.gain) mic.gain.gain.setTargetAtTime(dbToGain(db), LMAudio.ctx().currentTime, 0.02);
    $$('.boost-range').forEach((r) => { if (+r.value !== db) r.value = db; setRangeFill(r); });
    $$('.boost-val').forEach((v) => (v.textContent = `+${db} dB`));
    persist();
  }
  // Checking the level opens the mic for a minute, or until you check again.
  async function toggleMicCheck() {
    if (mic.monitoring) { mic.monitoring = false; if (!rec.on) closeMic(); return; }
    try { await openMic(); } catch { return toast('No microphone available', 'x'); }
    mic.monitoring = true;
    mic.recent = [];
    $$('.mic-check').forEach((b) => b.classList.add('on'));
    clearTimeout(mic.stopT);
    mic.stopT = setTimeout(() => { if (mic.monitoring && !rec.on) closeMic(); }, 60000);
  }
  function setMicHint(text, kind = '') {
    $$('.mic-hint').forEach((el) => { el.textContent = text; el.dataset.kind = kind; });
  }
  async function refreshMicName() {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    const track = mic.stream?.getAudioTracks()[0];
    const name = track?.label || devs.find((d) => d.deviceId === S().micId)?.label || 'Default microphone';
    $$('.mic-name').forEach((el) => (el.textContent = name.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '')));
    return devs;
  }
  function micMeterLoop() {
    cancelAnimationFrame(mic.raf);
    const data = new Float32Array(mic.analyser.fftSize);
    const loop = () => {
      if (!mic.stream) return;
      mic.analyser.getFloatTimeDomainData(data);
      let peak = 0, sum = 0;
      for (const v of data) { const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
      const rms = Math.sqrt(sum / data.length);
      const db = (x) => (x > 0 ? 20 * Math.log10(x) : -100);
      const pct = (d) => Math.max(0, Math.min(100, ((d + 60) / 60) * 100));
      mic.peakHold = Math.max(db(peak), mic.peakHold - 0.6);
      $$('.lvl').forEach((el) => {
        el.style.setProperty('--lvl', pct(db(rms) + 6) + '%');
        el.style.setProperty('--peak', pct(mic.peakHold) + '%');
        el.classList.toggle('hot', peak > 0.98);
      });
      // judge the level over the last few seconds of actual sound
      const t = performance.now();
      mic.recent.push([t, db(peak)]);
      while (mic.recent.length && t - mic.recent[0][0] > 3000) mic.recent.shift();
      const loud = Math.max(...mic.recent.map((r) => r[1]));
      if (loud < -50) setMicHint('Say something to check the level.');
      else if (loud > -0.5) setMicHint('Clipping. Turn the boost down a little.', 'bad');
      else if (loud < -30) setMicHint('Very quiet. Turn the boost up.', 'warn');
      else if (loud < -18) setMicHint('A bit quiet. Try some more boost.', 'warn');
      else setMicHint('Good level.', 'good');
      if (rec.on) drawRecMeter(Math.min(1, rms * 3.2));
      mic.raf = requestAnimationFrame(loop);
    };
    loop();
  }
  const recHist = new Array(26).fill(0);
  function drawRecMeter(lvl) {
    const cv = $('#rec-meter');
    const g = cv.getContext('2d');
    const color = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim();
    recHist.push(lvl); recHist.shift();
    g.clearRect(0, 0, cv.width, cv.height);
    const w = cv.width / recHist.length;
    recHist.forEach((v, i) => {
      const h = Math.max(3, v * cv.height);
      g.fillStyle = v > 0.92 ? '#ff4d4d' : color;
      g.globalAlpha = 0.25 + (i / recHist.length) * 0.75;
      g.fillRect(i * w + 1.5, (cv.height - h) / 2, w - 3, h);
    });
    g.globalAlpha = 1;
  }

  function toggleRecord() { rec.on || rec.counting ? stopRecording() : startRecording(); }
  async function startRecording() {
    const l = current();
    if (!l) return toast('Open a lyric first', 'x');
    stopTake();
    if (lib.ui.rightHidden) togglePanel('right');
    setPane('takes');
    try { await openMic(); } catch { return toast('No microphone available', 'x'); }
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    rec.mr = new MediaRecorder(mic.dest.stream, { mimeType: mime, audioBitsPerSecond: 192000 });
    rec.chunks = [];
    rec.mr.ondataavailable = (e) => e.data.size && rec.chunks.push(e.data);
    rec.mr.onstop = finishRecording;
    rec.lyricId = l.id;
    rec.beatId = null; rec.beatOffset = null; rec.startedBeat = false;
    const b = player.beat;
    const withBeat = $('#rec-with-beat').checked && b;

    // one bar of clicks first, at the beat's tempo
    if (S().countIn) {
      rec.counting = true;
      $('#rec-box').classList.add('count');
      const bpm = (b?.kind === 'file' && b.bpm) || S().metroBpm || 90;
      const counter = new LMAudio.Metronome();
      counter.setBpm(bpm);
      counter.beats = 4;
      counter.volume = Math.max(0.3, metro.volume);
      counter.onTick = (beat) => { $('#rec-time').textContent = String(4 - beat); };
      counter.start();
      await new Promise((r) => { rec.countT = setTimeout(r, (4 * 60000) / bpm - 30); });
      counter.stop();
      $('#rec-box').classList.remove('count');
      if (!rec.counting) return; // stopped during the count-in
      rec.counting = false;
    }

    if (withBeat) {
      if (b.kind === 'file') {
        if (audio.ended || (audio.duration && audio.currentTime >= audio.duration - 0.5)) audio.currentTime = 0;
        rec.beatId = b.id;
        if (audio.paused) { await audio.play().catch(() => {}); rec.startedBeat = true; }
      } else if (!player.embed) { startEmbed(); rec.startedBeat = true; }
    }
    rec.mr.start(250);
    if (rec.beatId) rec.beatOffset = audio.currentTime;
    rec.on = true;
    rec.t0 = performance.now();
    $('#rec-box').classList.add('on');
    $('#rec-sub').textContent = rec.beatId ? `Recording over “${b.name}”` : 'Recording…';
    $('#side-switch [data-pane="takes"]').classList.add('rec');
    rec.timer = setInterval(() => { $('#rec-time').textContent = fmtTime((performance.now() - rec.t0) / 1000); }, 200);
  }
  function stopRecording() {
    if (rec.counting) {
      rec.counting = false;
      clearTimeout(rec.countT);
      $('#rec-box').classList.remove('count');
      $('#rec-time').textContent = '0:00';
      if (!mic.monitoring) closeMic();
      return;
    }
    if (!rec.on) return;
    rec.on = false;
    rec.duration = (performance.now() - rec.t0) / 1000;
    clearInterval(rec.timer);
    rec.mr.stop();
    if (!mic.monitoring) closeMic();
    if (rec.startedBeat) {
      if (player.beat?.kind === 'file') audio.pause();
      else { stopEmbed(); setPlaying(false); }
    }
    $('#rec-box').classList.remove('on');
    $('#side-switch [data-pane="takes"]').classList.remove('rec');
    $('#rec-sub').textContent = 'Saving…';
    const cv = $('#rec-meter');
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    recHist.fill(0);
  }
  async function finishRecording() {
    const blob = new Blob(rec.chunks, { type: 'audio/webm' });
    const file = await api.saveTake(await blob.arrayBuffer());
    $('#rec-sub').textContent = 'Record a take over your beat';
    $('#rec-time').textContent = '0:00';
    const l = lyric(rec.lyricId);
    if (!l) return;
    l.takes = l.takes || [];
    const n = l.takes.reduce((m, t) => Math.max(m, +((t.name.match(/^Take (\d+)$/) || [])[1] || 0)), 0) + 1;
    l.takes.unshift({ id: uid(), name: `Take ${n}`, file, duration: rec.duration, created: now(), beatId: rec.beatId, beatOffset: rec.beatOffset });
    persist();
    renderTakes();
    toast(`Take ${n} saved`, 'mic');
  }

  function renderTakes() {
    const l = current();
    const list = $('#takes-list');
    if (!l) { list.innerHTML = '<div class="bank-empty">Open a lyric to record takes.</div>'; return; }
    const takes = l.takes || [];
    list._html = takes.length ? takes.map((t) => {
      const b = t.beatId && beat(t.beatId);
      const playing = tp.id === t.id;
      return `<div class="take ${playing ? 'playing' : ''}" data-id="${t.id}" data-key="${t.id}">
        <div class="take-top">
          <button class="t-play" data-t="play" title="${b ? 'Play with the beat' : 'Play'}">${icon(playing ? 'pause' : 'play', 13)}</button>
          <div class="take-info"><div class="take-name">${esc(t.name)}</div>
            <div class="take-meta">${fmtTime(t.duration)} · ${rel(t.created)}${b ? ' · over ' + esc(b.name) : ''}</div></div>
          <button class="icon-btn" data-t="menu" title="More">${icon('more', 15)}</button>
        </div><div class="take-bar"><i></i></div></div>`;
    }).join('') : `<div class="rh-empty" style="padding:30px 10px">${logo(44, 'pulse')}No takes yet. Hit record and spit your verse.</div>`;
    renderKeyed(list, list._html);
  }
  async function playTake(t) {
    if (tp.id === t.id) return stopTake();
    stopTake();
    const b = t.beatId && beat(t.beatId);
    takeAudio.src = await api.mediaUrl('take', t.file);
    tp.id = t.id;
    tp.dur = t.duration;
    tp.withBeat = !!(b && b.kind === 'file');
    if (tp.withBeat) {
      if (player.beat?.id !== b.id) await loadBeat(b, false);
      await new Promise((r) => (audio.readyState >= 1 ? r() : audio.addEventListener('loadedmetadata', r, { once: true })));
      audio.currentTime = t.beatOffset || 0;
      tp.loopWas = audio.loop;
      audio.loop = true;
      await Promise.all([takeAudio.play(), audio.play()]).catch(() => {});
    } else await takeAudio.play().catch(() => toast('Could not play this take', 'x'));
    renderTakes();
    const step = () => {
      if (!tp.id) return;
      const bar = $(`.take[data-id="${tp.id}"] .take-bar i`);
      const d = isFinite(takeAudio.duration) ? takeAudio.duration : tp.dur;
      if (bar && d) bar.style.width = Math.min(100, (takeAudio.currentTime / d) * 100) + '%';
      tp.raf = requestAnimationFrame(step);
    };
    step();
  }
  function stopTake() {
    if (!tp.id) return;
    takeAudio.pause();
    if (tp.withBeat) { audio.pause(); audio.loop = tp.loopWas ?? S().loop; }
    tp.id = null;
    cancelAnimationFrame(tp.raf);
    renderTakes();
  }
  takeAudio.addEventListener('ended', stopTake);

  function takeMenu(t, x, y) {
    const b = t.beatId && beat(t.beatId);
    showCtx(x, y, [
      { label: 'Rename', icon: 'edit', run: async () => { const n = await promptModal('Rename take', t.name); if (n) { t.name = n; persist(); renderTakes(); } } },
      { label: 'Export vocal (WAV)', icon: 'download', run: () => exportTake(t, false) },
      ...(b && b.kind === 'file' ? [{ label: 'Export with beat (WAV)', icon: 'music', run: () => exportTake(t, true) }] : []),
      '-',
      { label: 'Delete take', icon: 'trash', danger: true, run: async () => {
        if (!(await confirmModal(`Delete “${t.name}”?`, 'The recording will be removed for good.'))) return;
        if (tp.id === t.id) stopTake();
        api.deleteTake(t.file);
        const l = current();
        l.takes = l.takes.filter((x2) => x2.id !== t.id);
        persist(); renderTakes();
      } },
    ]);
  }
  async function exportTake(t, withBeat) {
    toast(withBeat ? 'Mixing with the beat…' : 'Rendering…', 'wave');
    try {
      const vocal = await LMAudio.decode(await api.readMedia('take', t.file));
      let out = vocal;
      if (withBeat) {
        const beatBuf = await LMAudio.decode(await api.readMedia('beat', beat(t.beatId).file));
        out = await LMAudio.mix(vocal, beatBuf, t.beatOffset || 0);
      }
      const name = `${current()?.title || 'Lyric'} - ${t.name}${withBeat ? ' (mix)' : ''}`;
      if (await api.saveBuffer({ name, data: LMAudio.encodeWav(out), ext: 'wav', label: 'WAV audio' })) toast('Exported', 'download');
    } catch { toast('Export failed', 'x'); }
  }
  function bindTakes() {
    $('#rec-btn').onclick = toggleRecord;
    $('#rec-countin').checked = !!S().countIn;
    $('#rec-countin').onchange = (e) => { S().countIn = e.target.checked; persist(); };
    $('#takes-boost').value = S().micBoost || 0;
    setMicBoost(S().micBoost || 0);
    $('#takes-boost').oninput = (e) => setMicBoost(+e.target.value);
    $('#mic-check').onclick = toggleMicCheck;
    $('#mic-settings').onclick = () => { setView('settings'); setTimeout(() => $('#set-recording')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); };
    refreshMicName().catch(() => {});
    const list = $('#takes-list');
    const find = (el) => current()?.takes?.find((x) => x.id === el.closest('.take')?.dataset.id);
    list.addEventListener('click', (e) => {
      const t = find(e.target); if (!t) return;
      const a = e.target.closest('[data-t]');
      if (a?.dataset.t === 'play') playTake(t);
      if (a?.dataset.t === 'menu') { const r = a.getBoundingClientRect(); takeMenu(t, r.right - 200, r.bottom + 4); }
    });
    list.addEventListener('contextmenu', (e) => { const t = find(e.target); if (t) { e.preventDefault(); takeMenu(t, e.clientX, e.clientY); } });
  }

  // ================= Version history =================
  const SNAP_EVERY = 5 * 60 * 1000;
  function snapshot(l, label = 'Auto-save', named = false) {
    if (!l) return;
    l.history = l.history || [];
    const last = l.history[0];
    if (!named && last && last.body === l.body && last.title === l.title) return;
    l.history.unshift({ id: uid(), t: now(), title: l.title, body: l.body, label, named });
    let auto = 0;
    l.history = l.history.filter((h) => h.named || ++auto <= 40);
    persist();
    if (st.pane === 'history') renderHistory();
  }
  function autoSnapshot(l) {
    const last = l.history?.[0];
    if (!last || now() - last.t > SNAP_EVERY) snapshot(l);
  }
  function lineDiff(a, b) {
    const A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length;
    if (n * m > 600000) return null;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { ops.push({ t: '=', s: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: '-', s: A[i++] });
      else ops.push({ t: '+', s: B[j++] });
    }
    while (i < n) ops.push({ t: '-', s: A[i++] });
    while (j < m) ops.push({ t: '+', s: B[j++] });
    return ops;
  }
  function renderHistory() {
    const l = current();
    const el = $('#history-list');
    if (!l) { el.innerHTML = '<div class="bank-empty">Open a lyric to see its versions.</div>'; return; }
    const hs = l.history || [];
    el._html = hs.length ? hs.map((h, i) => {
      const same = h.body === l.body;
      const d = same ? null : lineDiff(h.body, l.body);
      const add = d ? d.filter((o) => o.t === '+').length : 0, del = d ? d.filter((o) => o.t === '-').length : 0;
      const when = new Date(h.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<div class="hist" data-id="${h.id}" data-key="${h.id}">${icon(h.named ? 'starFill' : 'history', 15)}
        <div class="h-info"><div class="h-name">${esc(h.label || 'Auto-save')}</div>
        <div class="h-meta">${when}${same ? ' · same as now' : d ? ` · <span class="plus">+${add}</span> <span class="minus">−${del}</span> since` : ''}</div></div></div>`;
    }).join('') : '<div class="bank-empty">No versions yet. They appear as you write.</div>';
    renderKeyed(el, el._html);
  }
  async function openVersion(h) {
    const l = current();
    const ops = lineDiff(l.body, h.body);
    const html = ops
      ? ops.map((o) => (o.t === '=' ? esc(o.s) + '\n' : `<span class="${o.t === '+' ? 'add' : 'del'}">${esc(o.s) || ' '}</span>`)).join('')
      : esc(h.body);
    const r = await modal(`<h3>${esc(h.label || 'Auto-save')}</h3>
      <p>${new Date(h.t).toLocaleString()} · If you restore, green lines come back and red lines go.</p>
      <div class="hist-preview">${html}</div>
      <div class="m-acts"><button class="btn ghost danger" data-del>${icon('trash', 14)}Delete</button><span style="flex:1"></span>
      <button class="btn ghost" data-x>Close</button><button class="btn primary" data-ok>${icon('restore', 14)}Restore</button></div>`, (m, close) => {
      m.classList.add('wide');
      $('[data-ok]', m).onclick = () => close('restore');
      $('[data-x]', m).onclick = () => close(null);
      $('[data-del]', m).onclick = () => close('delete');
    });
    if (r === 'restore') restoreVersion(h);
    if (r === 'delete') { l.history = l.history.filter((x) => x.id !== h.id); persist(); renderHistory(); }
  }
  function restoreVersion(h) {
    const l = current();
    snapshot(l, 'Before restore');
    pad.focus();
    pad.select();
    if (h.body) document.execCommand('insertText', false, h.body);
    else document.execCommand('delete');
    if (h.title && h.title !== l.title) { l.title = h.title; titleInput.value = h.title; renderCrumbs(); renderTree(); }
    renderHistory();
    toast('Version restored · Ctrl+Z to undo', 'restore');
  }
  function bindHistory() {
    $('#snap-btn').onclick = async () => {
      const l = current(); if (!l) return;
      const name = await promptModal('Save version', `Version ${new Date().toLocaleDateString()}`, 'e.g. Before rewriting the hook');
      if (name) { snapshot(l, name, true); toast('Version saved', 'star'); }
    };
    $('#history-list').addEventListener('click', (e) => {
      const row = e.target.closest('.hist'); if (!row) return;
      const h = current()?.history?.find((x) => x.id === row.dataset.id);
      if (h) openVersion(h);
    });
  }

  // ================= Metronome =================
  // With a beat file loaded the click locks to the beat's grid and plays while the beat plays. Without one it runs
  // on its own.
  const metro = new LMAudio.Metronome();
  const metroTaps = [];
  const fmtBpm = (v) => String(Math.round(v * 100) / 100);
  const syncBeat = () => (player.beat?.kind === 'file' && player.beat.bpm ? player.beat : null);
  function metroSync() {
    if (pf.on) return; // perform mode runs its own click
    if (!st.metroOn) {
      metro.stop();
      $$('#mt-beats i').forEach((i) => i.classList.remove('on', 'down'));
    } else {
      const b = syncBeat();
      if (b) { metro.setBpm(b.bpm); metro.follow(() => (audio.paused ? null : audio.currentTime), b.offset || 0); }
      else { metro.setBpm(S().metroBpm || 90); metro.start(); }
    }
    $('#metro-btn').classList.toggle('on', !!st.metroOn);
    if ($('#metro-menu').classList.contains('open')) renderMetroMenu();
  }
  function metroToggle(force) {
    st.metroOn = force ?? !st.metroOn;
    metroSync();
  }
  // A new tempo moves the beat's grid along with it.
  function setBeatBpm(b, v) {
    if (!v) { b.bpm = null; b.grid = 0; persist(); return; }
    b.bpm = Math.max(40, Math.min(240, Math.round(v * 100) / 100));
    b.bpmAuto = false;
    if (wave.buf && player.beat?.id === b.id) b.offset = LMAudio.analyzeBeat(wave.buf, b.bpm)?.offset ?? b.offset;
    persist();
    updateBpmLabel();
    renderMeta();
    if (player.beat?.id === b.id) $('#pl-kind').textContent = `${KIND_LABEL[b.kind]} · ${fmtBpm(b.bpm)} BPM`;
    if (st.view === 'beats') renderBeats();
    metroSync();
  }
  function setMetroBpm(v) {
    const b = syncBeat();
    if (b) return setBeatBpm(b, v);
    S().metroBpm = Math.max(30, Math.min(300, Math.round(v) || 90));
    persist();
    metroSync();
  }
  function nudgeGrid(seconds) {
    const b = syncBeat();
    if (!b) return;
    const bar = (60 / b.bpm) * metro.beats;
    b.offset = Math.round(((((b.offset || 0) + seconds) % bar) + bar) % bar * 1000) / 1000;
    persist();
    metroSync();
  }
  function renderMetroMenu() {
    const b = syncBeat();
    const bpm = b ? b.bpm : S().metroBpm || 90;
    $('#metro-menu').innerHTML = `
      <div class="m-row"><span class="m-title">Metronome</span><span class="m-head-acts"><label class="toggle"><input type="checkbox" id="mt-on" ${st.metroOn ? 'checked' : ''}/><span></span></label>
        <button class="icon-btn xs" data-mt="close" title="Close">${icon('x', 14)}</button></span></div>
      ${b ? `<div class="mt-sync">${icon('link', 13)}<span>Locked to <b>${esc(b.name)}</b>. It clicks along while the beat plays.</span></div>` : ''}
      <div class="metro-bpm"><button class="icon-btn" data-mt="-" title="Slower (Shift: ${b ? '0.1' : '5'})">${icon('minus', 16)}</button>
        <input id="mt-bpm" type="number" min="30" max="300" step="${b ? 0.01 : 1}" value="${fmtBpm(bpm)}"/>
        <button class="icon-btn" data-mt="+" title="Faster (Shift: ${b ? '0.1' : '5'})">${icon('plus', 16)}</button></div>
      ${b ? `<div class="mt-row-btns"><button class="btn ghost sm" data-mt="half">Half tempo</button><button class="btn ghost sm" data-mt="double">Double tempo</button></div>` : ''}
      <div class="metro-beats" id="mt-beats">${'<i></i>'.repeat(metro.beats)}</div>
      <div class="m-row"><span>Beats per bar</span><div class="seg" id="mt-sig">${[3, 4, 6].map((n) => `<button data-n="${n}" class="${metro.beats === n ? 'active' : ''}">${n}</button>`).join('')}</div></div>
      ${b ? `<div class="m-row"><span>Line up</span><span class="mt-nudge">
          <button class="btn ghost sm" data-mt="early" title="Clicks 10 ms earlier">-10 ms</button>
          <button class="btn ghost sm" data-mt="late" title="Clicks 10 ms later">+10 ms</button></span></div>
        <div class="m-row"><span>Beat 1</span><span class="mt-nudge">
          <button class="btn ghost sm" data-mt="prevbeat" title="Accent one beat earlier">${icon('chevronLeft', 13)}</button>
          <button class="btn ghost sm" data-mt="nextbeat" title="Accent one beat later">${icon('chevron', 13)}</button>
          <button class="btn ghost sm" data-mt="detect" title="Find the tempo and the grid again">Re-detect</button></span></div>` : ''}
      <div class="m-row"><span>Volume</span><input type="range" id="mt-vol" min="0" max="100" value="${Math.round(metro.volume * 100)}"/></div>
      ${b ? '' : '<div class="m-row"><button class="btn sm" data-mt="tap">Tap tempo</button></div>'}`;
    setRangeFill($('#mt-vol'));
    requestAnimationFrame(() => inkSegs($('#metro-menu')));
  }
  function bindMetronome() {
    st.metroOn = false;
    metro.setBpm(S().metroBpm || 90);
    metro.volume = (S().metroVol ?? 50) / 100;
    metro.beats = S().metroBeats || 4;
    metro.onTick = (b) => {
      const d = $('.metro-dot');
      d.classList.remove('tick', 'down'); void d.offsetWidth;
      d.classList.add('tick'); if (b === 0) d.classList.add('down');
      $$('#mt-beats i').forEach((el, i) => { el.classList.toggle('on', i === b); el.classList.toggle('down', i === 0 && b === 0); });
    };
    $('#metro-btn').onclick = () => {
      const m = $('#metro-menu');
      if (!m.classList.contains('open')) renderMetroMenu();
      m.classList.toggle('open');
    };
    const m = $('#metro-menu');
    m.addEventListener('change', (e) => {
      if (e.target.id === 'mt-on') metroToggle(e.target.checked);
      if (e.target.id === 'mt-bpm') setMetroBpm(+e.target.value);
    });
    m.addEventListener('input', (e) => {
      if (e.target.id === 'mt-vol') { metro.volume = e.target.value / 100; S().metroVol = +e.target.value; setRangeFill(e.target); persist(); }
    });
    m.addEventListener('keydown', (e) => { if (e.target.id === 'mt-bpm' && e.key === 'Enter') setMetroBpm(+e.target.value); });
    m.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mt]');
      const sig = e.target.closest('#mt-sig button');
      if (sig) {
        metro.beats = +sig.dataset.n; S().metroBeats = metro.beats; persist();
        metroSync();
        renderMetroMenu();
        return;
      }
      if (!btn) return;
      const a = btn.dataset.mt;
      const b = syncBeat();
      const bpm = b ? b.bpm : S().metroBpm || 90;
      if (a === 'close') return m.classList.remove('open');
      if (a === '+' || a === '-') setMetroBpm(bpm + (a === '+' ? 1 : -1) * (e.shiftKey ? (b ? 0.1 : 5) : 1));
      if (a === 'half' && b) setBeatBpm(b, b.bpm / 2);
      if (a === 'double' && b) setBeatBpm(b, b.bpm * 2);
      if (a === 'early') nudgeGrid(-0.01);
      if (a === 'late') nudgeGrid(0.01);
      if (a === 'prevbeat' && b) nudgeGrid(-60 / b.bpm);
      if (a === 'nextbeat' && b) nudgeGrid(60 / b.bpm);
      if (a === 'detect' && b) {
        if (!wave.buf) return toast('The beat is still loading', 'metronome');
        const g = LMAudio.analyzeBeat(wave.buf);
        if (g) { b.bpm = g.bpm; b.offset = g.offset; b.bpmAuto = true; b.grid = 2; persist(); updateBpmLabel(); renderMeta(); metroSync(); toast(`${fmtBpm(g.bpm)} BPM`, 'metronome'); }
      }
      if (a === 'tap') {
        const t = performance.now();
        if (metroTaps.length && t - metroTaps[metroTaps.length - 1] > 2000) metroTaps.length = 0;
        metroTaps.push(t);
        if (metroTaps.length > 6) metroTaps.shift();
        if (metroTaps.length >= 3) setMetroBpm(60000 / ((metroTaps[metroTaps.length - 1] - metroTaps[0]) / (metroTaps.length - 1)));
        btn.classList.remove('hit'); void btn.offsetWidth; btn.classList.add('hit');
      }
    });
  }

  // ================= Perform mode =================
  const pf = { on: false, paused: true, t0: 0, pausedAt: 0, raf: 0, manual: 0, lastBar: -99, lastCount: null, loops: 0, lastAudioT: 0 };
  function openPerform() {
    const l = current();
    if (!l) return toast('Open a lyric first', 'x');
    stopTake();
    if (rec.on) stopRecording();
    pf.hadMetro = !!st.metroOn;
    metro.stop();
    const b = player.beat;
    pf.useAudio = !!(b && b.kind === 'file');
    pf.offset = pf.useAudio ? b.offset || 0 : 0;
    $('#pf-bpm').value = (l.beatId && beat(l.beatId)?.bpm) || b?.bpm || metro.bpm || 90;
    $('#pf-intro').value = l.perfIntro ?? (pf.useAudio ? 0 : 1);
    $('#pf-click').checked = pf.useAudio ? false : S().pfClick ?? true;
    $('#pf-title').textContent = (l.title || 'Untitled') + (pf.useAudio ? ` · ${b.name}` : ' · metronome');
    let html = '', n = 0;
    for (const line of l.body.split('\n')) {
      if (SECTION_RE.test(line)) { html += `<div class="pf-sec">${esc(line.replace(/[[\]]/g, '').trim())}</div>`; continue; }
      if (!line.trim()) continue;
      html += `<div class="pf-line" data-b="${n}"><span class="bn">${n + 1}</span>${esc(line)}</div>`;
      n++;
    }
    pf.count = n;
    $('#pf-lines').innerHTML = html || '<div class="pf-line cur">No bars yet. Write something first.</div>';
    pf.lineEls = $$('#pf-lines .pf-line[data-b]');
    $('#perform').hidden = false;
    pf.on = true;
    pfReset();
    cancelAnimationFrame(pf.raf);
    const loop = () => { if (!pf.on) return; pfRender(); pf.raf = requestAnimationFrame(loop); };
    loop();
  }
  function closePerform() {
    if (!pf.on) return;
    pfPause();
    pf.on = false;
    cancelAnimationFrame(pf.raf);
    const ov = $('#perform');
    ov.classList.add('out');
    setTimeout(() => { ov.hidden = true; ov.classList.remove('out'); }, 200);
    const l = current();
    if (l) { l.perfIntro = +$('#pf-intro').value || 0; persist(); }
    metroSync();
  }
  function pfTime() {
    if (pf.useAudio) {
      const t = audio.currentTime;
      if (t < pf.lastAudioT - 1 && audio.duration) pf.loops++;
      pf.lastAudioT = t;
      return t + pf.loops * (audio.duration || 0);
    }
    return pf.paused ? pf.pausedAt : LMAudio.ctx().currentTime - pf.t0;
  }
  const pfBpm = () => Math.max(40, Math.min(240, +$('#pf-bpm').value || 90));
  function pfStartClick() {
    if (!$('#pf-click').checked || pf.paused) return metro.stop();
    if (pf.useAudio) {
      metro.setBpm(pfBpm());
      metro.beats = 4;
      return metro.follow(() => (audio.paused ? null : audio.currentTime), pf.offset);
    }
    const c = LMAudio.ctx();
    const spb = 60 / pfBpm();
    metro.setBpm(pfBpm());
    metro.beats = 4;
    const t = pfTime();
    const next = Math.ceil(t / spb - 1e-3) * spb;
    metro.start(c.currentTime + (next - t), Math.round(next / spb));
  }
  function pfPlay() {
    if (pf.useAudio) audio.play();
    else pf.t0 = LMAudio.ctx().currentTime - pf.pausedAt;
    pf.paused = false;
    pfStartClick();
    $('#pf-play').innerHTML = icon('pause', 16);
  }
  function pfPause() {
    if (pf.useAudio) audio.pause();
    else if (!pf.paused) pf.pausedAt = pfTime();
    pf.paused = true;
    metro.stop();
    metro.beats = S().metroBeats || 4;
    $('#pf-play').innerHTML = icon('play', 16);
  }
  function pfReset() {
    const wasPlaying = !pf.paused && pf.on;
    pfPause();
    if (pf.useAudio) { audio.currentTime = 0; pf.loops = 0; pf.lastAudioT = 0; }
    pf.pausedAt = 0; pf.manual = 0; pf.lastBar = -99;
    pfRender(true);
    if (wasPlaying) pfPlay();
  }
  function pfRender(force) {
    const spb = 60 / pfBpm(), barDur = spb * 4;
    const intro = +$('#pf-intro').value || 0;
    const t = Math.max(0, pfTime());
    const g = t - pf.offset; // time on the beat's grid
    const beatIn = ((Math.floor(g / spb + 1e-6) % 4) + 4) % 4;
    const barF = g / barDur - intro;
    const bar = Math.floor(barF) + pf.manual;
    $$('#pf-beats i').forEach((el, i) => el.classList.toggle('on', !pf.paused && i === beatIn));
    $('#pf-prog').style.width = (t === 0 ? 0 : (((barF % 1) + 1) % 1) * 100) + '%';
    const count = !pf.paused && barF < 0 && barF >= -1 && pf.manual === 0 ? 4 - beatIn : null;
    if (count !== pf.lastCount) {
      pf.lastCount = count;
      $('.pf-count')?.remove();
      if (count) $('#pf-stage').insertAdjacentHTML('beforeend', `<div class="pf-count"><span>${count}</span></div>`);
    }
    const cur = Math.max(-1, Math.min(bar, pf.count));
    if (cur !== pf.lastBar || force) {
      pf.lastBar = cur;
      pf.lineEls.forEach((el, i) => {
        el.classList.toggle('cur', i === cur);
        el.classList.toggle('past', i < cur);
        el.classList.toggle('next', i === cur + 1);
      });
      const target = pf.lineEls[Math.max(0, Math.min(cur, pf.count - 1))];
      if (target) $('#pf-lines').style.transform = `translateY(${-(target.offsetTop + target.offsetHeight / 2)}px)`;
    }
    if (!pf.paused && bar > pf.count + 1) pfPause();
  }
  function bindPerform() {
    $('#perform-btn').onclick = openPerform;
    $('#pf-close').onclick = closePerform;
    $('#pf-play').onclick = () => (pf.paused ? pfPlay() : pfPause());
    $('#pf-restart').onclick = pfReset;
    $('#pf-click').onchange = (e) => { if (!pf.useAudio) { S().pfClick = e.target.checked; persist(); } pfStartClick(); };
    $('#pf-bpm').onchange = () => { pf.lastBar = -99; pfStartClick(); };
    $('#pf-intro').onchange = () => { pf.lastBar = -99; };
  }
  function performKeys(e) {
    if (!pf.on) return false;
    if (e.key === 'Escape') { closePerform(); return true; }
    if (e.target.tagName === 'INPUT' && e.key !== ' ') return false;
    if (e.key === ' ') { e.preventDefault(); pf.paused ? pfPlay() : pfPause(); return true; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); pf.manual += e.key === 'ArrowDown' ? 1 : -1; pfRender(true); return true; }
    return true;
  }

  // ================= Waveform & A-B loop =================
  const wave = { peaks: null, ab: null, half: null, raf: 0, selecting: false };
  async function prepareWave(b) {
    wave.peaks = b.peaks || null;
    wave.buf = null;
    wave.ab = null; wave.half = null;
    updateAbBtn();
    drawWave();
    try {
      const buf = await LMAudio.decode(await api.readMedia('beat', b.file));
      if (player.beat?.id !== b.id) return;
      wave.buf = buf;
      let changed = false;
      if (!b.peaks) { b.peaks = LMAudio.peaks(buf, 480); b.duration = buf.duration; changed = true; }
      if (b.grid !== 2) {
        // a tempo you typed, tapped or that came with the file name stays; only its grid is found
        const manual = !!b.bpm && !b.bpmAuto;
        const g = LMAudio.analyzeBeat(buf, manual ? b.bpm : null);
        if (g) {
          if (!manual) { b.bpm = g.bpm; b.bpmAuto = true; toast(`Detected ${fmtBpm(g.bpm)} BPM`, 'metronome'); }
          b.offset = g.offset;
          b.grid = 2;
          changed = true;
        }
      }
      if (changed) {
        persist();
        updateBpmLabel();
        renderMeta();
        $('#pl-kind').textContent = `${KIND_LABEL[b.kind]}${b.bpm ? ` · ${fmtBpm(b.bpm)} BPM` : ''}`;
        if (st.view === 'beats') renderBeats();
        metroSync();
      }
      wave.peaks = b.peaks;
      drawWave();
    } catch {}
  }
  function drawWave() {
    const cv = $('#pl-wave');
    if (!cv || player.beat?.kind !== 'file') return;
    const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const cs = getComputedStyle(document.documentElement);
    const acc = cs.getPropertyValue('--accent').trim(), dim = cs.getPropertyValue('--line2').trim(), fg = cs.getPropertyValue('--fg').trim();
    const dur = audio.duration || player.beat.duration || 0;
    const p = dur ? audio.currentTime / dur : 0;
    if (dur && (wave.ab || wave.half != null)) {
      g.fillStyle = acc;
      if (wave.ab) {
        const x1 = (wave.ab[0] / dur) * W, x2 = (wave.ab[1] / dur) * W;
        g.globalAlpha = 0.16; g.fillRect(x1, 0, x2 - x1, H);
        g.globalAlpha = 1; g.fillRect(x1, 0, 1.5, H); g.fillRect(x2 - 1.5, 0, 1.5, H);
      } else { g.globalAlpha = 1; g.fillRect((wave.half / dur) * W, 0, 1.5, H); }
      g.globalAlpha = 1;
    }
    const bw = 2, gap = 1.2, n = Math.floor(W / (bw + gap));
    const pk = wave.peaks;
    for (let i = 0; i < n; i++) {
      let v = 0.1;
      if (pk) {
        const a = Math.floor((i / n) * pk.length), b2 = Math.max(a + 1, Math.floor(((i + 1) / n) * pk.length));
        v = 0; for (let j = a; j < b2; j++) v = Math.max(v, pk[j]);
      }
      const h = Math.max(2, v * (H - 4));
      g.fillStyle = i / n < p ? acc : dim;
      g.fillRect(i * (bw + gap), (H - h) / 2, bw, h);
    }
    g.fillStyle = fg;
    g.fillRect(Math.max(0, p * W - 1), 1, 2, H - 2);
  }
  function waveLoop() {
    cancelAnimationFrame(wave.raf);
    const step = () => {
      if (wave.ab && audio.currentTime >= wave.ab[1]) audio.currentTime = wave.ab[0];
      drawWave();
      if (player.playing && player.beat?.kind === 'file') wave.raf = requestAnimationFrame(step);
    };
    step();
  }
  function updateAbBtn() {
    const b = $('#pl-ab');
    b.classList.toggle('on', !!wave.ab);
    b.classList.toggle('half', wave.half != null);
  }
  function bindWave() {
    const cv = $('#pl-wave');
    const tAt = (e) => { const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (audio.duration || 0); };
    cv.addEventListener('mousedown', (e) => {
      if (!audio.duration) return;
      const t0 = tAt(e);
      wave.selecting = e.shiftKey;
      if (wave.selecting) wave.ab = [t0, t0]; else audio.currentTime = t0;
      drawWave();
      const move = (ev) => {
        const t = tAt(ev);
        if (wave.selecting) wave.ab = [Math.min(t0, t), Math.max(t0, t)]; else audio.currentTime = t;
        $('#pl-cur').textContent = fmtTime(audio.currentTime);
        drawWave();
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        if (wave.selecting) {
          wave.selecting = false;
          if (wave.ab[1] - wave.ab[0] < 0.25) wave.ab = null;
          else { audio.currentTime = wave.ab[0]; toast(`Looping ${fmtTime(wave.ab[0])} to ${fmtTime(wave.ab[1])}`, 'repeat'); }
          updateAbBtn(); drawWave();
        }
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    new ResizeObserver(() => drawWave()).observe(cv);
    $('#pl-ab').onclick = () => {
      if (!audio.duration) return;
      if (wave.ab) { wave.ab = null; toast('A-B loop off', 'repeat'); }
      else if (wave.half == null) wave.half = audio.currentTime;
      else {
        const a = wave.half, b = audio.currentTime;
        wave.half = null;
        if (Math.abs(b - a) >= 0.25) {
          wave.ab = [Math.min(a, b), Math.max(a, b)];
          audio.currentTime = wave.ab[0];
          toast(`Looping ${fmtTime(wave.ab[0])} to ${fmtTime(wave.ab[1])}`, 'repeat');
        }
      }
      updateAbBtn(); drawWave();
    };
  }

  // ================= Export & custom words =================
  async function exportPdf(l = current()) {
    if (!l) return;
    const proj = project(l.projectId)?.name || '';
    const body = l.body.split('\n').map((line) => (SECTION_RE.test(line)
      ? `<h3>${esc(line.replace(/[[\]]/g, '').trim())}</h3>`
      : line.trim() ? `<p>${esc(line)}</p>` : '<div class="gap"></div>')).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:"Segoe UI",system-ui,sans-serif;color:#111;margin:0;padding:6px}
      h1{font-size:30px;letter-spacing:-.03em;margin:0 0 4px}
      .meta{color:#999;font-size:10.5px;margin-bottom:28px;letter-spacing:.06em;text-transform:uppercase}
      h3{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#999;margin:24px 0 6px}
      p{margin:0;font-size:13.5px;line-height:1.8}.gap{height:10px}
      .foot{margin-top:44px;font-size:8.5px;color:#c4c4c4;letter-spacing:.2em}
      </style></head><body><h1>${esc(l.title || 'Untitled')}</h1><div class="meta">${esc(proj)} · ${new Date(l.updated).toLocaleDateString()}</div>${body}<div class="foot">WRITTEN WITH LEMONADE</div></body></html>`;
    if (await api.exportPdf(l.title || 'lyric', html)) toast('PDF exported', 'download');
  }
  function copyLyric(l = current()) {
    if (!l) return;
    navigator.clipboard.writeText((l.title ? l.title + '\n\n' : '') + l.body);
    toast('Copied to clipboard', 'copy');
  }

  async function addWordModal(prefill = {}) {
    const cats = [...new Set([...engine.slang.values()].map((s) => s.cat))].filter((c) => c && c !== 'yours').sort();
    const r = await modal(`<h3>Add your own word</h3><p>It shows up in the word library and in rhyme suggestions.</p>
      <label class="lbl">Word or phrase</label><input class="field" id="aw-word" value="${esc(prefill.word || '')}" spellcheck="false"/>
      <label class="lbl">Meaning</label><textarea class="field" id="aw-def">${esc(prefill.def || '')}</textarea>
      <label class="lbl">Category</label><select id="aw-cat">${['yours', ...cats].map((c) => `<option value="${c}" ${c === (prefill.cat || 'yours') ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <label class="lbl">Rhymes with (optional, fixes the pronunciation, e.g. guap → top)</label><input class="field" id="aw-rhy" value="${esc(prefill.rhymesWith || '')}" spellcheck="false"/>
      <div class="m-acts"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Save word</button></div>`, (m, close) => {
      $('#aw-word', m).focus();
      $('[data-x]', m).onclick = () => close(null);
      $('[data-ok]', m).onclick = () => {
        const word = $('#aw-word', m).value.trim(), def = $('#aw-def', m).value.trim();
        if (!word || !def) return toast('Add a word and its meaning', 'x');
        close({ word, def, cat: $('#aw-cat', m).value, rhymesWith: $('#aw-rhy', m).value.trim() });
      };
    });
    if (!r) return;
    lib.customWords = (lib.customWords || []).filter((w) => w.word.toLowerCase() !== r.word.toLowerCase());
    lib.customWords.push(r);
    engine.addWord(r.word, r.def, r.cat, r.rhymesWith);
    persist();
    renderDictionary();
    toast(`“${r.word}” added to your library`, 'book');
  }
  async function removeCustomWord(key) {
    if (!(await confirmModal(`Remove “${key}”?`, 'It will be removed from your word library.', 'Remove'))) return;
    lib.customWords = (lib.customWords || []).filter((w) => w.word.toLowerCase() !== key);
    engine.removeWord(key);
    persist();
    renderDictionary();
  }

  function bindExtras() {
    $$('#side-switch button').forEach((b) => (b.onclick = () => {
      if (lib.ui.rightHidden) togglePanel('right');
      setPane(b.dataset.pane);
    }));
    $('#toggle-left').onclick = () => togglePanel('left');
    $('#toggle-right').onclick = () => togglePanel('right');
    $('#left-close').onclick = () => togglePanel('left');
    $('#right-close').onclick = () => togglePanel('right');
    $('#edge-left').onclick = () => togglePanel('left');
    $('#edge-right').onclick = () => togglePanel('right');
    $('#embed-wrap').addEventListener('click', (e) => {
      const a = e.target.closest('[data-e]')?.dataset.e;
      if (a === 'min') $('#embed-wrap').classList.add('collapsed');
      if (a === 'close') { stopEmbed(); setPlaying(false); }
    });
    bindEditMenu();
    $('#export-btn').onclick = () => $('#export-menu').classList.toggle('open');
    $('#export-menu').onclick = (e) => {
      const b = e.target.closest('[data-ex]'); if (!b) return;
      $('#export-menu').classList.remove('open');
      ({ txt: exportLyric, pdf: exportPdf, copy: copyLyric })[b.dataset.ex]();
    };
    $('#add-word').onclick = () => addWordModal();
    bindNotes(); bindTakes(); bindHistory(); bindMetronome(); bindPerform(); bindWave(); bindSpelling();
    setPanels();
  }

  // ================= Spelling =================
  // Offline: a word list of about 280,000 words ranked by how often people use them, plus the slang library and
  // your own dictionary. Off only underlines, Suggest also shows fixes on hover, Auto fixes words as you type.
  const spell = { words: null, cache: new Map(), ignore: new Set(), skip: null, flash: null, fixed: null, showT: 0, hideT: 0, raf: 0, pop: null };
  let dictSet = new Set();
  const spellReady = () => !!spell.words && engine.ready;
  const ALPHA = "abcdefghijklmnopqrstuvwxyz'";

  async function loadSpelling() {
    const text = await api.loadSpellWords();
    const words = new Map();
    for (const line of text.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab < 0) words.set(line, 0); else words.set(line.slice(0, tab), +line.slice(tab + 1));
    }
    spell.words = words;
    spell.cache.clear();
    scheduleBackdrop();
  }

  function knownWord(w) {
    const k = (x) => spell.words.has(x) || engine.slang.has(x) || engine.words.has(x) || dictSet.has(x) || spell.ignore.has(x);
    if (k(w)) return true;
    const bare = w.replace(/^'+|'+$/g, '');
    if (bare !== w && k(bare)) return true;
    if (/in'?$/.test(w)) { const stem = w.replace(/in'?$/, ''); if (k(stem + 'ing') || k(stem + 'in')) return true; } // trappin, trappin'
    if (/'s$/.test(w) && k(w.slice(0, -2))) return true;
    if (/s'$/.test(w) && k(w.slice(0, -1))) return true;
    return false;
  }
  function isMisspelled(word, firstInLine) {
    if (word.length < 2 || /\d/.test(word)) return false;
    if (/^[A-Z][a-z']/.test(word) && !firstInLine) return false; // a name or a place
    if (word.length <= 5 && word === word.toUpperCase()) return false; // ATL, VVS
    const w = word.toLowerCase().replace(/’/g, "'");
    if (spell.cache.has(w)) return spell.cache.get(w);
    const bad = !knownWord(w);
    spell.cache.set(w, bad);
    return bad;
  }

  function edits1(w) {
    const out = new Set();
    for (let i = 0; i <= w.length; i++) {
      const a = w.slice(0, i), b = w.slice(i);
      if (b) out.add(a + b.slice(1));
      if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));
      for (const c of ALPHA) { if (b) out.add(a + c + b.slice(1)); out.add(a + c + b); }
    }
    out.delete(w);
    return out;
  }
  const matchCase = (orig, w) => (orig.length > 1 && orig === orig.toUpperCase() ? w.toUpperCase()
    : /^[A-Z]/.test(orig) ? w[0].toUpperCase() + w.slice(1) : w);
  function suggest(word, limit = 6) {
    const w = word.toLowerCase().replace(/’/g, "'");
    const known = (x) => spell.words.has(x) || engine.slang.has(x) || dictSet.has(x);
    const score = (x) => (engine.slang.has(x) ? 50 : 0) + (spell.words.get(x) || engine.freq(x) || 0);
    const first = edits1(w);
    const fits = (x) => x.length >= Math.min(3, w.length); // "teh" shouldn't suggest "th"
    const cands = [...first].filter((x) => known(x) && fits(x)).map((x) => [x, 1]);
    if (cands.length < 3 && w.length <= 12) {
      const seen = new Set(cands.map((c) => c[0]));
      for (const e1 of first) for (const e2 of edits1(e1)) {
        if (e2 !== w && !seen.has(e2) && fits(e2) && known(e2)) { seen.add(e2); cands.push([e2, 2]); }
      }
    }
    cands.sort((a, b) => a[1] - b[1] || score(b[0]) - score(a[0]));
    return cands.slice(0, limit).map(([x, dist]) => ({ word: matchCase(word, x), dist, freq: score(x) }));
  }
  // The fix Auto mode makes: only when one answer clearly wins.
  function bestFix(word) {
    const [a, b] = suggest(word, 3);
    if (!a) return null;
    if (a.dist === 2 && (word.length < 5 || a.freq < 50)) return null;
    if (b && b.dist === a.dist && b.freq * 3 > a.freq) return null;
    return a.word;
  }

  function replaceRange(start, end, text, expect) {
    if (expect != null && pad.value.slice(start, end) !== expect) return false;
    pad.focus();
    pad.setSelectionRange(start, end);
    document.execCommand('insertText', false, text);
    return true;
  }
  function addToDictionary(word) {
    const w = word.toLowerCase();
    if (!lib.dictionary.includes(w)) lib.dictionary.push(w);
    dictSet.add(w);
    spell.cache.delete(w);
    persist();
    scheduleBackdrop();
    toast(`Added “${word}” to your dictionary`, 'book');
  }
  function ignoreWord(word) {
    spell.ignore.add(word.toLowerCase());
    spell.cache.delete(word.toLowerCase());
    scheduleBackdrop();
  }

  // Auto mode: the word before the cursor is fixed when you finish it with space, Enter or punctuation.
  function autoCorrect() {
    const pos = pad.selectionStart;
    if (pos !== pad.selectionEnd) return;
    const before = pad.value.slice(0, pos);
    const m = before.match(/[A-Za-z][A-Za-z']*$/);
    if (!m) return;
    const word = m[0];
    const lineStart = before.lastIndexOf('\n') + 1;
    const lineEnd = pad.value.indexOf('\n', pos);
    if (SECTION_RE.test(pad.value.slice(lineStart, lineEnd < 0 ? undefined : lineEnd))) return;
    const first = !before.slice(lineStart, pos - word.length).trim();
    if (word.length < 3 || spell.ignore.has(word.toLowerCase()) || !isMisspelled(word, first)) return;
    const fix = bestFix(word);
    if (!fix || fix === word) return;
    const start = pos - word.length;
    replaceRange(start, pos, fix);
    spell.fixed = { from: word, to: fix, at: now() };
    spell.flash = { start, until: now() + 900 };
    setTimeout(scheduleBackdrop, 950);
  }

  // Finds the underlined word under the mouse through the backdrop, where misspelled words are marked.
  function spellAt(x, y) {
    const bd = $('#backdrop');
    pad.style.pointerEvents = 'none';
    bd.style.pointerEvents = 'auto';
    const r = document.caretRangeFromPoint(x, y);
    pad.style.pointerEvents = '';
    bd.style.pointerEvents = '';
    const el = r && r.startContainer.parentElement?.closest('mark.sp');
    if (!el) return null;
    const li = +el.dataset.li, at = +el.dataset.at;
    const lines = pad.value.split('\n');
    const m = (lines[li] || '').slice(at).match(/^[A-Za-z0-9][A-Za-z0-9'’]*/);
    if (!m) return null;
    let start = at;
    for (let i = 0; i < li; i++) start += lines[i].length + 1;
    return { word: m[0], start, end: start + m[0].length, el };
  }

  function hideSpellPop() {
    clearTimeout(spell.showT);
    const pop = $('#spell-pop');
    spell.pop = null;
    if (pop.hidden || pop.classList.contains('out')) return;
    pop.classList.add('out');
    setTimeout(() => { if (!spell.pop) { pop.hidden = true; pop.classList.remove('out'); } }, 140);
  }
  function showSpellPop(hit) {
    const pop = $('#spell-pop');
    const sugs = suggest(hit.word, 5);
    spell.pop = hit;
    pop.classList.remove('out');
    pop.innerHTML = `<div class="sp-head">${sugs.length ? 'Did you mean' : `No suggestions for “${esc(hit.word)}”`}</div>
      ${sugs.map((x, i) => `<button class="sp-sug" data-i="${i}">${esc(x.word)}</button>`).join('')}
      <div class="sp-acts"><button data-a="add">${icon('plus', 13)}Add to dictionary</button><button data-a="ignore">${icon('x', 13)}Ignore</button></div>`;
    pop._sugs = sugs;
    pop.hidden = false;
    const r = hit.el.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    pop.style.top = (r.bottom + h + 12 > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
  }
  function bindSpelling() {
    pad.addEventListener('keydown', (e) => {
      if (S().spelling !== 'auto' || e.ctrlKey || e.altKey || e.metaKey || e.isComposing || !spellReady()) return;
      if (e.key === ' ' || e.key === 'Enter' || /^[.,!?;:)]$/.test(e.key)) autoCorrect();
    });
    // Ctrl+Z right after a fix puts your word back, and Lemonade leaves it alone from then on
    pad.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'historyUndo' && spell.fixed && now() - spell.fixed.at < 10000) {
        spell.ignore.add(spell.fixed.from.toLowerCase());
        spell.cache.delete(spell.fixed.from.toLowerCase());
        spell.fixed = null;
      }
    });
    pad.addEventListener('mousemove', (e) => {
      if (S().spelling === 'off' || !spellReady()) return;
      spell.mx = e.clientX; spell.my = e.clientY;
      if (spell.raf) return;
      spell.raf = requestAnimationFrame(() => {
        spell.raf = 0;
        const hit = spellAt(spell.mx, spell.my);
        if (hit && spell.pop && hit.start === spell.pop.start) { clearTimeout(spell.hideT); return; }
        clearTimeout(spell.showT);
        if (!hit) { clearTimeout(spell.hideT); spell.hideT = setTimeout(hideSpellPop, 260); return; }
        spell.showT = setTimeout(() => showSpellPop(hit), 380);
      });
    });
    pad.addEventListener('mouseleave', () => { clearTimeout(spell.showT); spell.hideT = setTimeout(hideSpellPop, 260); });
    pad.addEventListener('keydown', () => hideSpellPop());
    const pop = $('#spell-pop');
    pop.addEventListener('mouseenter', () => clearTimeout(spell.hideT));
    pop.addEventListener('mouseleave', () => { spell.hideT = setTimeout(hideSpellPop, 260); });
    pop.addEventListener('mousedown', (e) => e.preventDefault()); // keep the cursor in the lyric
    pop.addEventListener('click', (e) => {
      const hit = spell.pop;
      if (!hit) return;
      const s = e.target.closest('.sp-sug');
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (s) replaceRange(hit.start, hit.end, pop._sugs[+s.dataset.i].word, hit.word);
      if (a === 'add') addToDictionary(hit.word);
      if (a === 'ignore') ignoreWord(hit.word);
      if (s || a) hideSpellPop();
    });
  }

  // ================= Right-click menu for text =================
  function bindEditMenu() {
    ctx.addEventListener('mousedown', (e) => e.preventDefault()); // keeps the text field focused while a menu item runs
    document.addEventListener('contextmenu', (e) => {
      const t = e.target;
      if (!t.matches || !t.matches('textarea, input:not([type=checkbox]):not([type=range]):not([type=color]):not([type=number])')) return;
      e.preventDefault();
      hideSpellPop();
      const items = [];
      if (t === pad && spellReady()) {
        const hit = spellAt(e.clientX, e.clientY);
        if (hit) {
          const sugs = suggest(hit.word, 5);
          items.push({ head: sugs.length ? 'Did you mean' : `“${hit.word}” isn't in the dictionary` });
          for (const x of sugs) items.push({ label: x.word, icon: 'check', strong: true, run: () => replaceRange(hit.start, hit.end, x.word, hit.word) });
          items.push({ label: 'Add to dictionary', icon: 'plus', run: () => addToDictionary(hit.word) });
          items.push({ label: 'Ignore', icon: 'x', run: () => ignoreWord(hit.word) });
          items.push('-');
        }
      }
      const sel = t.selectionStart !== t.selectionEnd;
      items.push({ label: 'Cut', icon: 'cut', kbd: 'Ctrl+X', disabled: !sel, run: () => api.edit('cut') });
      items.push({ label: 'Copy', icon: 'copy', kbd: 'Ctrl+C', disabled: !sel, run: () => api.edit('copy') });
      items.push({ label: 'Paste', icon: 'paste', kbd: 'Ctrl+V', run: () => api.edit('paste') });
      items.push('-');
      items.push({ label: 'Select all', icon: 'selectAll', kbd: 'Ctrl+A', run: () => { t.focus(); t.select(); } });
      showCtx(e.clientX, e.clientY, items);
    });
  }

  // ================= Text files in and out =================
  const cleanName = (s) => (s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
  const lyricText = (l) => (l.title ? l.title + '\n\n' : '') + l.body;

  // Each text file becomes a lyric named after the file. A title line that repeats the file name is dropped.
  function importTextFiles(files, projectId, folderId) {
    if (!files.length) return [];
    if (!projectId || !project(projectId) || project(projectId).archived) {
      const cur = current();
      projectId = cur && lyricVisible(cur) ? cur.projectId : lib.projects.find((p) => !p.archived)?.id;
      folderId = cur && lyricVisible(cur) ? cur.folderId : null;
    }
    if (!projectId) {
      const p = { id: uid(), name: 'My Songs', created: now(), updated: now(), archived: false };
      lib.projects.push(p);
      projectId = p.id;
    }
    const made = files.map(({ name, text }) => {
      const title = name.replace(/\.[^.]+$/, '').trim() || 'Untitled';
      let lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
      if (lines[0]?.trim() === title) lines = lines.slice(lines[1]?.trim() === '' ? 2 : 1);
      const l = { id: uid(), projectId, folderId: folderId || null, title, body: lines.join('\n').replace(/\s+$/, '') + '\n', beatId: null,
        created: now(), updated: now(), archived: false, bank: [], takes: [], history: [], notes: '' };
      lib.lyrics.push(l);
      return l;
    });
    toggleOpen(projectId, true);
    if (folderId) toggleOpen(folderId, true);
    persist();
    if (st.view !== 'write') setView('write');
    renderTree();
    openLyric(made[0].id);
    toast(made.length === 1 ? `Imported “${made[0].title}”` : `Imported ${made.length} lyrics`, 'file');
    return made;
  }
  async function importTextDialog(projectId, folderId) {
    const files = await api.importText();
    if (files.length) importTextFiles(files, projectId, folderId);
  }
  // Saves a project or folder as one text file per lyric into a folder you pick.
  async function exportGroup(type, item) {
    const ls = lib.lyrics.filter((l) => !l.archived && (type === 'project' ? l.projectId === item.id : l.folderId === item.id));
    if (!ls.length) return toast('Nothing to save yet', 'x');
    const used = new Set();
    const files = ls.map((l) => {
      const dir = type === 'project' && l.folderId && folder(l.folderId) ? cleanName(folder(l.folderId).name) + '/' : '';
      let name = cleanName(l.title), n = 2;
      while (used.has((dir + name).toLowerCase())) name = `${cleanName(l.title)} (${n++})`;
      used.add((dir + name).toLowerCase());
      return { path: `${dir}${name}.txt`, text: lyricText(l) };
    });
    const r = await api.exportFolder(cleanName(item.name), files);
    if (r) toast(`Saved ${files.length} lyric${files.length === 1 ? '' : 's'} to ${r}`, 'download');
  }

  // ================= Updates =================
  function updateRows() {
    const u = st.update || {};
    let status, ctl = '';
    switch (u.state) {
      case 'checking': status = 'Looking for a new version…'; break;
      case 'latest': status = 'You have the latest version.'; break;
      case 'available':
        status = `Lemonade ${u.available} is out.` + (u.canInstall ? '' : " This copy doesn't update itself, so get the setup from GitHub.");
        ctl = `<button class="btn sm" data-act="release">${icon('external', 14)}Release page</button>`;
        break;
      case 'downloading': status = `Downloading Lemonade ${u.available}… ${Math.round((u.progress || 0) * 100)}%`; break;
      case 'ready':
        status = `Lemonade ${u.available} is ready. It installs when you close Lemonade.`;
        ctl = `<button class="btn primary sm" data-act="restart">${icon('restore', 14)}Restart and update</button>`;
        break;
      case 'error': status = u.error || "The update didn't work."; break;
      default: status = u.canInstall ? 'Lemonade looks for new versions on GitHub every few hours.' : 'This copy runs from a build folder, so it never updates itself.';
    }
    if (!['checking', 'downloading', 'ready'].includes(u.state)) ctl += `<button class="btn sm" data-act="check">Check now</button>`;
    const on = S().checkUpdates;
    return `<div class="set-row"><div class="sr-text"><div class="sr-title">Check for updates automatically</div>
        <div class="sr-desc">Asks GitHub whether a new version exists. Nothing about you or your lyrics is sent.</div></div>
        <div class="sr-ctl"><label class="toggle"><input type="checkbox" data-tog="checkUpdates" ${on ? 'checked' : ''}/><span></span></label></div></div>
      <div class="set-row"><div class="sr-text"><div class="sr-title">Lemonade ${esc(u.current || '')}</div><div class="sr-desc">${esc(status)}</div></div>
        <div class="sr-ctl">${ctl}</div></div>`;
  }
  function renderUpdateUi() {
    const rows = $('#update-rows');
    if (rows) rows.innerHTML = updateRows();
    const pill = $('#update-pill');
    const ready = st.update?.state === 'ready';
    pill.hidden = !ready;
    if (ready) pill.title = `Lemonade ${st.update.available} is ready. Click to restart and update.`;
  }
  async function installUpdate() {
    if (rec.on) return toast('Stop recording first', 'mic');
    if (pf.on) closePerform();
    dirty = true;
    await flush();
    api.installUpdate();
  }
  async function bindUpdates(info) {
    st.update = await api.updateStatus();
    api.updateConfig({ enabled: S().checkUpdates });
    api.onUpdate((u) => {
      const was = st.update?.state;
      st.update = u;
      renderUpdateUi();
      if (u.state === 'ready' && was !== 'ready') toast(`Lemonade ${u.available} is ready. Restart to update.`, 'download');
    });
    $('#update-pill').onclick = installUpdate;
    renderUpdateUi();
    if (info.justUpdated) setTimeout(() => toast(`Updated to Lemonade ${info.version}`, 'check'), 2200);
  }

  // ================= Keyboard =================
  // Escape closes one thing at a time, the one on top first.
  function closeTopmost() {
    if (ctx.classList.contains('open')) return hideCtx();
    const menu = $('.menu.open');
    if (menu) return menu.classList.remove('open');
    if (!$('#spell-pop').hidden) return hideSpellPop();
    if (!$('#def-card').hidden) return hideDef();
    if (st.view === 'dictionary' && $('.lookup-card')) return closeLookup();
    const emb = $('#embed-wrap');
    if (player.embed && !emb.classList.contains('collapsed')) return emb.classList.add('collapsed');
    if (document.body.classList.contains('focus')) return toggleFocus(false);
  }

  function toggleFocus(force) {
    const on = force ?? !document.body.classList.contains('focus');
    crossfade(() => document.body.classList.toggle('focus', on));
    $('#focus-btn').classList.toggle('on', on);
    requestAnimationFrame(() => { syncBackdropSize(); renderBackdrop(); });
    if (on) { setView('write'); pad.focus(); toast('Focus mode · Esc to exit', 'focus'); }
  }
  document.addEventListener('keydown', (e) => {
    if (performKeys(e)) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && !e.shiftKey && k === 'n') { e.preventDefault(); newLyric(); }
    else if (e.ctrlKey && k === 's') { e.preventDefault(); dirty = true; flush().then(() => toast('Saved')); }
    else if (e.ctrlKey && !e.shiftKey && k === 'f') { e.preventDefault(); setView('write'); $('#lib-search').focus(); }
    else if (e.ctrlKey && k === 'k') { e.preventDefault(); setView('write'); $('#rh-search').focus(); $('#rh-search').select(); }
    else if (e.ctrlKey && k === 'e') { e.preventDefault(); exportLyric(); }
    else if (e.ctrlKey && e.shiftKey && k === 'f') { e.preventDefault(); toggleFocus(); }
    else if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.ctrlKey && ['1', '2', '3', '4'].includes(k)) { e.preventDefault(); setView(['write', 'beats', 'dictionary', 'archive'][+k - 1]); }
    else if (e.ctrlKey && k === ',') { e.preventDefault(); setView('settings'); }
    else if (e.ctrlKey && k === 'm') { e.preventDefault(); metroToggle(); toast(st.metroOn ? `Metronome on · ${fmtBpm(metro.bpm)} BPM${syncBeat() ? ', locked to the beat' : ''}` : 'Metronome off', 'metronome'); }
    else if (e.ctrlKey && k === 'p') { e.preventDefault(); openPerform(); }
    else if (e.ctrlKey && k === 'r') { e.preventDefault(); toggleRecord(); }
    else if (e.ctrlKey && k === 'b') { e.preventDefault(); togglePanel('left'); }
    else if (e.ctrlKey && k === 'j') { e.preventDefault(); togglePanel('right'); }
    else if (k === 'escape') closeTopmost();
  });

  // ================= Boot =================
  function normalize(data) {
    const d = { version: 1, projects: [], folders: [], lyrics: [], beats: [], ui: {}, ...data };
    d.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    d.ui = { open: [], openId: null, ...(data.ui || {}) };
    d.customWords = d.customWords || [];
    d.dictionary = d.dictionary || [];
    dictSet = new Set(d.dictionary);
    d.lyrics.forEach((l) => { l.bank = l.bank || []; l.takes = l.takes || []; l.history = l.history || []; l.notes = l.notes || ''; });
    return d;
  }

  function bindChrome() {
    fillIcons();
    $$('.rail-btn').forEach((b) => { b.innerHTML = icon(b.dataset.view, 20); b.onclick = () => setView(b.dataset.view); });
    $('#tb-brand').innerHTML = logo(20, 'hoverable') + '<span>Lemonade</span>';
    $('#empty-logo').innerHTML = logo(84, 'hoverable');
    $('#new-lyric').onclick = () => newLyric();
    $('#empty-new').onclick = () => newLyric();
    $('#new-project').onclick = newProject;
    $('#lib-search').addEventListener('input', (e) => { st.search = e.target.value; renderTree(); });
    $('#lib-search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; st.search = ''; renderTree(); } });
    const sort = $('#sort-select');
    sort.value = S().sort;
    sort.onchange = () => { S().sort = sort.value; persist(); renderTree(); };
    renderSectionMenu();
    $('#insert-section').onclick = () => $('#section-menu').classList.toggle('open');
    $('#section-menu').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) { $('#section-menu').classList.remove('open'); insertSection(b.dataset.s); } };
    $('#attach-beat').onclick = attachBeat;
    $('#focus-btn').onclick = () => toggleFocus();
    window.addEventListener('resize', () => { moveInk(); placeIndicator(); });
  }

  async function boot() {
    const t0 = performance.now();
    lib = normalize((await api.loadLibrary()) || defaultLibrary());
    applySettings();

    const showSplash = S().splash;
    if (showSplash) {
      $('#splash-logo').innerHTML = logo(96, 'intro');
      $('#splash-word').innerHTML = [...'lemonade'].map((c, i) => `<span style="--i:${i}">${c}</span>`).join('');
    } else $('#splash').remove();

    bindChrome(); bindTree(); bindRhymes(); bindBeats(); bindPlayer(); bindDictionary(); bindArchive(); bindSettings(); bindExtras();
    renderTree();
    renderRhymes();
    setStatus('saved');

    const lexP = api.loadLexicon();
    if (showSplash) await new Promise((r) => setTimeout(r, 1200));
    const text = await lexP;
    engine.load(text, window.SLANG_RAW);
    for (const w of lib.customWords) engine.addWord(w.word, w.def, w.cat, w.rhymesWith);
    loadSpelling();
    api.appInfo().then(bindUpdates);

    const last = S().reopenLast && lib.ui.openId && lyric(lib.ui.openId);
    if (last && lyricVisible(last)) openLyric(last.id);
    else closeEditor();
    setView('write');
    if (!last) renderRhymes();

    const wait = showSplash ? Math.max(0, 1900 - (performance.now() - t0)) : 0;
    setTimeout(() => {
      document.body.classList.remove('booting');
      $('#splash')?.classList.add('out');
      setTimeout(() => $('#splash')?.remove(), 600);
      setView('write');
      if (current()) pad.focus();
    }, wait);
  }

  boot();
})();
