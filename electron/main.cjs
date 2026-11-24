const { app, BrowserWindow, WebContentsView, ipcMain, session, nativeTheme } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Connection, validateTarget, destination, localUsername } = require('./connection.cjs');
const { History } = require('./history.cjs');
const { Preferences } = require('./preferences.cjs');

app.setName('Relay · SSH Client');
app.enableSandbox();
// Keep the existing profile location when changing the display language.
// Test runners use isolated profiles.
app.setPath('userData', process.env.RELAY_USER_DATA
  ? path.resolve(process.env.RELAY_USER_DATA)
  : path.join(app.getPath('appData'), 'Relay · SSH 薄客户端'));
const detectedUser = localUsername();
const preferences = new Preferences(path.join(app.getPath('userData'), 'preferences.json'));
nativeTheme.themeSource = preferences.theme;
const windowBackground = () => nativeTheme.shouldUseDarkColors ? '#101114' : '#f5f6f8';
let win, business, floating, connection, history, quitting = false;
let pageHTTPError = '';
let screen = 'connection', phase = 'idle', error = '', warning = '', busy = false, expanded = false;
const shellPath = path.join(__dirname, 'shell.html');
const floatPath = path.join(__dirname, 'floating.html');
const shellURL = pathToFileURL(shellPath).href;
const floatURL = pathToFileURL(floatPath).href;
const defaults = validateTarget({
  host: process.env.RELAY_SSH_HOST || 'example.com',
  sshPort: Number(process.env.RELAY_SSH_PORT || 22),
  port: Number(process.env.RELAY_BACKEND_PORT || 18765), startService: true
}, { requirePath: false });
function snapshot() {
  return { ...connection.state, theme: preferences.theme, localUser: detectedUser, screen, phase, error, warning, busy, expanded,
    target: connection.target || defaults, history: history.records, defaults: history.records[0] || defaults };
}
function layout() {
  if (!win || win.isDestroyed() || !business || !floating) return;
  const [width, height] = win.getContentSize();
  business.setBounds({ x: 0, y: 0, width, height });
  const cardWidth = expanded ? 336 : 56, cardHeight = expanded ? 312 : 56;
  floating.setBounds({ x: width - cardWidth - 16, y: height - cardHeight - 16, width: cardWidth, height: cardHeight });
  business.setVisible(screen === 'workspace');
  floating.setVisible(screen === 'workspace');
}
function sendState() {
  if (!win || win.isDestroyed()) return;
  const value = snapshot();
  for (const contents of [win.webContents, floating.webContents]) {
    if (!contents.isDestroyed()) contents.send('relay:state', value);
  }
  layout();
}
function lockContents(contents, allowed) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
}
async function loadBusiness() {
  if (connection.state.status !== 'online') throw new Error('Server is not ready. Reconnect to retry.');
  phase = 'loading'; error = ''; pageHTTPError = ''; sendState();
  let timer;
  try {
    const url = connection.state.url;
    await Promise.race([
      business.webContents.loadURL(url),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Workspace timed out. Please retry.')), 15000); })
    ]);
    if (pageHTTPError) throw new Error(pageHTTPError);
    if (connection.state.status !== 'online' || new URL(business.webContents.getURL()).origin !== url) throw new Error('Connection lost while loading. Please retry.');
    // Network health alone must never dismiss the local connection page.
    screen = 'workspace'; phase = 'ready'; expanded = false;
    win.setTitle(`Relay · ${connection.state.mode === 'ssh' ? destination(connection.target) : 'Local demo'}`);
    if (connection.state.mode === 'ssh') {
      try { history.remember(connection.target); }
      catch { warning = 'Connected, but recent connections could not be saved.'; }
    }
    sendState();
    business.webContents.focus();
  } catch (failure) {
    business.webContents.stop();
    throw new Error(`Workspace failed to load: ${failure.message}`);
  } finally { clearTimeout(timer); }
}
async function connect(mode, target) {
  phase = 'connecting'; error = ''; warning = ''; sendState();
  await connection.connect(mode, target);
  if (connection.state.status !== 'online') throw new Error(connection.state.detail);
  await loadBusiness();
}
app.whenReady().then(async () => {
  connection = new Connection();
  history = new History(path.join(app.getPath('userData'), 'connections.json'));
  const permissions = ses => {
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', event => event.preventDefault());
  };
  permissions(session.defaultSession);
  const remoteSession = session.fromPartition('relay-business');
  permissions(remoteSession);
  remoteSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try { allowed = new URL(details.url).origin === connection.state.url; } catch {}
    callback({ cancel: !allowed });
  });
  const localPreferences = { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true };
  win = new BrowserWindow({ width: 1240, height: 850, minWidth: 760, minHeight: 640, backgroundColor: windowBackground(), title: 'Connect to a host', webPreferences: localPreferences });
  business = new WebContentsView({ webPreferences: { session: remoteSession, nodeIntegration: false, contextIsolation: true, sandbox: true } });
  floating = new WebContentsView({ webPreferences: localPreferences });
  floating.setBackgroundColor('#00000000');
  // Native view order is intentional: business fills the window, local controls sit above it.
  win.contentView.addChildView(business);
  win.contentView.addChildView(floating);
  lockContents(win.webContents, url => url === shellURL);
  lockContents(floating.webContents, url => url === floatURL);
  lockContents(business.webContents, url => { try { return new URL(url).origin === connection.state.url; } catch { return false; } });
  win.on('resize', layout);
  nativeTheme.on('updated', () => {
    if (win && !win.isDestroyed()) { win.setBackgroundColor(windowBackground()); sendState(); }
  });
  layout();
  const shellActions = new Set(['state', 'connect', 'theme']);
  const floatActions = new Set(['state', 'theme', 'disconnect', 'reconnect', 'switch', 'refresh', 'expand', 'stop', 'publish']);
  ipcMain.handle('relay:action', async (event, action, payload) => {
    const fromShell = event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === shellURL;
    const fromFloat = event.sender === floating.webContents && event.senderFrame === floating.webContents.mainFrame && event.senderFrame.url === floatURL;
    if (!(fromShell && shellActions.has(action)) && !(fromFloat && floatActions.has(action))) throw new Error('Untrusted caller or action.');
    if (action === 'state') return snapshot();
    if (action === 'theme') {
      preferences.setTheme(payload); nativeTheme.themeSource = preferences.theme;
      win.setBackgroundColor(windowBackground()); sendState(); return snapshot();
    }
    if (action === 'expand') { expanded = payload === true; sendState(); return snapshot(); }
    if (busy) throw new Error('A connection operation is in progress.');
    busy = true; error = ''; sendState();
    try {
      switch (action) {
        case 'connect': await connect(payload?.mode, payload?.target); break;
        case 'reconnect': await connect(connection.state.mode, connection.target); break;
        case 'disconnect': await connection.disconnect(); phase = 'idle'; break;
        case 'switch':
          await connection.disconnect(); business.webContents.stop();
          screen = 'connection'; phase = 'idle'; expanded = false;
          win.setTitle('Connect to a host'); sendState(); win.webContents.focus(); break;
        case 'refresh': await loadBusiness(); break;
        case 'stop': await connection.stopService(); break;
        case 'publish': connection.publish(); break;
      }
    } catch (failure) {
      error = failure.message; phase = 'error';
      // Failed first connections must not leave a tunnel behind a hidden page.
      if (screen === 'connection') await connection.disconnect();
    } finally { busy = false; sendState(); }
    return snapshot();
  });
  connection.on('state', sendState);
  business.webContents.on('did-navigate', (_event, _url, statusCode) => {
    if (statusCode >= 400) pageHTTPError = `HTTP ${statusCode}`;
  });
  business.webContents.on('render-process-gone', () => {
    error = 'Workspace closed unexpectedly. Refresh or reconnect.'; phase = 'error'; sendState();
  });
  business.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3 && !busy && screen === 'workspace') {
      error = `Workspace failed to load: ${description}`; phase = 'error'; sendState();
    }
  });
  await Promise.all([win.loadFile(shellPath), floating.webContents.loadFile(floatPath), business.webContents.loadURL('about:blank')]);
  win.webContents.focus();
  sendState(); // Always start at the local form. --ssh never auto-connects.
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting || !connection) return;
  event.preventDefault(); quitting = true;
  connection.close().finally(() => {
    for (const view of [business, floating]) if (view && !view.webContents.isDestroyed()) view.webContents.close();
    app.quit();
  });
});
