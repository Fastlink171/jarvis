'use strict';
/*
  J.A.R.V.I.S. — desktop main process.
  Everything runs on this PC: the AI brain is Ollama (http://127.0.0.1:11434),
  speech recognition and the voice run inside the window (Whisper + Kokoro).
*/
const { app, BrowserWindow, ipcMain, shell, protocol, net, session, globalShortcut, Tray, Menu, nativeImage, safeStorage, Notification, desktopCapturer, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const OLLAMA = 'http://127.0.0.1:11434';
const ROOT = path.join(__dirname, 'renderer');
const ICON = path.join(__dirname, 'icon.png');
const IS_WIN = process.platform === 'win32';

app.setAppUserModelId('local.jarvis.assistant');
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');
app.commandLine.appendSwitch('enable-unsafe-webgpu');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null, tray = null, quitting = false;
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
let prefs = { tray: true, hotkey: 'CommandOrControl+Shift+J' };
try { Object.assign(prefs, JSON.parse(fs.readFileSync(prefsFile(), 'utf8'))); } catch {}
if (!prefs.bg14) { prefs.tray = true; prefs.bg14 = true; }          // 1.4.0: keep running in the background by default
const START_HIDDEN = process.argv.includes('--hidden');
let wakeOn = false;
const writeSafe = (f, text) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, f); };   // never a half-written file
const savePrefs = () => { try { writeSafe(prefsFile(), JSON.stringify(prefs, null, 2)); } catch {} };

/* ------------------------------------------------------------------ window */
const MIME = { '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.apng': 'image/apng', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640, show: false,
    title: prefs.aiName || 'Jarvis', icon: ICON, backgroundColor: '#07111f',
    titleBarStyle: 'hidden',
    titleBarOverlay: IS_WIN ? { color: '#08121f', symbolColor: '#cfe9f7', height: 32 } : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', spellcheck: false
    }
  });
  win.loadURL('app://jarvis/index.html');
  win.once('ready-to-show', () => { if (!START_HIDDEN) win.show(); });
  win.on('close', e => {
    if (prefs.tray && !quitting) {
      e.preventDefault(); win.hide();
      if (!prefs.toldTray) {
        prefs.toldTray = true; savePrefs();
        try { new Notification({ title: 'Jarvis is still running', body: 'He’s in the system tray. Say “Jarvis” (with wake word on) or press Ctrl+Shift+J. Right-click the tray icon to quit.', icon: ICON }).show(); } catch {}
      }
    }
  });
  const vis = () => send('win:visible', win.isVisible() && !win.isMinimized());
  ['show', 'hide', 'minimize', 'restore'].forEach(ev => win.on(ev, vis));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
}
function showWindow() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function trayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show ' + (prefs.aiName || 'Jarvis'), click: showWindow },
    { label: 'Talk to ' + (prefs.aiName || 'Jarvis') + '   (Ctrl+Shift+J)', click: () => win.webContents.send('hotkey:talk') },
    { label: 'Listen for “Hey ' + (prefs.aiName || 'Jarvis') + '”', type: 'checkbox', checked: wakeOn, click: m => win.webContents.send('tray:wake', m.checked) },
    { type: 'separator' },
    { label: 'Quit ' + (prefs.aiName || 'Jarvis'), click: () => { quitting = true; app.quit(); } }
  ]));
  tray.setToolTip(wakeOn ? `${prefs.aiName || 'Jarvis'} — listening for “Hey ${prefs.aiName || 'Jarvis'}”` : (prefs.aiName || 'Jarvis'));
}

function setupTray() {
  if (tray) return;
  try {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    trayMenu();
    tray.on('click', showWindow);
  } catch {}
}
function registerHotkey() {
  globalShortcut.unregisterAll();
  try { globalShortcut.register(prefs.hotkey, () => { if (win && win.isVisible() && !win.isMinimized()) win.focus(); win && win.webContents.send('hotkey:talk'); }); } catch {}
}

app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  protocol.handle('app', async req => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || !p) p = '/index.html';
    let file = path.normalize(path.join(ROOT, p));
    if (p.startsWith('/custom/')) file = path.join(customDir(), path.basename(p));     // the user's own pictures
    else if (p.startsWith('/myvoices/')) file = path.join(voicesDir(), path.basename(p)); // the user's own voices
    else if (!file.startsWith(ROOT)) return new Response('forbidden', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { status: 200, headers: {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'credentialless',
        'cache-control': 'no-cache'
      } });
    } catch { return new Response('not found', { status: 404 }); }
  });
  const ok = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'clipboard-read']);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(ok.has(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ok.has(perm));
  createWindow();
  setupTray();
  registerHotkey();
  setupUpdater();
  cleanupOldInstall();
});

