// Orbit desktop app. Opens straight to Orbit — no setup screen.
// It connects to the server address in electron/config.json ("serverUrl").
// If that is empty, it runs a private Orbit server inside the app so it still works offline/for testing.
const { app, BrowserWindow, Menu, shell, session, desktopCapturer, dialog, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

app.setAppUserModelId('app.orbit.chat');
let config = {};
try { config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch {}
// A user-level override is possible (advanced): %APPDATA%/Orbit/orbit-server.txt containing a URL.
try { const o = fs.readFileSync(path.join(app.getPath('userData'), 'orbit-server.txt'), 'utf8').trim(); if (o) config.serverUrl = o; } catch {}
const remote = (config.serverUrl || '').replace(/\/$/, '');
if (/^http:\/\//i.test(remote)) app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', new URL(remote).origin);

let win, local = null;

function setupSession() {
  const ses = session.defaultSession;
  const allowed = ['media', 'mediaKeySystem', 'notifications', 'display-capture', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection', 'pointerLock'];
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.includes(perm)));
  ses.setPermissionCheckHandler((wc, perm) => allowed.includes(perm) || perm === 'media');
  ses.setDevicePermissionHandler(() => true);
  ses.setDisplayMediaRequestHandler(async (req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      if (!sources.length) return cb({});
      const names = sources.slice(0, 12).map(s => s.name);
      const pick = await dialog.showMessageBox(win, { type: 'question', title: 'Share your screen', message: 'What do you want to share?', buttons: [...names, 'Cancel'], cancelId: names.length, noLink: true });
      if (pick.response >= names.length) return cb({});
      const src = sources[pick.response];
      cb({ video: src, audio: process.platform === 'win32' && src.id.startsWith('screen') ? 'loopback' : undefined });
    } catch { cb({}); }
  });
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 420, minHeight: 520, backgroundColor: '#0c0a17', title: 'Orbit ' + app.getVersion(),
    icon: path.join(__dirname, 'icon-tile.png'), autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: true },
  });
  win.once('ready-to-show', () => win.show());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Orbit', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
  ]));
  const origin = new URL(url).origin;
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(origin)) { e.preventDefault(); shell.openExternal(u); } });
  win.webContents.on('did-fail-load', (e, code, desc, failed) => {
    if (!failed.startsWith(origin) || code === -3) return;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0c0a17;color:#efedff;font-family:system-ui;text-align:center">
      <div><h2 style="font-weight:600">Can’t reach Orbit</h2><p style="color:#9d98c0">Check your internet connection. Retrying in a few seconds…</p></div>
      <script>setTimeout(()=>location.replace(${JSON.stringify(url)}),4000)</script></body>`));
  });
  win.loadURL(url);
}

app.whenReady().then(async () => {
  setupSession();
  try { await session.defaultSession.clearCache(); } catch {}
  if (process.platform === 'darwin') { try { await systemPreferences.askForMediaAccess('microphone'); await systemPreferences.askForMediaAccess('camera'); } catch {} }
  let url = remote;
  if (!url) {
    const { start } = require('../server/server.js');
    const opts = { host: '127.0.0.1', dataDir: path.join(app.getPath('userData'), 'orbit-data'), log: () => {} };
    try { local = await start({ ...opts, port: 43117 }); } catch { local = await start({ ...opts, port: 0 }); }
    url = `http://localhost:${local.port}`;
  }
  createWindow(url);
});
app.on('window-all-closed', async () => { if (local) await local.close().catch(() => {}); app.quit(); });
