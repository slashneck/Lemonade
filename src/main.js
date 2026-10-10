const { app, BrowserWindow, ipcMain, dialog, shell, session, nativeTheme, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const updater = require('./updater');

const ROOT = path.join(__dirname, '..');
if (process.env.LEMONADE_DATA) app.setPath('userData', process.env.LEMONADE_DATA);
const DATA_DIR = app.getPath('userData');

// Updating and uninstalling run without a window, before the single instance lock (the old copy may still be open).
const argv = process.argv.slice(1);
if (argv.includes('--apply-update') || argv.includes('--uninstall')) {
  const updating = argv.includes('--apply-update');
  app.setPath('userData', updating ? path.join(updater.updatesDir(), 'session') : path.join(require('node:os').tmpdir(), `lemonade-uninstall-${process.pid}`));
  app.whenReady().then(async () => {
    let code;
    if (updating) {
      const i = argv.indexOf('--apply-update');
      code = await updater.applyUpdate(argv[i + 1], +argv[i + 2], !argv.includes('--no-restart'));
    } else code = await updater.uninstall(argv.includes('--quiet'), DATA_DIR);
    app.exit(code);
  });
  return;
}

const LIB_FILE = path.join(DATA_DIR, 'library.json');
const BEATS_DIR = path.join(DATA_DIR, 'beats');
const TAKES_DIR = path.join(DATA_DIR, 'takes');
const WIN_FILE = path.join(DATA_DIR, 'window.json');
const ICON = path.join(ROOT, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'webm'];

let win;
let updates = null;
const justUpdated = argv.includes('--updated');

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  fs.renameSync(tmp, file);
}

function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(WIN_FILE, 'utf8'));
    const area = screen.getDisplayMatching(b).workArea;
    const visible = b.x < area.x + area.width - 100 && b.y < area.y + area.height - 100 && b.x + b.width > area.x + 100 && b.y > area.y - 20;
    return visible ? b : { width: b.width, height: b.height, maximized: b.maximized };
  } catch { return { width: 1400, height: 880 }; }
}

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  const bounds = loadBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: dark ? '#0a0a0a' : '#fafafa',
    icon: ICON,
    title: 'Lemonade',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#f2f2f2' : '#111111', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => { if (bounds.maximized) win.maximize(); win.show(); });
  win.on('close', () => {
    try { fs.writeFileSync(WIN_FILE, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch {}
  });

  // Look check for development: LEMONADE_SHOT=out.png [LEMONADE_JS=code] captures the window and quits.
  if (process.env.LEMONADE_SHOT && (!app.isPackaged || process.env.LEMONADE_DATA)) {
    win.webContents.on('console-message', (e) => console.log('[renderer]', e.message));
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, +process.env.LEMONADE_WAIT || 3500));
      if (process.env.LEMONADE_JS) {
        try { await win.webContents.executeJavaScript(process.env.LEMONADE_JS); } catch (err) { console.log('js error', err); }
        await new Promise((r) => setTimeout(r, 1200));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.LEMONADE_SHOT, img.toPNG());
      app.exit(0);
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
}

app.whenReady().then(() => {
  fs.mkdirSync(BEATS_DIR, { recursive: true });
  fs.mkdirSync(TAKES_DIR, { recursive: true });

  // Microphone access for recording takes; nothing else is granted.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) =>
    cb(perm === 'media' && (details.mediaTypes || []).every((t) => t === 'audio')));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');

  // YouTube embeds refuse to play without a referrer; file:// pages send none.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube.com/*', 'https://www.youtube-nocookie.com/*'] },
    (details, cb) => {
      details.requestHeaders.Referer = updater.REPO_URL;
      cb({ requestHeaders: details.requestHeaders });
    }
  );

  createWindow();
  updater.cleanUp();
  updates = new updater.UpdateService((status) => { if (win && !win.isDestroyed()) win.webContents.send('update:changed', status); });
});

// A downloaded update is installed when Lemonade closes, without starting it again.
app.on('will-quit', () => { if (updates) updates.launch(false); });
app.on('window-all-closed', () => app.quit());

// ---------- library ----------
ipcMain.handle('lib:load', () => {
  for (const f of [LIB_FILE, LIB_FILE + '.bak']) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  }
  return null;
});
ipcMain.handle('lib:save', (_e, json) => { writeAtomic(LIB_FILE, json); return true; });
ipcMain.on('lib:saveSync', (e, json) => {
  try { writeAtomic(LIB_FILE, json); e.returnValue = true; } catch { e.returnValue = false; }
});
ipcMain.handle('lexicon:load', () => fs.readFileSync(path.join(ROOT, 'data', 'lexicon.txt'), 'utf8'));

