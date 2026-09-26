const path = require('node:path');
const { normalizeDesktopLyricsState, resolveDesktopLyricsBounds, projectDesktopLyricsSnapshot } = require('./desktopLyricsModel.cjs');

// 桌面字幕独立窗口：主窗口只发布快照，本模块独立管理位置、锁定和退出清理。
function createDesktopLyricsController({ BrowserWindow, screen, ipcMain, store, getMainWindow, getSnapshot, isDev, onChange }) {
  let win = null, disposed = false, saveTimer = null, screenListening = false;
  let state = normalizeDesktopLyricsState(store.get('DESKTOP_LYRICS'));
  let lastBroadcast = null;
  let publishedLyrics, publishedTrack;
  const current = () => ({ ...state, enabled: !!win && !win.isDestroyed() });
  const send = (target, channel, data) => { if (target && !target.isDestroyed()) target.webContents.send(channel, data); };
  const broadcast = () => {
    send(getMainWindow(), 'desktop-lyrics-state-changed', current());
    send(win, 'desktop-lyrics-state-changed', current());
    const next = current();
    if (!lastBroadcast || lastBroadcast.enabled !== next.enabled || lastBroadcast.locked !== next.locked) onChange();
    lastBroadcast = next;
  };
  const saveBounds = () => {
    clearTimeout(saveTimer); saveTimer = null;
    if (win && !win.isDestroyed()) store.set('DESKTOP_LYRICS_BOUNDS', win.getBounds());
  };
  const applyLock = () => {
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(state.locked, { forward: true });
    win.setFocusable(!state.locked);
    win.setResizable(!state.locked);
  };
  const safeBounds = value => resolveDesktopLyricsBounds(value, screen.getAllDisplays(), screen.getPrimaryDisplay());
  const publish = (snapshot, force = false) => {
    if (!win || win.isDestroyed()) return;
    const value = projectDesktopLyricsSnapshot(snapshot);
    if (value && !force && publishedTrack === snapshot.trackKey && publishedLyrics === snapshot.lyrics) delete value.lyrics;
    publishedTrack = snapshot?.trackKey;
    publishedLyrics = snapshot?.lyrics;
    send(win, 'desktop-lyrics-snapshot-changed', value);
  };
  function open() {
    if (disposed) return;
    if (!screenListening) {
      for (const event of ['display-removed', 'display-metrics-changed']) screen.on(event, screenChanged);
      screenListening = true;
    }
    if (win && !win.isDestroyed()) { win.showInactive(); return; }
    const target = new BrowserWindow({ ...safeBounds(store.get('DESKTOP_LYRICS_BOUNDS')),
      title: 'Folia Desktop Lyrics', frame: false, transparent: true, backgroundColor: '#00000000',
      hasShadow: false, alwaysOnTop: true, skipTaskbar: true, show: false, minWidth: 320, minHeight: 140,
      maximizable: false, fullscreenable: false,
      webPreferences: { preload: path.join(__dirname, 'desktopLyricsPreload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    win = target;
    target.setAlwaysOnTop(true, 'floating');
    target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    applyLock();
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    target.webContents.on('will-navigate', event => event.preventDefault());
    target.on('ready-to-show', () => { if (win !== target || target.isDestroyed()) return; target.showInactive(); broadcast(); publish(getSnapshot(), true); });
    target.webContents.on('did-finish-load', () => { if (win === target) publish(getSnapshot(), true); });
    for (const event of ['move', 'resize']) target.on(event, () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveBounds, 250); });
    target.on('close', saveBounds);
    target.on('closed', () => {
      clearTimeout(saveTimer);
      if (win !== target) return;
      win = null;
      if (!disposed) { state.enabled = false; store.set('DESKTOP_LYRICS', state); broadcast(); }
    });
    const loading = isDev ? target.loadURL('http://localhost:3000/desktop-lyrics.html')
      : target.loadFile(path.join(__dirname, '../dist/desktop-lyrics.html'));
    void loading.catch(() => { if (!target.isDestroyed()) target.close(); });
    broadcast();
  }
  function update(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid desktop lyrics settings');
    for (const key of Object.keys(patch)) {
      if (!['enabled', 'locked', 'fontSize', 'glowIntensity', 'resetPosition'].includes(key)) throw new Error('Unknown desktop lyrics setting');
      if (['fontSize', 'glowIntensity'].includes(key) ? !Number.isFinite(patch[key]) : typeof patch[key] !== 'boolean') throw new Error('Invalid desktop lyrics value');
    }
    state = normalizeDesktopLyricsState({ ...state, ...patch });
    store.set('DESKTOP_LYRICS', state);
    if (state.enabled) open();
    else if (win && !win.isDestroyed()) {
      // 纯展示窗口没有待保存表单；同步销毁，避免关闭中的旧窗口被立即开启操作复用。
      saveBounds();
      win.destroy();
    }
    if (patch.resetPosition) {
      const bounds = safeBounds(null);
      store.set('DESKTOP_LYRICS_BOUNDS', bounds);
      win?.setBounds(bounds);
    }
    applyLock();
    broadcast();
    return current();
  }
  const trusted = event => {
    const contents = event.sender;
    return !!event.senderFrame && event.senderFrame === contents.mainFrame && [getMainWindow(), win]
      .some(target => target && !target.isDestroyed() && target.webContents === contents);
  };
  const channels = {
    'desktop-lyrics-state': () => current(),
    'desktop-lyrics-update': (_event, patch) => update(patch),
    'desktop-lyrics-snapshot': () => projectDesktopLyricsSnapshot(getSnapshot()),
  };
  for (const [channel, handler] of Object.entries(channels)) ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error('Untrusted desktop lyrics request');
    return handler(event, ...args);
  });
  const screenChanged = () => { if (win && !win.isDestroyed()) win.setBounds(safeBounds(win.getBounds())); };
  return { state: current, update, publish,
    restore: () => { if (state.enabled) open(); },
    close: () => { if (!disposed) return update({ enabled: false }); },
    dispose: () => {
      saveBounds(); disposed = true;
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
      for (const channel of Object.keys(channels)) ipcMain.removeHandler(channel);
      for (const event of ['display-removed', 'display-metrics-changed']) screen.removeListener(event, screenChanged);
    },
  };
}
module.exports = { createDesktopLyricsController };