/* ------------------------------------------------------------------ automatic updates (GitHub releases) */
let autoUpdater = null, updateState = { state: app.isPackaged ? 'idle' : 'dev' };
const setUpdate = st => { updateState = st; send('update:status', st); };
const plain = n => String(Array.isArray(n) ? n.map(x => x.note || '').join('\n') : n || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<li>/gi, '• ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
function setupUpdater() {
  if (!app.isPackaged) return;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { updateState = { state: 'error', error: e.message }; return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  applyFeed();
  autoUpdater.on('checking-for-update', () => setUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', i => setUpdate({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'latest', version: app.getVersion() }));
  autoUpdater.on('download-progress', p => setUpdate({ state: 'downloading', version: updateState.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', i => {
    snapshotData('before-' + i.version);
    prefs.pendingNotes = { version: i.version, notes: plain(i.releaseNotes) }; savePrefs();
    setUpdate({ state: 'ready', version: i.version, notes: plain(i.releaseNotes) });
  });
  autoUpdater.on('error', e => {
    let msg = String(e && e.message || e).split('\n')[0].slice(0, 200);
    if (/\b(404|401|403)\b|not found|authentication|Bad credentials/i.test(msg)) msg = getToken() ? 'GitHub refused the update key. Paste a new key in Settings → Updates.' : 'The Jarvis repository is private. Paste your GitHub update key in Settings → Updates.';
    setUpdate({ state: 'error', error: msg });
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10000);
  setInterval(check, 3 * 3600 * 1000);
}
/* private repository: the user's own read-only GitHub key, encrypted with Windows (DPAPI) */
const REPO = { owner: 'Fastlink171', repo: 'jarvis' };
function getToken() {
  if (!prefs.updateKey) return '';
  try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(prefs.updateKey, 'base64')) : Buffer.from(prefs.updateKey, 'base64').toString(); } catch { return ''; }
}
function applyFeed() {
  if (!autoUpdater) return;
  const token = getToken();
  if (token) autoUpdater.setFeedURL({ provider: 'github', owner: REPO.owner, repo: REPO.repo, private: true, token, releaseType: 'release' });
  else autoUpdater.setFeedURL({ provider: 'github', owner: REPO.owner, repo: REPO.repo, releaseType: 'release' });
}
ipcMain.handle('update:setKey', async (e, key) => {
  key = String(key || '').trim();
  if (!key) { delete prefs.updateKey; savePrefs(); applyFeed(); return { ok: true, cleared: true }; }
  // check the key can see the repository before saving it
  try {
    const r = await net.fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}`, { headers: { Authorization: 'Bearer ' + key, 'User-Agent': 'Jarvis', Accept: 'application/vnd.github+json' } });
    if (r.status === 401) return { ok: false, error: 'GitHub says this key is invalid or expired.' };
    if (r.status === 404 || r.status === 403) return { ok: false, error: 'This key can’t see the jarvis repository. Give it access to Fastlink171/jarvis with Contents: Read-only.' };
    if (!r.ok) return { ok: false, error: 'GitHub answered ' + r.status + '.' };
  } catch (err) { return { ok: false, error: 'Couldn’t reach GitHub: ' + err.message }; }
  prefs.updateKey = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key)).toString('base64');
  savePrefs(); applyFeed();
  if (autoUpdater) autoUpdater.checkForUpdates().catch(() => {});
  return { ok: true };
});
ipcMain.handle('update:state', () => ({ ...updateState, current: app.getVersion(), justUpdated: takeNotes(), hasKey: !!prefs.updateKey }));
ipcMain.handle('update:check', async () => { if (!autoUpdater) return updateState; try { await autoUpdater.checkForUpdates(); } catch (e) { setUpdate({ state: 'error', error: e.message }); } return updateState; });
ipcMain.handle('update:install', () => { if (autoUpdater && updateState.state === 'ready') { snapshotData('before-' + updateState.version); quitting = true; autoUpdater.quitAndInstall(true, true); } });
function takeNotes() {
  const n = prefs.pendingNotes;
  if (n && n.version === app.getVersion()) { delete prefs.pendingNotes; savePrefs(); return n; }
  return null;
}
function cleanupOldInstall() {
  // The first Jarvis zip used a hand-made installer. Remove its leftovers so Windows shows one "Jarvis" in Apps.
  if (!IS_WIN || !app.isPackaged) return;
  try { spawn('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Jarvis', '/f'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  try { fs.unlinkSync(path.join(path.dirname(process.execPath), 'Uninstall-Jarvis.ps1')); } catch {}
}

/* ------------------------------------------------------------------ helpers */
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const decodeHtml = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ app info / prefs */
ipcMain.handle('app:info', () => ({
  user: os.userInfo().username, computer: os.hostname(), os: (os.version && os.version()) || os.type(),
  cores: os.cpus().length, version: app.getVersion(), platform: process.platform, home: os.homedir(),
  hotkey: prefs.hotkey, tray: prefs.tray, login: IS_WIN ? app.getLoginItemSettings().openAtLogin : false
}));
ipcMain.handle('app:prefs', (e, p) => {
  if ('tray' in p) prefs.tray = !!p.tray;
  if ('login' in p && IS_WIN) app.setLoginItemSettings({ openAtLogin: !!p.login, args: ['--hidden'] });
  if ('wake' in p) { wakeOn = !!p.wake; trayMenu(); }
  if ('aiName' in p) { prefs.aiName = String(p.aiName || 'Jarvis').slice(0, 24); if (win) win.setTitle(prefs.aiName); trayMenu(); }
  savePrefs();
  return true;
});
ipcMain.handle('app:openExternal', (e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
ipcMain.handle('win:show', () => showWindow());
ipcMain.handle('win:visible', () => !!(win && win.isVisible() && !win.isMinimized()));
ipcMain.handle('win:flash', () => { if (win && !win.isFocused()) win.flashFrame(true); });

/* ------------------------------------------------------------------ Ollama */
async function ojson(p, body, timeout = 8000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(OLLAMA + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
    const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch {}
    if (!r.ok) throw new Error(j.error || txt || ('HTTP ' + r.status));
    return j;
  } finally { clearTimeout(t); }
}
ipcMain.handle('ollama:version', async () => { try { return { ok: true, ...(await ojson('/api/version', null, 2500)) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('ollama:tags', async () => { try { return { ok: true, models: (await ojson('/api/tags')).models || [] }; } catch (e) { return { ok: false, error: e.message, models: [] }; } });
ipcMain.handle('ollama:ps', async () => { try { return { ok: true, models: (await ojson('/api/ps')).models || [] }; } catch (e) { return { ok: false, models: [] }; } });
ipcMain.handle('ollama:show', async (e, model) => { try { const j = await ojson('/api/show', { model }); return { ok: true, capabilities: j.capabilities || [], details: j.details || {} }; } catch (err) { return { ok: false, error: err.message, capabilities: [] }; } });
ipcMain.handle('ollama:delete', async (e, model) => {
  try { const r = await fetch(OLLAMA + '/api/delete', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }) }); return { ok: r.ok }; } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('ollama:start', async () => {
  // Ollama normally starts with Windows. If it's installed but not running, launch it.
  const cands = IS_WIN ? [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama app.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama app.exe')
  ] : [];
  for (const c of cands) {
    if (fs.existsSync(c)) {
      const args = /ollama\.exe$/i.test(c) ? ['serve'] : [];
      try { spawn(c, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); return { ok: true, started: c }; } catch {}
    }
  }
  return { ok: false, installed: false };
});

async function streamLines(resp, onLine) {
  const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(JSON.parse(line)); }
  }
  if (buf.trim()) onLine(JSON.parse(buf.trim()));
}

const pulls = new Map();
ipcMain.handle('ollama:pull', async (e, model) => {
  const ac = new AbortController(); pulls.set(model, ac);
  try {
    const r = await fetch(OLLAMA + '/api/pull', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal: ac.signal });
    if (!r.ok) { const t = await r.text(); let m = t; try { m = JSON.parse(t).error; } catch {} throw new Error(m); }
    let ok = false;
    await streamLines(r, j => {
      if (j.error) throw new Error(j.error);
      send('pull:progress', { model, status: j.status, total: j.total, completed: j.completed });
      if (j.status === 'success') ok = true;
    });
    return { ok };
  } catch (err) { return { ok: false, error: err.name === 'AbortError' ? 'cancelled' : err.message }; }
  finally { pulls.delete(model); }
});
ipcMain.handle('ollama:pullCancel', (e, model) => { const ac = pulls.get(model); if (ac) ac.abort(); });

const chats = new Map();
ipcMain.handle('ollama:chat', async (e, id, body) => {
  const ac = new AbortController(); chats.set(id, ac);
  try {
    const r = await fetch(OLLAMA + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, stream: true }), signal: ac.signal });
    if (!r.ok) { const t = await r.text(); let m = t; try { m = JSON.parse(t).error; } catch {} throw new Error(m || ('HTTP ' + r.status)); }
    let content = '', thinking = '', toolCalls = [], final = null;
    await streamLines(r, j => {
      if (j.error) throw new Error(j.error);
      const m = j.message || {};
      if (m.thinking) { thinking += m.thinking; send('chat:chunk', { id, thinking: m.thinking }); }
      if (m.content) { content += m.content; send('chat:chunk', { id, content: m.content }); }
      if (m.tool_calls && m.tool_calls.length) toolCalls.push(...m.tool_calls);
      if (j.done) final = j;
    });
    return { ok: true, content, thinking, tool_calls: toolCalls, eval_count: final && final.eval_count, eval_duration: final && final.eval_duration };
  } catch (err) { return { ok: false, error: err.name === 'AbortError' ? 'aborted' : err.message }; }
  finally { chats.delete(id); }
});
ipcMain.handle('ollama:abort', (e, id) => { const ac = chats.get(id); if (ac) ac.abort(); });

/* ------------------------------------------------------------------ PowerShell */
let psCwd = os.homedir();
function parseClixml(s) {
  if (!s.startsWith('#< CLIXML')) return s;
  const out = []; const re = /<S S="Error">([\s\S]*?)<\/S>/g; let m;
  while ((m = re.exec(s))) out.push(m[1]);
  return out.join('').replace(/_x000D_/g, '').replace(/_x000A_/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}
function runPS(command, timeoutMs = 90000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    if (!IS_WIN) return resolve({ output: '', errors: ['PowerShell is only available on Windows.'], cwd: psCwd, ms: 0 });
    const marker = '__JARVIS_CWD__';
    const script = [
      "$ProgressPreference = 'SilentlyContinue'",
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      '$OutputEncoding = [Text.Encoding]::UTF8',
      "Set-Location -LiteralPath '" + psCwd.replace(/'/g, "''") + "'",
      '$__r = & {',
      command,
      '}',
      'if ($null -ne $__r) { $__r | Out-String -Width 200 }',
      "'" + marker + "' + (Get-Location).Path"
    ].join('\r\n');
    const tmp = path.join(os.tmpdir(), 'jarvis-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1');
    try { fs.writeFileSync(tmp, '\ufeff' + script, 'utf8'); } catch (e) { return resolve({ output: '', errors: [e.message], cwd: psCwd, ms: 0 }); }
    const ps = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp], { windowsHide: true, cwd: fs.existsSync(psCwd) ? psCwd : os.homedir() });
    let out = '', err = '', timedOut = false;
    ps.stdout.on('data', d => { out += d.toString('utf8'); if (out.length > 400000) out = out.slice(-400000); });
    ps.stderr.on('data', d => { err += d.toString('utf8'); });
    const timer = setTimeout(() => { timedOut = true; try { spawn('taskkill', ['/pid', String(ps.pid), '/T', '/F'], { windowsHide: true }); } catch {} }, timeoutMs);
    ps.on('close', code => {
      clearTimeout(timer); fs.unlink(tmp, () => {});
      const i = out.lastIndexOf(marker);
      if (i >= 0) { const c = out.slice(i + marker.length).trim(); if (c) psCwd = c; out = out.slice(0, i); }
      const errors = parseClixml(err.trim()).split(/\r?\n(?=\S)/).map(s => s.trim()).filter(Boolean);
      if (timedOut) errors.push('Command stopped after ' + Math.round(timeoutMs / 1000) + ' seconds.');
      resolve({ output: out.replace(/\r/g, '').replace(/\s+$/, ''), errors, cwd: psCwd, code, ms: Date.now() - t0 });
    });
    ps.on('error', e => { clearTimeout(timer); resolve({ output: '', errors: [e.message], cwd: psCwd, ms: Date.now() - t0 }); });
  });
}
ipcMain.handle('ps:run', (e, command, timeoutMs) => runPS(String(command || ''), timeoutMs || 90000));
ipcMain.handle('ps:cwd', () => psCwd);

/* ------------------------------------------------------------------ files */
function resolvePath(p) {
  p = String(p || '').trim().replace(/^["']|["']$/g, '');
  p = p.replace(/^~(?=$|[\\/])/, os.homedir()).replace(/%([^%]+)%/g, (m, v) => process.env[v] || m).replace(/^\$env:USERPROFILE|^\$HOME/i, os.homedir());
  const known = { desktop: 'desktop', documents: 'documents', downloads: 'downloads', music: 'music', pictures: 'pictures', videos: 'videos' };
  const first = p.split(/[\\/]/)[0].toLowerCase();
  if (known[first] && !path.isAbsolute(p)) p = path.join(app.getPath(known[first]), p.split(/[\\/]/).slice(1).join(path.sep));
  if (!path.isAbsolute(p)) p = path.join(psCwd, p);
  return path.normalize(p);
}
ipcMain.handle('fs:read', async (e, p) => {
  const f = resolvePath(p);
  try {
    const st = await fs.promises.stat(f);
    if (st.isDirectory()) { const list = await fs.promises.readdir(f, { withFileTypes: true }); return { ok: true, path: f, dir: true, text: list.slice(0, 200).map(d => (d.isDirectory() ? '[dir] ' : '') + d.name).join('\n') }; }
    if (st.size > 3e6) return { ok: false, path: f, error: 'File is larger than 3 MB.' };
    const text = await fs.promises.readFile(f, 'utf8');
    return { ok: true, path: f, text: text.slice(0, 20000), truncated: text.length > 20000 };
  } catch (err) { return { ok: false, path: f, error: err.message }; }
});
ipcMain.handle('fs:write', async (e, p, content, append) => {
  const f = resolvePath(p);
  try { await fs.promises.mkdir(path.dirname(f), { recursive: true }); await fs.promises[append ? 'appendFile' : 'writeFile'](f, String(content ?? ''), 'utf8'); return { ok: true, path: f }; }
  catch (err) { return { ok: false, path: f, error: err.message }; }
});
ipcMain.handle('fs:resolve', (e, p) => resolvePath(p));

/* ------------------------------------------------------------------ open */
ipcMain.handle('open:target', async (e, target) => {
  target = String(target || '').trim();
  if (/^https?:\/\//i.test(target)) { await shell.openExternal(target); return { ok: true, how: 'browser' }; }
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(target) && !/\.(exe|lnk|txt|docx?|xlsx?|pdf|png|jpe?g|mp[34]|bat|cmd|ps1)$/i.test(target)) { await shell.openExternal('https://' + target); return { ok: true, how: 'browser' }; }
  const asPath = resolvePath(target);
  if (fs.existsSync(asPath)) { const err = await shell.openPath(asPath); return err ? { ok: false, error: err } : { ok: true, how: 'path', path: asPath }; }
  const r = await runPS("Start-Process '" + target.replace(/'/g, "''") + "'", 20000);
  return r.errors.length ? { ok: false, error: r.errors.join(' ') } : { ok: true, how: 'start-process' };
});

/* ------------------------------------------------------------------ system stats */
let lastCpu = null, slow = { netKBs: 0, procs: [], gpu: null }, lastNet = null, slowBusy = false, slowAt = 0;
function cpuPercent() {
  const c = os.cpus().reduce((a, x) => { const t = x.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, total: 0 });
  let pct = 0; if (lastCpu) { const di = c.idle - lastCpu.idle, dt = c.total - lastCpu.total; pct = dt > 0 ? Math.round(100 * (1 - di / dt)) : 0; }
  lastCpu = c; return Math.max(0, Math.min(100, pct));
}
async function refreshSlow() {
  if (!IS_WIN || slowBusy || Date.now() - slowAt < 15000) return;
  slowBusy = true; slowAt = Date.now();
  const r = await runStatScript(!slow.gpu);
  slowBusy = false;
  try {
    const j = JSON.parse(r);
    const now = Date.now(), bytes = (j.rx || 0) + (j.tx || 0);
    if (lastNet) slow.netKBs = Math.max(0, Math.round((bytes - lastNet.b) / 1024 / ((now - lastNet.t) / 1000)));
    lastNet = { b: bytes, t: now };
    slow.procs = (Array.isArray(j.procs) ? j.procs : [j.procs]).filter(Boolean).map(p => ({ name: p.Name, id: p.Id, mem: Math.round(p.WS / 1048576) }));
    if (j.gpu) slow.gpu = j.gpu;
  } catch {}
}
function runStatScript(withGpu) {
  return new Promise(resolve => {
    let s = "$a = Get-NetAdapterStatistics -ErrorAction SilentlyContinue; $p = Get-Process | Sort-Object WS -Descending | Select-Object -First 6 Name,Id,WS; $g = (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Basic|Virtual|Remote' } | Select-Object -First 1 -ExpandProperty Name); @{ rx = [double](($a | Measure-Object ReceivedBytes -Sum).Sum); tx = [double](($a | Measure-Object SentBytes -Sum).Sum); procs = @($p); gpu = $g } | ConvertTo-Json -Compress -Depth 4";
    if (!withGpu) s = s.replace(/\$g = \(Get-CimInstance[^;]*\); /, '$g = $null; ');
    const ps = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', s], { windowsHide: true });
    let out = ''; ps.stdout.on('data', d => out += d); ps.on('close', () => resolve(out.trim())); ps.on('error', () => resolve(''));
    setTimeout(() => { try { ps.kill(); } catch {} }, 15000);
  });
}
ipcMain.handle('sys:stats', async () => {
  refreshSlow();
  const total = os.totalmem(), free = os.freemem();
  let disk = null;
  try { const st = fs.statfsSync(IS_WIN ? 'C:\\' : '/'); disk = { total: Math.round(st.blocks * st.bsize / 1073741824), free: Math.round(st.bavail * st.bsize / 1073741824) }; } catch {}
  const up = os.uptime();
  return {
    cpu: cpuPercent(), cores: os.cpus().length,
    mem: Math.round(100 * (total - free) / total), memUsed: +((total - free) / 1073741824).toFixed(1), memTotal: +(total / 1073741824).toFixed(1),
    disk: disk ? Math.round(100 * (disk.total - disk.free) / disk.total) : null, diskTotal: disk && disk.total, diskFree: disk && disk.free,
    uptime: Math.floor(up / 86400) + 'd ' + String(Math.floor(up % 86400 / 3600)).padStart(2, '0') + 'h ' + String(Math.floor(up % 3600 / 60)).padStart(2, '0') + 'm',
    netKBs: slow.netKBs, procs: slow.procs, gpu: slow.gpu, procCount: null, cwd: psCwd
  };
});

/* ------------------------------------------------------------------ web */
function parseDDG(html) {
  const out = [];
  const blocks = html.split(/<div class="result results_links/).slice(1);
  for (const b of blocks) {
    if (/result--ad/.test(b.slice(0, 200))) continue;
    const a = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) || b.match(/href="([^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = a[1].replace(/&amp;/g, '&');
    const ud = url.match(/[?&]uddg=([^&]+)/); if (ud) url = decodeURIComponent(ud[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (/duckduckgo\.com\/y\.js/.test(url)) continue;
    const sn = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(a|div|td)>/);
    out.push({ title: decodeHtml(a[2]), url, snippet: sn ? decodeHtml(sn[1]) : '' });
    if (out.length >= 8) break;
  }
  return out;
}
async function withHiddenWindow(url, js, waitMs = 900, timeout = 20000) {
  const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, images: false, partition: 'persist:web' } });
  w.webContents.setAudioMuted(true);
  w.webContents.setUserAgent(UA);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await Promise.race([w.loadURL(url), new Promise((_, rej) => setTimeout(() => rej(new Error('Page took too long to load.')), timeout))]).catch(e => { if (!/ERR_ABORTED/.test(e.message)) throw e; });
    await new Promise(r => setTimeout(r, waitMs));
    return await Promise.race([w.webContents.executeJavaScript(js, true), new Promise((_, rej) => setTimeout(() => rej(new Error('Page did not respond.')), 8000))]);
  } finally { if (!w.isDestroyed()) w.destroy(); }
}
const BING_JS = `(() => [...document.querySelectorAll('li.b_algo')].slice(0, 8).map(li => {
  const a = li.querySelector('h2 a'); const p = li.querySelector('.b_caption p, p');
  let href = a ? a.href : '';
  try { const u = new URL(href); const enc = u.searchParams.get('u'); if (enc && enc.startsWith('a1')) href = atob(enc.slice(2).replace(/-/g, '+').replace(/_/g, '/')); } catch {}
  return { title: a ? a.innerText : '', url: href, snippet: p ? p.innerText : '' };
}).filter(r => r.url))()`;
ipcMain.handle('web:search', async (e, query) => {
  query = String(query || '').trim();
  let results = [], source = 'duckduckgo';
  try {
    const r = await net.fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query) + '&kl=us-en', { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html' } });
    if (r.ok) results = parseDDG(await r.text());
  } catch {}
  if (!results.length) {
    source = 'bing';
    try { results = await withHiddenWindow('https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=en', BING_JS, 600); } catch (err) { return { ok: false, error: err.message, results: [] }; }
  }
  return { ok: results.length > 0, source, results, error: results.length ? undefined : 'No results found.' };
});
const READ_JS = `(() => {
  const kill = 'script,style,noscript,svg,canvas,iframe,nav,footer,header,aside,form,button,[role=navigation],[role=banner],[aria-hidden=true],.ad,.ads,.advert,.cookie,.newsletter,.share,.social,.related,.comments';
  const root = (document.querySelector('article') || document.querySelector('main') || document.querySelector('[role=main]') || document.body).cloneNode(true);
  root.querySelectorAll(kill).forEach(n => n.remove());
  let text = root.innerText || document.body.innerText || '';
  text = text.replace(/\\n{3,}/g, '\\n\\n').replace(/[ \\t]{2,}/g, ' ').trim();
  const desc = (document.querySelector('meta[name=description]') || {}).content || '';
  return { title: document.title, url: location.href, description: desc, text };
})()`;
ipcMain.handle('web:read', async (e, url) => {
  url = String(url || '').trim(); if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const r = await withHiddenWindow(url, READ_JS, 1200);
    const text = (r.text || '').slice(0, 9000);
    return { ok: true, title: r.title, url: r.url, description: r.description, text, truncated: (r.text || '').length > 9000 };
  } catch (err) { return { ok: false, url, error: err.message }; }
});
ipcMain.handle('web:json', async (e, url) => {
  // small helper for weather / geo / market data
  try { const r = await net.fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return { ok: true, data: await r.json() }; }
  catch (err) { return { ok: false, error: err.message }; }
});

/* ------------------------------------------------------------------ PC control helper (media, volume, keys, windows) */
let helper = null, helperBuf = '', helperSeq = 0, helperReady = null;
const helperCalls = new Map();
function startHelper() {
  if (!IS_WIN) return Promise.reject(new Error('PC control is only available on Windows.'));
  if (helper && helperReady) return helperReady;
  const file = path.join(app.getPath('userData'), 'jarvis-helper.ps1');
  fs.writeFileSync(file, '\ufeff' + fs.readFileSync(path.join(__dirname, 'helper.ps1'), 'utf8'), 'utf8');
  helper = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true });
  helperBuf = '';
  helperReady = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('PC control helper did not start.')), 20000);
    helper.stdout.on('data', d => {
      helperBuf += d.toString('utf8');
      let i;
      while ((i = helperBuf.indexOf('\n')) >= 0) {
        const line = helperBuf.slice(0, i).trim(); helperBuf = helperBuf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.ready) { clearTimeout(t); resolve(true); continue; }
        const c = helperCalls.get(m.id); if (c) { helperCalls.delete(m.id); c(m); }
      }
    });
    let err = '';
    helper.stderr.on('data', d => { err += d.toString('utf8'); });
    helper.on('exit', () => {
      clearTimeout(t); reject(new Error('PC control helper stopped. ' + parseClixml(err.trim()).slice(0, 300)));
      for (const c of helperCalls.values()) c({ ok: false, error: 'PC control helper stopped.' });
      helperCalls.clear(); helper = null; helperReady = null;
    });
  });
  helperReady.catch(() => { helper = null; helperReady = null; });
  return helperReady;
}
async function pc(cmd, args = {}) {
  try { await startHelper(); } catch (e) { return { ok: false, error: e.message }; }
  return new Promise(resolve => {
    const id = ++helperSeq;
    const t = setTimeout(() => { helperCalls.delete(id); resolve({ ok: false, error: 'PC control timed out.' }); }, 20000);
    helperCalls.set(id, m => { clearTimeout(t); resolve(m.ok ? { ok: true, ...(m.result || {}) } : { ok: false, error: m.error }); });
    helper.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n');
  });
}
ipcMain.handle('pc:do', (e, cmd, args) => pc(String(cmd), args || {}));
app.whenReady().then(() => { if (IS_WIN) setTimeout(() => startHelper().catch(() => {}), 4000); });
app.on('will-quit', () => { try { helper && helper.kill(); } catch {} });

/* ------------------------------------------------------------------ seeing the screen (in memory only, never saved) */
ipcMain.handle('screen:capture', async (e, target) => {
  try {
    target = String(target || '').trim().toLowerCase();
    const d = screen.getPrimaryDisplay();
    const scale = Math.min(1, 1280 / (d.size.width * d.scaleFactor));
    const size = { width: Math.round(d.size.width * d.scaleFactor * scale), height: Math.round(d.size.height * d.scaleFactor * scale) };
    let src;
    if (target) {
      const wins = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size, fetchWindowIcons: false });
      src = wins.find(w => w.name.toLowerCase() === target) || wins.find(w => w.name.toLowerCase().includes(target));
      if (!src && helper) { const r = await pc('windows'); const w = r.ok && r.windows.find(x => (x.app || '').toLowerCase().includes(target)); if (w) src = wins.find(x => x.name === w.title); }
      if (!src) return { ok: false, error: 'No open window matches "' + target + '".' };
    } else {
      const scr = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      src = scr.find(x => x.display_id === String(d.id)) || scr[0];
    }
    if (!src || src.thumbnail.isEmpty()) return { ok: false, error: 'That window can’t be captured (it may be minimized).' };
    const img = src.thumbnail;
    const jpg = img.toJPEG(72);                       // kept in memory, sent to the AI, then discarded
    return { ok: true, name: src.name, width: img.getSize().width, height: img.getSize().height, b64: jpg.toString('base64') };
  } catch (err) { return { ok: false, error: err.message }; }
});

/* free the graphics card (e.g. while gaming): unload the model; it reloads on the next question */
ipcMain.handle('ollama:unload', async (e, model) => {
  try { await ojson('/api/generate', { model, keep_alive: 0 }, 10000); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
});

/* ------------------------------------------------------------------ desktop pet */
let petWin = null, petWanted = false, petHiddenForGame = false, petDrag = null, petLast = {};
function createPet() {
  if (petWin) return;
  const wa = screen.getPrimaryDisplay().workArea;
  let pos = prefs.petPos;
  const onScreen = pos && screen.getAllDisplays().some(d => pos.x > d.workArea.x - 120 && pos.x < d.workArea.x + d.workArea.width - 120 && pos.y > d.workArea.y - 130 && pos.y < d.workArea.y + d.workArea.height - 130);
  if (!onScreen) pos = { x: wa.x + wa.width - 300, y: wa.y + wa.height - 342 };
  petWin = new BrowserWindow({
    width: 300, height: 340, x: pos.x, y: pos.y, transparent: true, frame: false, resizable: false, movable: true,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: false, show: false, backgroundColor: '#00000000', title: 'Jarvis pet',
    webPreferences: { preload: path.join(__dirname, 'pet-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  petWin.setAlwaysOnTop(true, 'floating');
  petWin.setIgnoreMouseEvents(true, { forward: true });          // clicks pass through except on the bot itself
  petWin.loadURL('app://jarvis/pet.html');
  petWin.on('closed', () => { petWin = null; });
}
function updatePetVisibility() {
  const show = petWanted && !petHiddenForGame;
  if (show) { createPet(); if (petWin && !petWin.isVisible() && petWin.webContents.isLoading() === false) petWin.showInactive(); }
  else if (petWin && petWin.isVisible()) petWin.hide();
}
ipcMain.on('pet:ready', () => { if (!petWin) return; petWin.webContents.send('pet:update', petLast); if (petWanted && !petHiddenForGame) petWin.showInactive(); });
ipcMain.on('pet:mouse', (e, over) => { if (petWin) petWin.setIgnoreMouseEvents(!over, { forward: true }); });
ipcMain.on('pet:dragStart', () => { if (petWin) { const [x, y] = petWin.getPosition(); petDrag = { x, y }; } });
ipcMain.on('pet:drag', (e, dx, dy) => { if (petWin && petDrag) petWin.setPosition(Math.round(petDrag.x + dx), Math.round(petDrag.y + dy)); });
ipcMain.on('pet:dragEnd', () => { if (petWin) { const [x, y] = petWin.getPosition(); prefs.petPos = { x, y }; savePrefs(); } petDrag = null; });
ipcMain.on('pet:click', () => { if (win) win.webContents.send('hotkey:talk'); });
ipcMain.on('pet:menu', () => {
  if (!petWin) return;
  Menu.buildFromTemplate([
    { label: 'Talk to ' + (prefs.aiName || 'Jarvis'), click: () => win && win.webContents.send('hotkey:talk') },
    { label: 'Show ' + (prefs.aiName || 'Jarvis'), click: showWindow },
    { label: 'Listen for “Hey ' + (prefs.aiName || 'Jarvis') + '”', type: 'checkbox', checked: wakeOn, click: m => win && win.webContents.send('tray:wake', m.checked) },
    { type: 'separator' },
    { label: 'Hide pet', click: () => win && win.webContents.send('pet:off') }
  ]).popup({ window: petWin });
});
ipcMain.handle('pet:set', (e, d) => {
  if ('show' in d) { petWanted = !!d.show; updatePetVisibility(); }
  if ('gaming' in d) { petHiddenForGame = !!d.gaming; updatePetVisibility(); }
  const upd = {};
  for (const k of ['state', 'level', 'say', 'theme', 'custom', 'scale']) if (k in d) upd[k] = d[k];
  if (Object.keys(upd).length) { Object.assign(petLast, upd); delete petLast.say; if (petWin) petWin.webContents.send('pet:update', upd); }
  return true;
});

/* ------------------------------------------------------------------ custom look: the user's own pictures (stay on this PC) */
const SLOTS = ['idle', 'speaking', 'listening', 'thinking', 'wallpaper'];
function customDir() { const d = path.join(app.getPath('userData'), 'custom'); try { fs.mkdirSync(d, { recursive: true }); } catch {} return d; }
function customUrls() {
  const out = {}; prefs.custom = prefs.custom || {};
  for (const k of SLOTS) { const f = prefs.custom[k]; if (f && fs.existsSync(path.join(customDir(), f))) out[k] = 'app://jarvis/custom/' + encodeURIComponent(f); }
  return out;
}
ipcMain.handle('custom:get', () => customUrls());
ipcMain.handle('custom:pick', async (e, slot) => {
  if (!SLOTS.includes(slot)) return { ok: false };
  const r = await dialog.showOpenDialog(win, {
    title: slot === 'wallpaper' ? 'Choose a wallpaper' : 'Choose a picture for the pet (' + slot + ')',
    properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'gif', 'webp', 'jpg', 'jpeg', 'apng'] }]
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const src = r.filePaths[0], st = fs.statSync(src);
  if (st.size > 40 * 1024 * 1024) return { ok: false, error: 'That file is over 40 MB.' };
  const name = slot + '-' + Date.now() + path.extname(src).toLowerCase();
  fs.copyFileSync(src, path.join(customDir(), name));
  prefs.custom = prefs.custom || {};
  const old = prefs.custom[slot]; if (old) { try { fs.unlinkSync(path.join(customDir(), old)); } catch {} }
  prefs.custom[slot] = name; savePrefs();
  return { ok: true, urls: customUrls() };
});
ipcMain.handle('custom:clear', (e, slot) => {
  prefs.custom = prefs.custom || {};
  const old = prefs.custom[slot]; if (old) { try { fs.unlinkSync(path.join(customDir(), old)); } catch {} }
  delete prefs.custom[slot]; savePrefs();
  return { ok: true, urls: customUrls() };
});

/* ------------------------------------------------------------------ animated scene: a layered picture of the user's own (stays on this PC)
   A .jarvisscene file is JSON: { W, H, layers:[{ x, y, w, h, z, depth, src:"data:image/…" }] }.
   It is unpacked into the custom folder; a plain picture also works (one layer, gentle camera move). */
const sceneFile = () => path.join(customDir(), 'scene.json');
function sceneUrl() { try { const st = fs.statSync(sceneFile()); return 'app://jarvis/custom/scene.json?v=' + Math.round(st.mtimeMs); } catch { return null; } }
function clearScene() { for (const n of fs.readdirSync(customDir())) if (/^scene(-\d+\.\w+|\.json)$/.test(n)) { try { fs.unlinkSync(path.join(customDir(), n)); } catch {} } }
ipcMain.handle('scene:get', () => sceneUrl());
ipcMain.handle('scene:clear', () => { clearScene(); return { ok: true }; });
ipcMain.handle('scene:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose an animated scene or a picture', properties: ['openFile'],
    filters: [{ name: 'Scenes and pictures', extensions: ['jarvisscene', 'json', 'png', 'jpg', 'jpeg', 'webp'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const src = r.filePaths[0], st = fs.statSync(src);
  if (st.size > 120 * 1024 * 1024) return { ok: false, error: 'That file is over 120 MB.' };
  try {
    const ext = path.extname(src).toLowerCase();
    let scene;
    if (ext === '.jarvisscene' || ext === '.json') {
      const j = JSON.parse(fs.readFileSync(src, 'utf8'));
      if (!j || !Array.isArray(j.layers) || !j.layers.length || j.layers.length > 200 || !(j.W > 0) || !(j.H > 0)) throw new Error('This is not a Jarvis scene file.');
      clearScene();
      const layers = j.layers.map((l, i) => {
        const m = /^data:image\/(webp|png|jpeg);base64,(.+)$/.exec(String(l.src || ''));
        if (!m) throw new Error('Layer ' + (i + 1) + ' has no picture.');
        const name = 'scene-' + String(i).padStart(3, '0') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
        fs.writeFileSync(path.join(customDir(), name), Buffer.from(m[2], 'base64'));
        const n = k => Number.isFinite(+l[k]) ? +l[k] : 0;
        return { file: name, x: n('x'), y: n('y'), w: n('w'), h: n('h'), z: n('z'), depth: Math.max(0, Math.min(2, n('depth'))), bg: /^(sky|building|background|bg)$/i.test(l.name || '') };
      });
      scene = { W: +j.W, H: +j.H, layers };
    } else {
      // a single picture: one layer that the camera drifts across
      const img = nativeImage.createFromPath(src); const sz = img.getSize();
      if (!sz.width) throw new Error('Could not open that picture.');
      clearScene(); const name = 'scene-000' + ext; fs.copyFileSync(src, path.join(customDir(), name));
      scene = { W: sz.width, H: sz.height, layers: [{ file: name, x: 0, y: 0, w: sz.width, h: sz.height, z: 0, depth: .5, bg: true }] };
    }
    fs.writeFileSync(sceneFile(), JSON.stringify(scene));
    return { ok: true, url: sceneUrl(), layers: scene.layers.length };
  } catch (e) { return { ok: false, error: e.message }; }
});
/* ------------------------------------------------------------------ your own voices: Kokoro voice files (.bin) kept on this PC, never in the repo
// Put name.bin in %APPDATA%\Jarvis\voices. An optional name.json like {"label":"Nova","pitch":1.25} sets its menu name and built-in pitch.
function voicesDir() { const d = path.join(app.getPath('userData'), 'voices'); try { fs.mkdirSync(d, { recursive: true }); } catch {} return d; }
ipcMain.handle('voices:list', () => {
  const out = [];
  try {
    for (const f of fs.readdirSync(voicesDir())) {
      if (!/\.bin$/i.test(f)) continue;
      const name = f.slice(0, -4); let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(voicesDir(), name + '.json'), 'utf8')) || {}; } catch {}
      const pitch = Math.max(0.5, Math.min(2, +meta.pitch || 1));
      out.push({ id: 'my:' + name, label: String(meta.label || name), pitch });
    }
  } catch {}
  return out;
});
ipcMain.handle('voices:openFolder', () => shell.openPath(voicesDir()));

/* ------------------------------------------------------------------ custom trained voice: a local TTS server on this PC (see tts.js) */
const tts = require('./tts');
ipcMain.handle('tts:speak', async (e, id, text, opts) => {
  try { const wav = await tts.speak(id, text, opts || {}); return { ok: true, wav: new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength) }; }
  catch (err) { return { ok: false, error: err.message, code: err.code || 'error' }; }
});
ipcMain.handle('tts:abort', (e, id) => { if (id == null) tts.abortAll(); else tts.abort(id); });
ipcMain.handle('tts:ping', (e, url) => tts.ping(url).catch(err => ({ ok: false, error: err.message })));

/* ------------------------------------------------------------------ your data: kept safe across updates
   Everything Jarvis knows about you lives in %APPDATA%\Jarvis, which installs and updates never touch.
   On top of that: the window's storage (memories, settings, chat) is mirrored to jarvis-data.json, and a
   full snapshot is copied to backups\ before every update is installed. */
const dataDir = () => app.getPath('userData');
const mirrorFile = () => path.join(dataDir(), 'jarvis-data.json');
const DATA_FILES = ['prefs.json', 'todo.json', 'jarvis-data.json'];   // (the custom folder, scene included, is copied too)
function snapshotData(label) {
  try {
    const root = path.join(dataDir(), 'backups'), stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const dir = path.join(root, label.replace(/[^\w.-]/g, '_') + '_' + stamp);
    if (label !== 'manual' && fs.existsSync(root) && fs.readdirSync(root).some(n => n.startsWith(label.replace(/[^\w.-]/g, '_') + '_'))) return dir;   // already saved for this update
    fs.mkdirSync(dir, { recursive: true });
    for (const n of DATA_FILES) { try { fs.copyFileSync(path.join(dataDir(), n), path.join(dir, n)); } catch {} }
    try { fs.cpSync(path.join(dataDir(), 'custom'), path.join(dir, 'custom'), { recursive: true }); } catch {}
    const all = fs.readdirSync(root).filter(n => fs.statSync(path.join(root, n)).isDirectory()).sort((a, b) => fs.statSync(path.join(root, a)).mtimeMs - fs.statSync(path.join(root, b)).mtimeMs);
    all.slice(0, -10).forEach(n => { try { fs.rmSync(path.join(root, n), { recursive: true, force: true }); } catch {} });   // keep the last 10
    return dir;
  } catch { return null; }
}
ipcMain.on('data:mirrorLoadSync', e => { try { e.returnValue = JSON.parse(fs.readFileSync(mirrorFile(), 'utf8')); } catch { e.returnValue = null; } });
ipcMain.handle('data:mirror', (e, obj) => { try { if (obj && typeof obj === 'object' && Object.keys(obj).length) writeSafe(mirrorFile(), JSON.stringify(obj)); return true; } catch { return false; } });
ipcMain.handle('data:backupNow', () => { const d = snapshotData('manual'); return d ? { ok: true, dir: d } : { ok: false }; });
ipcMain.handle('data:openFolder', () => shell.openPath(path.join(dataDir(), fs.existsSync(path.join(dataDir(), 'backups')) ? 'backups' : '')));
// first launch after an update: snapshot what came through, so there is always a copy from every version
app.whenReady().then(() => { if (prefs.lastVersion && prefs.lastVersion !== app.getVersion()) snapshotData('after-' + app.getVersion()); if (prefs.lastVersion !== app.getVersion()) { prefs.lastVersion = app.getVersion(); savePrefs(); } });

/* ------------------------------------------------------------------ To-Do: saved to %APPDATA%\\Jarvis\\todo.json */
const todoFile = () => path.join(app.getPath('userData'), 'todo.json');
ipcMain.handle('todo:load', () => {
  try { return JSON.parse(fs.readFileSync(todoFile(), 'utf8')); } catch {}
  // missing or damaged: fall back to the newest daily backup, then the newest update snapshot
  const d = dataDir(), cands = fs.readdirSync(d).filter(n => /^todo\.backup-.*\.json$/.test(n)).sort().reverse().map(n => path.join(d, n));
  try { const root = path.join(d, 'backups'); fs.readdirSync(root).sort().reverse().forEach(n => cands.push(path.join(root, n, 'todo.json'))); } catch {}
  for (const f of cands) { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); if (fs.existsSync(todoFile())) fs.copyFileSync(todoFile(), todoFile() + '.damaged'); return v; } catch {} }
  return null;
});
ipcMain.handle('todo:save', (e, data) => {
  try {
    const f = todoFile();
    writeSafe(f, JSON.stringify(data));
    const bak = path.join(app.getPath('userData'), 'todo.backup-' + new Date().toISOString().slice(0, 10) + '.json');
    if (!fs.existsSync(bak)) {
      fs.copyFileSync(f, bak);
      const old = fs.readdirSync(app.getPath('userData')).filter(n => /^todo\.backup-.*\.json$/.test(n)).sort().slice(0, -7);
      old.forEach(n => { try { fs.unlinkSync(path.join(app.getPath('userData'), n)); } catch {} });   // keep a week of daily backups
    }
    return true;
  } catch (err) { return false; }
});
