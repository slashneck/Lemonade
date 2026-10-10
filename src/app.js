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
    splash: true, spellcheck: true, reopenLast: true, sort: 'updated', volume: 80, loop: true,
    metroBpm: 90, metroVol: 50, metroBeats: 4, checkUpdates: true,
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

  function toast(msg, ic = 'check') {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = icon(ic, 16) + `<span>${esc(msg)}</span>`;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2400);
  }

  // ================= Modals & menus =================
  function modal(html, onMount) {
    return new Promise((resolve) => {
      const root = $('#modal');
      root.innerHTML = `<div class="modal">${html}</div>`;
      root.classList.add('open');
      fillIcons(root);
      const close = (v) => { root.classList.remove('open'); root.innerHTML = ''; document.removeEventListener('keydown', key, true); resolve(v); };
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
    ctx.innerHTML = items.map((it, i) => (it === '-' ? '<hr/>' :
      `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon || 'chevron', 15)}<span>${esc(it.label)}</span>${it.kbd ? `<span class="kbd">${it.kbd}</span>` : ''}</button>`)).join('');
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
    $('#pad').spellcheck = s.spellcheck;
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
    let n = 0;
    const row = (type, item, depth, extra = '') => {
      const isOpen = openSet().has(item.id);
      const name = type === 'lyric' ? item.title || 'Untitled' : item.name;
      const ic = type === 'project' ? 'project' : type === 'folder' ? 'folder' : 'file';
      const count = type === 'lyric' ? '' : lib.lyrics.filter((l) => lyricVisible(l) && (type === 'project' ? l.projectId === item.id : l.folderId === item.id)).length;
      return `<div class="t-row ${type} ${isOpen ? 'open' : ''} ${item.id === st.openId ? 'active' : ''}" data-type="${type}" data-id="${item.id}"
        draggable="${type !== 'project'}" style="--d:${depth};--n:${n++}">
        ${type === 'lyric' ? '<span style="width:14px"></span>' : `<span class="chev">${icon('chevron', 14)}</span>`}
        <span class="t-ic">${icon(ic, 15)}</span><span class="t-name">${esc(name)}</span>${extra}
        ${type !== 'lyric' ? `<span class="t-count">${count || ''}</span>` : ''}
        <span class="t-acts">${type !== 'lyric' ? `<button class="icon-btn" data-act="add" title="New lyric here">${icon('plus', 14)}</button>` : ''}
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
      tree.innerHTML = html;
      return;
    }

    const open = openSet();
    let html = '';
    const projects = S().sort === 'name' ? sortBy(lib.projects, 'name') : [...lib.projects].sort((a, b) => a.created - b.created);
    for (const p of projects.filter((x) => !x.archived)) {
      html += row('project', p, 0);
      if (!open.has(p.id)) continue;
      html += '<div class="t-kids">';
      const folders = sortBy(lib.folders.filter((f) => f.projectId === p.id && !f.archived), 'name');
      for (const f of folders) {
        html += row('folder', f, 1);
        if (!open.has(f.id)) continue;
        const ls = sortBy(lib.lyrics.filter((l) => l.folderId === f.id && !l.archived), S().sort, 'title');
        html += ls.map((l) => row('lyric', l, 2)).join('') || '<div class="t-empty" style="--d:1">Empty folder</div>';
      }
      const loose = sortBy(lib.lyrics.filter((l) => l.projectId === p.id && !l.folderId && !l.archived), S().sort, 'title');
      html += loose.map((l) => row('lyric', l, 1)).join('');
      if (!folders.length && !loose.length) html += '<div class="t-empty">No lyrics yet</div>';
      html += '</div>';
    }
    if (!html) html = '<div class="t-empty" style="padding:20px 8px">No projects. Create one with the folder button above.</div>';
    tree.innerHTML = html;
  }

  function treeItem(el) {
    const r = el.closest('.t-row');
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
      if (act === 'menu') {
        e.stopPropagation();
        const r = e.target.closest('[data-act]').getBoundingClientRect();
        return itemMenu(t, r.left, r.bottom + 4);
      }
      if (t.type === 'lyric') openLyric(t.id);
      else { toggleOpen(t.id); renderTree(); }
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
    }
    if (t.type === 'folder') items.push({ label: 'New lyric', icon: 'plus', run: () => newLyric(t.item.projectId, t.id) });
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
    clearTimeout(rhymeTimer);
    rhymeTimer = setTimeout(() => updateRhymeTarget(), 140);
  };
  pad.addEventListener('keyup', (e) => { if (/Arrow|Home|End|Page/.test(e.key)) caretMoved(); });
  pad.addEventListener('mouseup', caretMoved);
  pad.addEventListener('blur', () => { st.lastSel = [pad.selectionStart, pad.selectionEnd]; });
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
    const curLine = lineIndexAt(pad.selectionStart);
    const html = res.map((r, i) => {
      let body = '';
      if (r.sec || s.rhymeHighlight === 'off') body = esc(r.line);
      else {
        let last = 0;
        for (const m of r.words) {
          let c = null;
          if (wordColor) { const k = engine.isStop(m[0]) ? null : engine.endKey(m[0]); if (k && wordColor.has(k)) c = wordColor.get(k); }
          else if (r.end && m.index === r.end.index && r.color !== undefined) c = r.color;
          if (c === null || c === undefined) continue;
          body += esc(r.line.slice(last, m.index)) + `<mark class="rc${c}">${esc(m[0])}</mark>`;
          last = m.index + m[0].length;
        }
        body += esc(r.line.slice(last));
      }
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
    $('#def-card').hidden = true;
    renderRhymeHead(true);
    renderRhymes();
    if (S().online) fetchWebRhymes(w);
  }

  async function fetchWebRhymes(w) {
    let data = webCache.get(w);
    if (!data) {
      try {
        const q = (rel) => fetch(`https://api.datamuse.com/words?${rel}=${encodeURIComponent(w)}&md=s&max=120`).then((r) => r.json());
        const [perf, near, similar] = await Promise.all([q('rel_rhy'), q('rel_nry'), q('ml')]);
        data = { perfect: perf, near, similar };
        webCache.set(w, data);
      } catch { return; }
    }
    if (st.rhWord !== w || !st.rh) return;
    for (const k of ['perfect', 'near']) {
      const have = new Set([...st.rh.perfect, ...st.rh.near, ...st.rh.multi].map((x) => x[0]));
      st.rh['web_' + k] = data[k].filter((x) => !have.has(x.word) && x.word !== w && /^[a-z' -]+$/.test(x.word)).slice(0, 60).map((x) => [x.word, x.numSyllables || 1]);
    }
    st.rh.similar = (data.similar || []).filter((x) => x.word !== w && /^[a-z' -]+$/.test(x.word)).slice(0, 80).map((x) => [x.word, x.numSyllables || 1]);
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
      perfect: r.perfect.length + (r.web_perfect?.length || 0), near: r.near.length + (r.web_near?.length || 0),
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
    return `<div class="chips">${list.map(([w], i) => {
      const sl = engine.slang.has(w);
      return `<button class="chip ${sl ? 'slang' : ''} ${cls} ${st.chip === w ? 'sel' : ''}" data-w="${esc(w)}" style="--n:${Math.min(i, 40)}" title="${sl ? esc(engine.slang.get(w).def) : ''}">${esc(w)}</button>`;
    }).join('')}</div>`;
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
      for (const [syl, items] of bySyllables(list)) html += `<div class="rh-group"><h4>${syl}${syl === 5 ? '+' : ''} syllable${syl === 1 ? '' : 's'}</h4>${chips(items)}</div>`;
      const web = r['web_' + tab];
      if (web?.length) html += `<div class="rh-group"><h4>${icon('globe', 12)} From the web · phrases & more</h4>${chips(web, 'web')}</div>`;
      else if (S().online && (tab === 'perfect' || tab === 'near') && !webCache.has(r.word)) html += `<div class="rh-group"><h4>From the web</h4><span class="loading-dots"><i></i><i></i><i></i></span></div>`;
    }
    if (!html) html = empty(tab === 'multi' ? 'No multisyllable matches. Try a longer line ending.' : `No ${tab} rhymes for “${esc(r.word)}”. Check the other tabs.`);
    body.innerHTML = html;
    body.classList.toggle('settled', settled);
    if (settled) $$('.chip:not(.web)', body).forEach((c) => (c.style.animation = 'none'));
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

  async function showDef(word) {
    const card = $('#def-card');
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
      if (a === 'close') $('#def-card').hidden = true;
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
    list.innerHTML = lib.beats.map((b, i) => {
      const uses = lib.lyrics.filter((l) => l.beatId === b.id).length;
      const playing = player.beat?.id === b.id && player.playing;
      return `<div class="beat ${playing ? 'playing' : ''}" data-id="${b.id}" style="--n:${i}">
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
      b.bpm = +e.target.value || null;
      persist(); renderMeta(); updateBpmLabel();
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
    $('#pl-kind').textContent = KIND_LABEL[b.kind] + (b.bpm ? ` · ${b.bpm} BPM` : '');
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
  }

  function startEmbed() {
    const b = player.beat;
    const wrap = $('#embed-wrap');
    let src;
    if (b.kind === 'youtube') src = `https://www.youtube-nocookie.com/embed/${b.vid}?autoplay=1&loop=1&playlist=${b.vid}&rel=0&modestbranding=1`;
    else src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(b.url)}&auto_play=true&visual=false&show_comments=false&color=${encodeURIComponent((S().accent === 'mono' ? '#ffffff' : S().accent).replace('#', ''))}`;
    wrap.className = 'embed-wrap' + (b.kind === 'soundcloud' ? ' sc' : '');
    wrap.innerHTML = `<iframe src="${src}" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
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
  }
  function updateBpmLabel() { $('#pl-bpm').textContent = player.beat?.bpm ? player.beat.bpm : ''; }
  function setRangeFill(el) { el.style.setProperty('--p', (el.value / el.max) * 100 + '%'); }

  function bindPlayer() {
    $('#pl-disc').innerHTML = logo(40, 'disc');
    audio.addEventListener('play', () => setPlaying(true));
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
        if (player.beat && player.taps.length >= 4) {
          player.beat.bpm = bpm; player.beat.bpmAuto = false; persist(); renderMeta();
          $('#pl-kind').textContent = KIND_LABEL[player.beat.kind] + ` · ${bpm} BPM`;
        }
      }
    };
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
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
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
    $('#dict-grid').innerHTML = items.map(([k, s], i) => `<div class="d-card" data-w="${esc(k)}" style="--n:${i}">
      <div class="w"><span>${esc(s.word)}</span><span class="acts">${s.custom ? `<button class="del" data-del="${esc(k)}" title="Remove your word">${icon('trash', 13)}</button>` : ''}<span class="slang-tag">${esc(s.custom && s.cat === 'yours' ? 'yours' : s.cat)}</span></span></div><div class="d">${esc(s.def)}</div></div>`).join('')
      || (q ? '' : '<div class="muted">Nothing here.</div>');
  }
  async function lookup(word) {
    word = RhymeEngine.clean(word);
    const box = $('#dict-lookup');
    if (!word) { box.innerHTML = ''; return; }
    const ph = engine.phones(word);
    const syl = engine.syllables(word);
    const r = engine.find(word);
    box.innerHTML = `<div class="lookup-card"><div style="display:flex;align-items:center;gap:10px"><h3>${esc(word)}</h3>${engine.slang.has(word) ? '<span class="slang-tag">slang</span>' : ''}</div>
      <div class="lc-meta">${syl} syllable${syl === 1 ? '' : 's'}${ph ? ' · ' + esc(ph.join(' ').replace(/\d/g, '').toLowerCase()) : ''}${engine.has(word) ? '' : ' · not in dictionary, pronunciation guessed'}</div>
      <ol class="lc-defs"><li style="list-style:none;margin-left:-18px"><span class="loading-dots"><i></i><i></i><i></i></span></li></ol>
      <div class="rh-group"><h4>Top rhymes</h4>${chips([...r.slang.slice(0, 8), ...r.perfect.slice(0, 24)].filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i))}</div>
      <button class="btn primary sm" data-lookup-rhyme="${esc(word)}">${icon('write', 14)}Open in rhyme panel</button>
      ${engine.slang.has(word) ? '' : `<button class="btn sm" data-add-word="${esc(word)}">${icon('plus', 14)}Add to my library</button>`}</div>`;
    const defs = await getDefs(word);
    if (box.querySelector('h3')?.textContent !== word) return;
    $('.lc-defs', box).innerHTML = defList(defs) || '<li class="muted" style="list-style:none;margin-left:-18px">No definition found' + (S().online ? '' : ' (online dictionary is off in Settings)') + '.</li>';
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
      html += `<div class="arch-group"><h3>${title}</h3>` + items.map((it, i) => `<div class="arch-row" data-type="${type}" data-id="${it.id}" style="--n:${i}">
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
    const section = (title, rows, n) => `<div class="set-section" style="--n:${n}"><h3>${title}</h3><div class="set-card">${rows}</div></div>`;
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
        row('Spellcheck', '', tog('spellcheck')),
      ].join(''), 1)}
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
  }

  function bindSettings() {
    const page = $('#settings-page');
    page.addEventListener('click', async (e) => {
      const segBtn = e.target.closest('.seg button');
      if (segBtn) {
        const key = segBtn.parentElement.dataset.seg;
        let v = segBtn.dataset.v;
        $$('button', segBtn.parentElement).forEach((b) => b.classList.toggle('active', b === segBtn));
        setSetting(key, v);
        return;
      }
      const sw = e.target.closest('[data-accent]');
      if (sw) {
        setSetting('accent', sw.dataset.accent);
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
      if (act === 'check') api.checkForUpdate();
      if (act === 'restart') installUpdate();
      if (act === 'release') api.openExternal(st.update?.pageUrl || 'https://github.com/slashneck/Lemonade/releases');
    });
    page.addEventListener('change', (e) => {
      if (e.target.dataset.tog) setSetting(e.target.dataset.tog, e.target.checked);
      if (e.target.dataset.tog === 'checkUpdates') { api.updateConfig({ enabled: e.target.checked }); renderUpdateUi(); }
      if (e.target.id === 'accent-custom') {
        setSetting('accent', e.target.value);
        $$('.swatch', page).forEach((x) => x.classList.toggle('active', x.classList.contains('custom')));
      }
    });
    page.addEventListener('input', (e) => {
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
    bank.innerHTML = items.length
      ? items.map((w, i) => `<div class="bank-item ${/\s/.test(w.trim()) && w.length > 16 ? 'line' : ''}" data-i="${i}" title="Click for rhymes" style="animation-delay:${Math.min(i, 30) * 15}ms">
          <span>${esc(w)}</span><button data-ins="${i}" title="Insert into lyric">${icon('plus', 12)}</button><button data-x="${i}" title="Remove">${icon('x', 12)}</button></div>`).join('')
      : '<div class="bank-empty">Nothing saved yet.</div>';
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

  function toggleRecord() { rec.on ? stopRecording() : startRecording(); }
  async function startRecording() {
    const l = current();
    if (!l) return toast('Open a lyric first', 'x');
    stopTake();
    if (lib.ui.rightHidden) togglePanel('right');
    setPane('takes');
    try {
      rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch { return toast('No microphone available', 'x'); }
    const c = LMAudio.ctx();
    rec.analyser = c.createAnalyser();
    rec.analyser.fftSize = 1024;
    c.createMediaStreamSource(rec.stream).connect(rec.analyser);
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    rec.mr = new MediaRecorder(rec.stream, { mimeType: mime, audioBitsPerSecond: 192000 });
    rec.chunks = [];
    rec.mr.ondataavailable = (e) => e.data.size && rec.chunks.push(e.data);
    rec.mr.onstop = finishRecording;
    rec.lyricId = l.id;
    rec.beatId = null; rec.beatOffset = null; rec.startedBeat = false;
    const b = player.beat;
    if ($('#rec-with-beat').checked && b) {
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
    drawMeter();
  }
  function stopRecording() {
    if (!rec.on) return;
    rec.on = false;
    rec.duration = (performance.now() - rec.t0) / 1000;
    clearInterval(rec.timer);
    cancelAnimationFrame(rec.raf);
    rec.mr.stop();
    rec.stream.getTracks().forEach((t) => t.stop());
    if (rec.startedBeat) {
      if (player.beat?.kind === 'file') audio.pause();
      else { stopEmbed(); setPlaying(false); }
    }
    $('#rec-box').classList.remove('on');
    $('#side-switch [data-pane="takes"]').classList.remove('rec');
    $('#rec-sub').textContent = 'Saving…';
    const cv = $('#rec-meter');
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
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
  function drawMeter() {
    const cv = $('#rec-meter');
    const g = cv.getContext('2d');
    const data = new Uint8Array(rec.analyser.fftSize);
    const hist = new Array(26).fill(0);
    const color = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim();
    const loop = () => {
      rec.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
      const lvl = Math.min(1, Math.sqrt(sum / data.length) * 3.2);
      hist.push(lvl); hist.shift();
      g.clearRect(0, 0, cv.width, cv.height);
      const w = cv.width / hist.length;
      hist.forEach((v, i) => {
        const h = Math.max(3, v * cv.height);
        g.fillStyle = v > 0.92 ? '#ff4d4d' : color;
        g.globalAlpha = 0.25 + (i / hist.length) * 0.75;
        g.fillRect(i * w + 1.5, (cv.height - h) / 2, w - 3, h);
      });
      g.globalAlpha = 1;
      if (rec.on) rec.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  function renderTakes() {
    const l = current();
    const list = $('#takes-list');
    if (!l) { list.innerHTML = '<div class="bank-empty">Open a lyric to record takes.</div>'; return; }
    const takes = l.takes || [];
    list.innerHTML = takes.length ? takes.map((t, i) => {
      const b = t.beatId && beat(t.beatId);
      const playing = tp.id === t.id;
      return `<div class="take ${playing ? 'playing' : ''}" data-id="${t.id}" style="animation-delay:${Math.min(i, 20) * 30}ms">
        <div class="take-top">
          <button class="t-play" data-t="play" title="${b ? 'Play with the beat' : 'Play'}">${icon(playing ? 'pause' : 'play', 13)}</button>
          <div class="take-info"><div class="take-name">${esc(t.name)}</div>
            <div class="take-meta">${fmtTime(t.duration)} · ${rel(t.created)}${b ? ' · over ' + esc(b.name) : ''}</div></div>
          <button class="icon-btn" data-t="menu" title="More">${icon('more', 15)}</button>
        </div><div class="take-bar"><i></i></div></div>`;
    }).join('') : `<div class="rh-empty" style="padding:30px 10px">${logo(44, 'pulse')}No takes yet. Hit record and spit your verse.</div>`;
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
    el.innerHTML = hs.length ? hs.map((h, i) => {
      const same = h.body === l.body;
      const d = same ? null : lineDiff(h.body, l.body);
      const add = d ? d.filter((o) => o.t === '+').length : 0, del = d ? d.filter((o) => o.t === '-').length : 0;
      const when = new Date(h.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<div class="hist" data-id="${h.id}" style="animation-delay:${Math.min(i, 20) * 25}ms">${icon(h.named ? 'starFill' : 'history', 15)}
        <div class="h-info"><div class="h-name">${esc(h.label || 'Auto-save')}</div>
        <div class="h-meta">${when}${same ? ' · same as now' : d ? ` · <span class="plus">+${add}</span> <span class="minus">−${del}</span> since` : ''}</div></div></div>`;
    }).join('') : '<div class="bank-empty">No versions yet. They appear as you write.</div>';
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
  const metro = new LMAudio.Metronome();
  const metroTaps = [];
  function metroToggle(force) {
    const on = force ?? !metro.running;
    if (on) metro.start(); else metro.stop();
    $('#metro-btn').classList.toggle('on', on);
    const t = $('#mt-on'); if (t) t.checked = on;
    if (!on) $$('#mt-beats i').forEach((i) => i.classList.remove('on', 'down'));
  }
  function setMetroBpm(v) {
    metro.setBpm(Math.round(v) || 90);
    S().metroBpm = metro.bpm;
    const inp = $('#mt-bpm'); if (inp && +inp.value !== metro.bpm) inp.value = metro.bpm;
    persist();
  }
  function beatBpm() { const l = current(); return (l?.beatId && beat(l.beatId)?.bpm) || player.beat?.bpm || null; }
  function renderMetroMenu() {
    if (!metro.running && beatBpm()) metro.setBpm(beatBpm());
    const bb = beatBpm();
    $('#metro-menu').innerHTML = `
      <div class="m-row"><span class="m-title">Metronome</span><label class="toggle"><input type="checkbox" id="mt-on" ${metro.running ? 'checked' : ''}/><span></span></label></div>
      <div class="metro-bpm"><button class="icon-btn" data-mt="-" title="Slower (Shift: -5)">${icon('minus', 16)}</button>
        <input id="mt-bpm" type="number" min="30" max="300" value="${metro.bpm}"/>
        <button class="icon-btn" data-mt="+" title="Faster (Shift: +5)">${icon('plus', 16)}</button></div>
      <div class="metro-beats" id="mt-beats">${'<i></i>'.repeat(metro.beats)}</div>
      <div class="m-row"><span>Beats per bar</span><div class="seg" id="mt-sig">${[3, 4, 6].map((n) => `<button data-n="${n}" class="${metro.beats === n ? 'active' : ''}">${n}</button>`).join('')}</div></div>
      <div class="m-row"><span>Volume</span><input type="range" id="mt-vol" min="0" max="100" value="${Math.round(metro.volume * 100)}"/></div>
      <div class="m-row"><button class="btn sm" data-mt="tap">Tap tempo</button>${bb ? `<button class="btn ghost sm" data-mt="sync" title="Use the beat's tempo">Beat: ${bb}</button>` : ''}</div>`;
    setRangeFill($('#mt-vol'));
  }
  function bindMetronome() {
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
      const b = e.target.closest('[data-mt]');
      const sig = e.target.closest('#mt-sig button');
      if (sig) {
        metro.beats = +sig.dataset.n; S().metroBeats = metro.beats; persist();
        renderMetroMenu();
        if (metro.running) metroToggle(true);
        return;
      }
      if (!b) return;
      const a = b.dataset.mt;
      if (a === '+' || a === '-') setMetroBpm(metro.bpm + (a === '+' ? 1 : -1) * (e.shiftKey ? 5 : 1));
      if (a === 'sync') setMetroBpm(beatBpm());
      if (a === 'tap') {
        const t = performance.now();
        if (metroTaps.length && t - metroTaps[metroTaps.length - 1] > 2000) metroTaps.length = 0;
        metroTaps.push(t);
        if (metroTaps.length > 6) metroTaps.shift();
        if (metroTaps.length >= 3) setMetroBpm(60000 / ((metroTaps[metroTaps.length - 1] - metroTaps[0]) / (metroTaps.length - 1)));
        b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
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
    pf.hadMetro = metro.running;
    if (metro.running) metroToggle(false);
    const b = player.beat;
    pf.useAudio = !!(b && b.kind === 'file');
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
    $('#perform').hidden = true;
    const l = current();
    if (l) { l.perfIntro = +$('#pf-intro').value || 0; persist(); }
    if (pf.hadMetro) metroToggle(true);
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
    metro.setBpm(S().metroBpm || 90);
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
    const beatIn = Math.floor(t / spb + 1e-6) % 4;
    const barF = t / barDur - intro;
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
    wave.ab = null; wave.half = null;
    updateAbBtn();
    drawWave();
    if (b.peaks && b.bpm) return;
    try {
      const buf = await LMAudio.decode(await api.readMedia('beat', b.file));
      if (!b.peaks) { b.peaks = LMAudio.peaks(buf, 480); b.duration = buf.duration; }
      if (!b.bpm) {
        const bpm = LMAudio.detectBpm(buf);
        if (bpm) {
          b.bpm = bpm; b.bpmAuto = true;
          toast(`Detected about ${bpm} BPM`, 'metronome');
          if (player.beat?.id === b.id) { updateBpmLabel(); $('#pl-kind').textContent = `${KIND_LABEL[b.kind]} · ${bpm} BPM`; }
          renderMeta();
        }
      }
      persist();
      if (player.beat?.id === b.id) { wave.peaks = b.peaks; drawWave(); }
      if (st.view === 'beats') renderBeats();
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
    $('#export-btn').onclick = () => $('#export-menu').classList.toggle('open');
    $('#export-menu').onclick = (e) => {
      const b = e.target.closest('[data-ex]'); if (!b) return;
      $('#export-menu').classList.remove('open');
      ({ txt: exportLyric, pdf: exportPdf, copy: copyLyric })[b.dataset.ex]();
    };
    $('#add-word').onclick = () => addWordModal();
    bindNotes(); bindTakes(); bindHistory(); bindMetronome(); bindPerform(); bindWave();
    setPanels();
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
  function toggleFocus(force) {
    const on = force ?? !document.body.classList.contains('focus');
    document.body.classList.toggle('focus', on);
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
    else if (e.ctrlKey && k === 'm') { e.preventDefault(); metroToggle(); toast(metro.running ? `Metronome on · ${metro.bpm} BPM` : 'Metronome off', 'metronome'); }
    else if (e.ctrlKey && k === 'p') { e.preventDefault(); openPerform(); }
    else if (e.ctrlKey && k === 'r') { e.preventDefault(); toggleRecord(); }
    else if (e.ctrlKey && k === 'b') { e.preventDefault(); togglePanel('left'); }
    else if (e.ctrlKey && k === 'j') { e.preventDefault(); togglePanel('right'); }
    else if (k === 'escape') {
      if (document.body.classList.contains('focus')) toggleFocus(false);
      else if (!$('#def-card').hidden) $('#def-card').hidden = true;
      hideCtx();
    }
  });

  // ================= Boot =================
  function normalize(data) {
    const d = { version: 1, projects: [], folders: [], lyrics: [], beats: [], ui: {}, ...data };
    d.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    d.ui = { open: [], openId: null, ...(data.ui || {}) };
    d.customWords = d.customWords || [];
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