// ---------- beats ----------
function copyBeat(src) {
  const ext = path.extname(src).toLowerCase();
  const file = crypto.randomUUID() + ext;
  fs.copyFileSync(src, path.join(BEATS_DIR, file));
  return { name: path.basename(src, ext), file };
}
ipcMain.handle('beat:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import beats',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: AUDIO_EXT }],
  });
  return r.canceled ? [] : r.filePaths.map(copyBeat);
});
ipcMain.handle('beat:importPaths', (_e, paths) =>
  paths.filter((p) => AUDIO_EXT.includes(path.extname(p).slice(1).toLowerCase())).map(copyBeat)
);
ipcMain.handle('beat:url', (_e, file) => pathToFileURL(path.join(BEATS_DIR, path.basename(file))).href);
ipcMain.handle('beat:delete', (_e, file) => {
  try { fs.unlinkSync(path.join(BEATS_DIR, path.basename(file))); } catch {}
  return true;
});

// ---------- takes & media ----------
const mediaPath = (kind, file) => path.join(kind === 'take' ? TAKES_DIR : BEATS_DIR, path.basename(file));
ipcMain.handle('take:save', (_e, data) => {
  const file = crypto.randomUUID() + '.webm';
  fs.writeFileSync(path.join(TAKES_DIR, file), Buffer.from(data));
  return file;
});
ipcMain.handle('media:url', (_e, kind, file) => pathToFileURL(mediaPath(kind, file)).href);
ipcMain.handle('media:read', (_e, kind, file) => fs.readFileSync(mediaPath(kind, file)));
ipcMain.handle('take:delete', (_e, file) => {
  try { fs.unlinkSync(mediaPath('take', file)); } catch {}
  return true;
});
ipcMain.handle('file:saveBuffer', async (_e, { name, data, ext, label }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export audio',
    defaultPath: (name || 'take').replace(/[\\/:*?"<>|]/g, '_') + '.' + ext,
    filters: [{ name: label || ext.toUpperCase(), extensions: [ext] }],
  });
  if (r.canceled) return false;
  fs.writeFileSync(r.filePath, Buffer.from(data));
  return true;
});
ipcMain.handle('export:pdf', async (_e, { name, html }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export PDF',
    defaultPath: (name || 'lyric').replace(/[\\/:*?"<>|]/g, '_') + '.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled) return false;
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await pw.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'default' } });
    fs.writeFileSync(r.filePath, pdf);
  } finally { pw.destroy(); }
  return true;
});

// ---------- misc ----------
ipcMain.handle('open:external', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});
ipcMain.handle('data:open', () => shell.openPath(DATA_DIR));
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  packaged: app.isPackaged,
  dataPath: DATA_DIR,
  electron: process.versions.electron,
  justUpdated,
}));

// ---------- updates ----------
ipcMain.handle('update:status', () => updates?.status() || null);
ipcMain.handle('update:config', (_e, { enabled }) => {
  if (!updates) return;
  updates.enabled = !!enabled;
  if (enabled) updates.tick();
});
ipcMain.handle('update:check', () => updates?.check(true));
ipcMain.handle('update:install', () => {
  if (updates?.launch(true)) app.quit();
});
ipcMain.handle('titlebar:set', (_e, { color, symbolColor }) => {
  try { win.setTitleBarOverlay({ color, symbolColor, height: 40 }); } catch {}
});

ipcMain.handle('shortcut:create', (_e, where) => {
  if (process.platform !== 'win32') return { ok: false, error: 'Shortcuts are only supported on Windows.' };
  const target = process.execPath;
  const dir = where === 'startmenu'
    ? path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    : app.getPath('desktop');
  const lnk = path.join(dir, 'Lemonade.lnk');
  const ok = shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', {
    target,
    args: app.isPackaged ? '' : `"${app.getAppPath()}"`,
    cwd: path.dirname(target),
    icon: app.isPackaged ? target : ICON,
    iconIndex: 0,
    description: 'Lemonade',
  });
  return ok ? { ok: true, path: lnk } : { ok: false, error: 'Windows refused to create the shortcut.' };
});

ipcMain.handle('export:text', async (_e, { name, text }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export lyric',
    defaultPath: (name || 'lyric').replace(/[\\/:*?"<>|]/g, '_') + '.txt',
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (r.canceled) return false;
  fs.writeFileSync(r.filePath, text, 'utf8');
  return true;
});
ipcMain.handle('backup:export', async (_e, json) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(win, {
    title: 'Export backup',
    defaultPath: `lemonade-backup-${stamp}.json`,
    filters: [{ name: 'Lemonade backup', extensions: ['json'] }],
  });
  if (r.canceled) return false;
  fs.writeFileSync(r.filePath, json, 'utf8');
  return true;
});
ipcMain.handle('backup:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import backup',
    properties: ['openFile'],
    filters: [{ name: 'Lemonade backup', extensions: ['json'] }],
  });
  return r.canceled ? null : fs.readFileSync(r.filePaths[0], 'utf8');
});
