// Finds new releases on GitHub and installs them, and handles uninstalling. The update check is the only thing that
// talks to GitHub, and it can be switched off in Settings. An update only swaps the program files named in the
// release's file list, so lyrics, beats, takes and settings in %AppData%\Lemonade are never touched.
const { app, dialog, net, shell } = require('electron');
const path = require('node:path');
// original-fs: Electron's own fs treats .asar files as folders, which would break copying app.asar
const fs = require('original-fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile, execFileSync } = require('node:child_process');

const REPO = 'slashneck/Lemonade';
const REPO_URL = 'https://github.com/' + REPO;
const MANIFEST = 'lemonade-files.txt';
const EXE = 'Lemonade.exe';
const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Lemonade';
const CHECK_EVERY = 6 * 3600e3;

// LEMONADE_DATA marks a test run: it keeps its own folders, never touches the real "Installed apps" entry and may
// read releases from LEMONADE_UPDATE_FEED instead of GitHub.
const testing = !!process.env.LEMONADE_DATA;
const feedUrl = () => (testing && process.env.LEMONADE_UPDATE_FEED) || `https://api.github.com/repos/${REPO}/releases/latest`;
const installDir = () => path.dirname(process.execPath);
const canSelfUpdate = () => app.isPackaged && fs.existsSync(path.join(installDir(), MANIFEST));
const updatesDir = () => testing
  ? path.join(process.env.LEMONADE_DATA, 'updates')
  : path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Lemonade', 'updates');
const headers = () => ({ 'User-Agent': `Lemonade/${app.getVersion()}`, Accept: 'application/vnd.github+json' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isNewer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function checkRelease() {
  const res = await net.fetch(feedUrl(), { headers: headers() });
  if (res.status === 404) return null; // nothing released yet
  if (!res.ok) throw new Error(`GitHub answered with ${res.status}`);
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+$/.test(version) || !isNewer(version, app.getVersion())) return null;
  const zipName = `lemonade-${version}-win-x64.zip`;
  const assets = rel.assets || [];
  const zip = assets.find((a) => a.name.toLowerCase() === zipName);
  if (!zip) return null;
  let sha = typeof zip.digest === 'string' && zip.digest.startsWith('sha256:') ? zip.digest.slice(7) : null;
  const sum = assets.find((a) => a.name.toLowerCase() === zipName + '.sha256');
  if (!sha && sum) sha = (await (await net.fetch(sum.browser_download_url, { headers: headers() })).text()).trim().split(/\s+/)[0];
  return { version, notes: rel.body || '', pageUrl: rel.html_url || REPO_URL + '/releases', url: zip.browser_download_url, size: zip.size || 0, sha };
}

function unzip(zip, dest) {
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const quote = (s) => "'" + s.replace(/'/g, "''") + "'";
  return new Promise((resolve, reject) => {
    execFile(tar, ['-xf', zip, '-C', dest], { windowsHide: true }, (err) => {
      if (!err) return resolve();
      // tar ships with Windows 10 1803 and newer; PowerShell is the slower fallback
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(dest)} -Force`],
        { windowsHide: true }, (e2) => (e2 ? reject(new Error("The update couldn't be unpacked")) : resolve()));
    });
  });
}

// Downloads and checks the release, then unpacks it. Returns the unpacked app folder.
async function downloadRelease(info, onProgress) {
  if (!/^[0-9a-f]{64}$/i.test(info.sha || '')) throw new Error("This release has no checksum, so it can't be verified. Download it from GitHub instead.");
  fs.mkdirSync(updatesDir(), { recursive: true });
  const zip = path.join(updatesDir(), `Lemonade-${info.version}.zip`);
  const res = await net.fetch(info.url, { headers: { 'User-Agent': headers()['User-Agent'] } });
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status})`);
  const total = +res.headers.get('content-length') || info.size;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(zip);
  let done = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      done += chunk.length;
      if (total) onProgress(Math.min(1, done / total));
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (hash.digest('hex') !== info.sha.toLowerCase()) {
    fs.rmSync(zip, { force: true });
    throw new Error('The download was damaged, so nothing was changed. Try again later.');
  }
  const staging = path.join(updatesDir(), `Lemonade-${info.version}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  await unzip(zip, staging);
  fs.rmSync(zip, { force: true });
  let appDir = staging;
  if (!fs.existsSync(path.join(staging, EXE))) {
    const sub = fs.readdirSync(staging).map((d) => path.join(staging, d)).find((d) => fs.existsSync(path.join(d, EXE)));
    if (!sub) throw new Error("The download doesn't contain Lemonade");
    appDir = sub;
  }
  if (!fs.existsSync(path.join(appDir, MANIFEST))) throw new Error('The download has no file list');
  return appDir;
}

function readManifest(dir) {
  return fs.readFileSync(path.join(dir, MANIFEST), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((raw) => {
    const rel = raw.replace(/\//g, '\\');
    if (path.isAbsolute(rel) || rel.split('\\').includes('..') || rel.toLowerCase() === MANIFEST) throw new Error(`Unexpected entry in the file list: ${rel}`);
    return rel;
  });
}

async function retry(fn, attempts = 80) {
  for (let i = 0; ; i++) {
    try { return fn(); } catch (err) {
      if (i >= attempts || !['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(err.code)) throw err;
      await sleep(250); // the old Lemonade or an antivirus scan can hold a file for a moment
    }
  }
}

function removeEmptyFolders(root) {
  const dirs = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) { const p = path.join(d, e.name); dirs.push(p); walk(p); } };
  try { walk(root); } catch { return; }
  for (const d of dirs.sort((a, b) => b.length - a.length)) { try { if (!fs.readdirSync(d).length) fs.rmdirSync(d); } catch {} }
}

function folderSizeKb(dir) {
  let total = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else total += fs.statSync(p).size; } };
  try { walk(dir); } catch {}
  return Math.round(total / 1024);
}

function refreshUninstallEntry(folder, version) {
  if (testing || process.platform !== 'win32') return;
  try { execFileSync('reg.exe', ['query', UNINSTALL_KEY], { windowsHide: true, stdio: 'ignore' }); } catch { return; } // not registered
  const set = (name, type, data) => execFileSync('reg.exe', ['add', UNINSTALL_KEY, '/v', name, '/t', type, '/d', String(data), '/f'], { windowsHide: true, stdio: 'ignore' });
  try {
    set('DisplayVersion', 'REG_SZ', version);
    set('DisplayIcon', 'REG_SZ', path.join(folder, EXE));
    set('InstallLocation', 'REG_SZ', folder);
    set('EstimatedSize', 'REG_DWORD', folderSizeKb(folder));
  } catch {}
}

// Closes any other Lemonade still running from the folder, like the setup does, so its files can be replaced.
function stopCopies(folder) {
  const prefix = (path.resolve(folder) + path.sep).replace(/'/g, "''");
  const command = 'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ProcessId -ne ' + process.pid +
    " -and $_.ExecutablePath.StartsWith('" + prefix + "', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }";
  try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: 'ignore', timeout: 30000 }); } catch {}
}

function spawnDetached(exe, args) {
  spawn(exe, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exe) }).unref();
}

// Runs from the downloaded copy. Waits for the old Lemonade to close, deletes the files the old version shipped that
// the new one doesn't have, copies the new files in and starts Lemonade again. Nothing outside the file lists is touched.
async function applyUpdate(target, oldPid, restart) {
  const source = installDir();
  const exe = path.join(target, EXE);
  try {
    for (let i = 0; i < 150; i++) {
      try { process.kill(oldPid, 0); } catch { break; } // gone
      await sleep(200);
    }
    if (!fs.existsSync(path.join(target, MANIFEST))) throw new Error("That folder isn't an installed copy of Lemonade");
    stopCopies(target);
    const newFiles = readManifest(source);
    const keep = new Set(newFiles.map((f) => f.toLowerCase()));
    for (const rel of readManifest(target)) {
      if (!keep.has(rel.toLowerCase())) await retry(() => fs.rmSync(path.join(target, rel), { force: true }));
    }
    for (const rel of newFiles) {
      const to = path.join(target, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      await retry(() => fs.copyFileSync(path.join(source, rel), to));
    }
    await retry(() => fs.copyFileSync(path.join(source, MANIFEST), path.join(target, MANIFEST)));
    removeEmptyFolders(target);
    refreshUninstallEntry(target, app.getVersion());
    if (restart) spawnDetached(exe, ['--updated']);
    return 0;
  } catch (err) {
    dialog.showMessageBoxSync({
      type: 'warning', title: 'Lemonade', message: "Lemonade couldn't finish the update",
      detail: `${err.message}\n\nYour lyrics, beats and takes are untouched. You can get the new version from ${REPO_URL}.`,
    });
    if (restart && fs.existsSync(exe)) spawnDetached(exe, []);
    return 1;
  }
}

// Removes leftovers from a finished update. Called at startup.
function cleanUp() {
  const dir = updatesDir();
  if (!fs.existsSync(dir) || installDir().toLowerCase().startsWith(dir.toLowerCase())) return;
  (async () => {
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch { await sleep(3000); } // the copy that did the update may still be closing
    }
  })();
}

// Removes the program only. Lyrics, beats, takes and settings stay where they are.
async function uninstall(quiet, dataDir) {
  const folder = installDir();
  const exe = path.join(folder, EXE);
  const say = (message, detail, buttons) => (quiet ? 0 : dialog.showMessageBoxSync({
    type: buttons ? 'question' : 'info', title: 'Lemonade', message, detail, buttons: buttons || ['OK'], defaultId: 0, cancelId: buttons ? 1 : 0, noLink: true,
  }));
  if (!fs.existsSync(path.join(folder, MANIFEST))) {
    say("This copy of Lemonade wasn't installed by the setup", 'You can simply delete its folder.');
    return 1;
  }
  if (say('Uninstall Lemonade?', `Lemonade is removed from this PC. Your lyrics, beats and takes stay in ${dataDir}.`, ['Uninstall', 'Cancel']) !== 0) return 1;

  for (const dir of [app.getPath('desktop'), path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')]) {
    const lnk = path.join(dir, 'Lemonade.lnk');
    try { if (fs.existsSync(lnk) && path.resolve(shell.readShortcutLink(lnk).target).toLowerCase() === exe.toLowerCase()) fs.rmSync(lnk); } catch {}
  }
  if (!testing) { try { execFileSync('reg.exe', ['delete', UNINSTALL_KEY, '/f'], { windowsHide: true, stdio: 'ignore' }); } catch {} }
  fs.rmSync(updatesDir(), { recursive: true, force: true });

  // the running program can't delete itself: a short-lived script removes the listed files once it has closed
  const files = [...readManifest(folder), MANIFEST].map((f) => path.join(folder, f));
  const dirs = new Set();
  for (const f of files) {
    let d = path.dirname(f);
    while (d.length > folder.length && d.toLowerCase().startsWith(folder.toLowerCase())) { dirs.add(d); d = path.dirname(d); }
  }
  const q = (s) => "'" + s.replace(/'/g, "''") + "'";
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `Wait-Process -Id ${process.pid} -Timeout 60`,
    'Start-Sleep -Milliseconds 600',
    `$files = @(${files.map(q).join(',')})`,
    'foreach ($f in $files) { for ($i = 0; $i -lt 40 -and (Test-Path -LiteralPath $f); $i++) { Remove-Item -LiteralPath $f -Force; if (Test-Path -LiteralPath $f) { Start-Sleep -Milliseconds 250 } } }',
    `$dirs = @(${[...dirs].sort((a, b) => b.length - a.length).concat(folder).map(q).join(',')})`,
    'foreach ($d in $dirs) { if ((Test-Path -LiteralPath $d) -and -not (Get-ChildItem -LiteralPath $d -Force)) { Remove-Item -LiteralPath $d -Force } }',
    `Remove-Item -LiteralPath ${q(app.getPath('userData'))} -Recurse -Force`,
    'Remove-Item -LiteralPath $PSCommandPath -Force',
  ].join('\r\n');
  const file = path.join(os.tmpdir(), `lemonade-uninstall-${process.pid}.ps1`);
  fs.writeFileSync(file, '\ufeff' + script, 'utf8');
  say('Lemonade is uninstalled', `Your lyrics, beats and takes are still in ${dataDir}.`);
  // started through cmd's start: a child spawned straight from Lemonade is closed together with it, so Lemonade only
  // exits once cmd has handed the script over
  const cmd = spawn('cmd.exe', ['/c', 'start', '""', '/b', 'powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file],
    { stdio: 'ignore', windowsHide: true });
  return new Promise((resolve) => {
    const done = () => resolve(0);
    cmd.once('exit', done);
    cmd.once('error', done);
    setTimeout(done, 5000);
  });
}

// Asks GitHub for a new version every few hours and downloads it in the background. A downloaded update is installed
// when Lemonade closes, or right away when you choose Restart.
class UpdateService {
  constructor(onChange) {
    this.onChange = onChange;
    this.state = 'idle'; // idle | checking | latest | available | downloading | ready | error
    this.progress = 0;
    this.error = null;
    this.available = null;
    this.staged = null;
    this.enabled = true;
    this.lastCheck = 0;
    this.busy = false;
    this.launched = false;
    setTimeout(() => this.tick(), 45e3);
    setInterval(() => this.tick(), 10 * 60e3);
  }

  status() {
    return {
      state: this.state, current: app.getVersion(), available: this.available?.version || null, notes: this.available?.notes || '',
      progress: this.progress, error: this.error, canInstall: canSelfUpdate(), enabled: this.enabled,
      pageUrl: this.available?.pageUrl || REPO_URL + '/releases',
    };
  }

  set(state) {
    this.state = state;
    if (state !== 'error') this.error = null;
    this.onChange(this.status());
  }

  tick() {
    if (this.enabled && !this.staged && Date.now() - this.lastCheck >= CHECK_EVERY) this.check(true);
  }

  async check(download) {
    if (this.busy || this.staged) return;
    this.busy = true;
    try {
      this.set('checking');
      this.lastCheck = Date.now();
      this.available = await checkRelease();
      if (!this.available) return this.set('latest');
      if (!download || !canSelfUpdate()) return this.set('available');
      this.progress = 0;
      this.set('downloading');
      this.staged = await downloadRelease(this.available, (p) => {
        if (p - this.progress < 0.02 && p < 1) return;
        this.progress = p;
        this.onChange(this.status());
      });
      this.set('ready');
    } catch (err) {
      this.error = /net::|fetch|ENOTFOUND|ECONN|ETIMEDOUT/i.test(err.message) ? "GitHub couldn't be reached" : err.message;
      this.set('error');
    } finally {
      this.busy = false;
    }
  }

  // Starts the downloaded copy, which swaps the files as soon as this process has exited.
  launch(restart) {
    if (!this.staged || this.launched) return false;
    this.launched = true;
    spawnDetached(path.join(this.staged, EXE), ['--apply-update', installDir(), String(process.pid), ...(restart ? [] : ['--no-restart'])]);
    return true;
  }
}

module.exports = { REPO_URL, updatesDir, applyUpdate, cleanUp, uninstall, UpdateService };
