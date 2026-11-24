// Window creation helpers.
import { app, BrowserWindow, BrowserWindowConstructorOptions, dialog, Display, Menu, screen, shell } from 'electron';
import { join } from 'path';

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

export function loadRoute(win: BrowserWindow, route: string): void {
  if (isDev) void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`);
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route });
}

function secure(win: BrowserWindow): BrowserWindow {
  // Standard right-click menu for text fields (Electron has none by default).
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const menu = Menu.buildFromTemplate(
      params.isEditable
        ? [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' }]
        : [{ role: 'copy' }],
    );
    menu.popup({ window: win });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'file://')) e.preventDefault();
  });
  return win;
}

const webPreferences = (): BrowserWindowConstructorOptions['webPreferences'] => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false,
});

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0d12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: webPreferences(),
  });
  win.once('ready-to-show', () => {
    win.show();
    // Make sure the app (and so its menu bar) becomes active, not just the window.
    if (process.platform === 'darwin') app.focus({ steal: true });
    win.focus();
  });
  // The renderer blocks unload while there are unsaved changes; confirm here instead of silently refusing to close.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Discard changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes or a recording in progress.',
      detail: 'Close anyway? Unsaved edits will be lost.',
    });
    if (choice === 0) e.preventDefault();
  });
  loadRoute(win, '/');
  return secure(win);
}

/** Small floating recording toolbar. Content protection keeps it out of the recording. */
export function createControlBar(display: Display): BrowserWindow {
  const width = 300;
  const height = 52;
  const { x, y, width: dw } = display.workArea;
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(x + dw / 2 - width / 2),
    y: y + 12,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    show: false,
    webPreferences: webPreferences(),
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.setContentProtection(true);
  win.once('ready-to-show', () => win.showInactive());
  loadRoute(win, '/controlbar');
  return secure(win);
}

export function createCountdown(display: Display): BrowserWindow {
  const size = 220;
  const { x, y, width, height } = display.bounds;
  const win = new BrowserWindow({
    width: size,
    height: size,
    x: Math.round(x + width / 2 - size / 2),
    y: Math.round(y + height / 2 - size / 2),
    frame: false,
    transparent: true,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: webPreferences(),
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setContentProtection(true);
  win.once('ready-to-show', () => win.showInactive());
  loadRoute(win, '/countdown');
  return secure(win);
}

/** Full-screen transparent overlay used to drag out a recording region. */
export function createRegionSelector(display: Display): BrowserWindow {
  const { x, y, width, height } = display.bounds;
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    hasShadow: false,
    show: false,
    webPreferences: webPreferences(),
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  loadRoute(win, '/region');
  return secure(win);
}

/**
 * Click-through red frame drawn just outside the recorded area. Content protection keeps it out of the video;
 * for full-screen recordings it sits on the screen edge.
 */
export function createRecordingBorder(display: Display, region: { x: number; y: number; w: number; h: number } | null): BrowserWindow {
  const pad = 4;
  const b = display.bounds;
  const r = region
    ? {
        x: Math.round(b.x + region.x * b.width) - pad,
        y: Math.round(b.y + region.y * b.height) - pad,
        width: Math.round(region.w * b.width) + pad * 2,
        height: Math.round(region.h * b.height) + pad * 2,
      }
    : { x: b.x, y: b.y, width: b.width, height: b.height };
  const win = new BrowserWindow({
    ...r,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    show: false,
    webPreferences: webPreferences(),
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.setContentProtection(true);
  win.once('ready-to-show', () => win.showInactive());
  loadRoute(win, '/border');
  return secure(win);
}

/** Live caption strip near the bottom of the recorded display (kept out of the recording). */
export function createCaptionBar(display: Display): BrowserWindow {
  const width = Math.min(900, display.workArea.width - 80);
  const height = 96;
  const { x, y, width: dw, height: dh } = display.workArea;
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(x + (dw - width) / 2),
    y: Math.round(y + dh - height - 24),
    frame: false,
    transparent: true,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: webPreferences(),
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.setContentProtection(true);
  win.once('ready-to-show', () => win.showInactive());
  loadRoute(win, '/captions');
  return secure(win);
}

export function createAboutWindow(parent?: BrowserWindow | null): BrowserWindow {
  const win = new BrowserWindow({
    width: 460,
    height: 610,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'About',
    show: false,
    backgroundColor: '#0b0d12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    parent: process.platform === 'darwin' ? undefined : (parent ?? undefined),
    webPreferences: webPreferences(),
  });
  win.once('ready-to-show', () => win.show());
  loadRoute(win, '/about');
  return secure(win);
}

export function displayById(id: string | undefined): Display {
  return screen.getAllDisplays().find((d) => String(d.id) === String(id)) ?? screen.getPrimaryDisplay();
}
