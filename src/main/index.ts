// Main process entry point.
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
  MenuItemConstructorOptions,
  screen,
  session,
  shell,
  systemPreferences,
} from 'electron';
import { existsSync, mkdirSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { APP_NAME, PROJECT_EXTENSION } from '@shared/presets';
import { COPYRIGHT_YEAR, ISSUES_URL, PUBLISHER, REPO_URL, TAGLINE } from '@shared/about';
import { readFileSync } from 'fs';
import type { ContextMenuItem, DeepPartial, MenuAction, RecordingTarget, RegionContext } from '@shared/api';
import type { AppSettings, Project, RecorderCommand, RecorderStatus, Rect, ScreenSource } from '@shared/types';
import { SettingsStore } from './settings';
import { ffmpeg } from './ffmpeg';
import * as recording from './recording';
import { readProject, summary, writeProject } from './projects';
import { cancelAll, cancelExport, extractSpeechAudio, startExport } from './exporter';
import { generateNotes, hasApiKey, setApiKey } from './ai';
import { writeFileSync } from 'fs';
import { handleMediaProtocol, registerMediaScheme } from './media-protocol';
import { createAboutWindow, createControlBar, createCountdown, createMainWindow, createCaptionBar, createRecordingBorder, createRegionSelector, displayById } from './windows';

app.setName(APP_NAME);
app.setAboutPanelOptions({ applicationName: APP_NAME, copyright: `© ${COPYRIGHT_YEAR} ${PUBLISHER}`, credits: TAGLINE, website: REPO_URL });
// Lets automated tests run against an isolated profile.
if (process.env.SRA_USER_DATA) app.setPath('userData', process.env.SRA_USER_DATA);
registerMediaScheme();

// System audio capture on macOS 13+ goes through ScreenCaptureKit loopback.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');
}

let mainWindow: BrowserWindow | null = null;
let controlBar: BrowserWindow | null = null;
let countdownWin: BrowserWindow | null = null;
let borderWin: BrowserWindow | null = null;
let captionWin: BrowserWindow | null = null;
let regionWin: BrowserWindow | null = null;
let regionResolve: ((r: Rect | null) => void) | null = null;
let regionContext: RegionContext | null = null;
let settings: SettingsStore;
let captureSource: { id: string; systemAudio: boolean } | null = null;
let lastStatus: RecorderStatus = { phase: 'idle', elapsed: 0, countdown: 0, micLevel: 0 };

// One instance at a time. If a different build is launched (e.g. after installing an update while the old
// version is still running), the running copy hands over to it instead of keeping the old version on screen.
if (!app.requestSingleInstanceLock({ version: app.getVersion(), execPath: process.execPath })) {
  app.quit();
} else {
  app.on('second-instance', (_e, commandLine, _cwd, data) => {
    const other = data as { version?: string; execPath?: string } | undefined;
    if (other?.execPath && (other.version !== app.getVersion() || other.execPath !== process.execPath) && lastStatus.phase === 'idle') {
      app.relaunch({ execPath: other.execPath, args: commandLine.slice(1) });
      app.exit(0);
      return;
    }
    void ensureMainWindow();
  });
}

function sendMain(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

/** Show (or re-create) the main window. Messages wait until a freshly created window has loaded. */
function ensureMainWindow(): Promise<BrowserWindow> {
  if (process.platform === 'darwin') app.focus({ steal: true });
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return Promise.resolve(mainWindow);
  }
  const win = createMainWindow();
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    refreshMenus();
  });
  return new Promise((resolve) => win.webContents.once('did-finish-load', () => setTimeout(() => resolve(win), 400)));
}

function menuAction(action: MenuAction): void {
  void ensureMainWindow().then(() => sendMain('menu', action));
}

function openProjectFromMenu(path: string): void {
  void ensureMainWindow().then(() => sendMain('open-project-path', path));
}

function recorderCommand(cmd: RecorderCommand): void {
  // Starting needs the main window (it owns the capture); the rest go straight to it.
  if (cmd === 'toggle' && lastStatus.phase === 'idle') void ensureMainWindow().then(() => sendMain('recorder:command', cmd));
  else sendMain('recorder:command', cmd);
}

let aboutWin: BrowserWindow | null = null;
function openAbout(): void {
  if (aboutWin && !aboutWin.isDestroyed()) {
    aboutWin.show();
    aboutWin.focus();
    return;
  }
  aboutWin = createAboutWindow(mainWindow);
  aboutWin.on('closed', () => (aboutWin = null));
}

function noticesPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'THIRD_PARTY_NOTICES.md') : join(__dirname, '../../resources/THIRD_PARTY_NOTICES.md');
}

function recentMenu(): MenuItemConstructorOptions[] {
  const recent = settings.get().recentProjects.filter((p) => existsSync(p)).slice(0, 10);
  if (!recent.length) return [{ label: 'No Recent Projects', enabled: false }];
  return [
    ...recent.map((p) => ({ label: basename(p, `.${PROJECT_EXTENSION}`), click: () => openProjectFromMenu(p) })),
    { type: 'separator' },
    { label: 'Clear Menu', click: () => settings.update({ recentProjects: [] }) },
  ];
}

function recordingItems(withAccelerators: boolean): MenuItemConstructorOptions[] {
  const s = settings.get();
  const phase = lastStatus.phase;
  const active = phase !== 'idle';
  const accel = (a: string): Partial<MenuItemConstructorOptions> => (withAccelerators && a ? { accelerator: a, registerAccelerator: false } : {});
  return [
    {
      label: active ? 'Stop Recording' : 'Start Recording',
      ...accel(s.hotkeys.startStop),
      enabled: phase !== 'finishing',
      click: () => recorderCommand(active ? 'stop' : 'toggle'),
    },
    {
      label: phase === 'paused' ? 'Resume Recording' : 'Pause Recording',
      ...accel(s.hotkeys.pauseResume),
      enabled: phase === 'recording' || phase === 'paused',
      click: () => recorderCommand(phase === 'paused' ? 'resume' : 'pause'),
    },
    { label: 'Discard Recording', enabled: phase === 'recording' || phase === 'paused' || phase === 'countdown', click: () => recorderCommand('cancel') },
  ];
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const item = (label: string, action: MenuAction, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => menuAction(action),
  });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { label: `About ${APP_NAME}`, click: () => openAbout() },
              { type: 'separator' },
              item('Settings…', 'settings', 'CmdOrCtrl+,'),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        item('New Project', 'new-project', 'CmdOrCtrl+N'),
        item('Open Project…', 'open-project', 'CmdOrCtrl+O'),
        { label: 'Open Recent', submenu: recentMenu() },
        { type: 'separator' },
        item('Import Media…', 'import-media', 'CmdOrCtrl+I'),
        { type: 'separator' },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+W', role: 'close' },
        item('Save', 'save', 'CmdOrCtrl+S'),
        item('Save As…', 'save-as', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        item('Export…', 'export', 'CmdOrCtrl+E'),
        { type: 'separator' },
        { label: 'Open Recordings Folder', click: () => void shell.openPath(settings.get().recording.outputDirectory) },
        ...(isMac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, item('Settings…', 'settings', 'Ctrl+,'), { role: 'quit' } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        item('Undo', 'undo', 'CmdOrCtrl+Z'),
        item('Redo', 'redo', isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        item('Split at Playhead', 'split', 'CmdOrCtrl+B'),
      ],
    },
    {
      label: 'Record',
      submenu: [item('New Recording…', 'new-recording', 'CmdOrCtrl+R'), { type: 'separator' }, ...recordingItems(true)],
    },
    {
      label: 'View',
      submenu: [
        item('Home', 'home', 'CmdOrCtrl+1'),
        item('Recorder', 'new-recording', 'CmdOrCtrl+2'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { label: `${APP_NAME}`, accelerator: 'CmdOrCtrl+0', click: () => void ensureMainWindow() },
        ...(isMac ? [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'front' } as MenuItemConstructorOptions] : []),
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: `${APP_NAME} on GitHub`, click: () => void shell.openExternal(REPO_URL) },
        { label: 'Report an Issue…', click: () => void shell.openExternal(ISSUES_URL) },
        { label: 'Third-Party Notices', click: () => openAbout() },
        { type: 'separator' },
        { label: 'Open Recordings Folder', click: () => void shell.openPath(settings.get().recording.outputDirectory) },
        { label: 'Privacy & Security Settings…', visible: isMac, click: () => void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture') },
        ...(isMac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, { label: `About ${APP_NAME}`, click: () => openAbout() }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  if (isMac && app.dock) {
    app.dock.setMenu(
      Menu.buildFromTemplate([
        { label: 'New Recording…', click: () => menuAction('new-recording') },
        ...recordingItems(false),
        { type: 'separator' },
        { label: 'Open Recent', submenu: recentMenu() },
        { label: 'Open Recordings Folder', click: () => void shell.openPath(settings.get().recording.outputDirectory) },
      ]),
    );
  }
}

// ---- Menu bar (macOS) / system tray (Windows) icon: always there, even with no windows open ----
let tray: Tray | null = null;
let trayRecordingIcon = false;

function resourcePath(...parts: string[]): string {
  return app.isPackaged ? join(process.resourcesPath, ...parts) : join(__dirname, '../../resources', ...parts);
}

function trayIcon(recording: boolean): Electron.NativeImage {
  if (process.platform === 'darwin') {
    const img = nativeImage.createFromPath(resourcePath('tray', recording ? 'trayRecording.png' : 'trayTemplate.png'));
    img.setTemplateImage(!recording);
    return img;
  }
  return nativeImage.createFromPath(resourcePath('icon.png')).resize({ width: 16, height: 16 });
}

function buildTrayMenu(): void {
  if (!tray) return;
  const phase = lastStatus.phase;
  const status =
    phase === 'idle'
      ? []
      : [
          {
            label: phase === 'countdown' ? 'Starting…' : phase === 'finishing' ? 'Saving recording…' : `${phase === 'paused' ? 'Paused' : 'Recording'} · ${clock(lastStatus.elapsed)}`,
            enabled: false,
          } as MenuItemConstructorOptions,
          { type: 'separator' } as MenuItemConstructorOptions,
        ];
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...status,
      ...recordingItems(false),
      { label: 'New Recording…', enabled: phase === 'idle', click: () => menuAction('new-recording') },
      { type: 'separator' },
      { label: `Open ${APP_NAME}`, click: () => void ensureMainWindow() },
      { label: 'Open Project…', click: () => menuAction('open-project') },
      { label: 'Open Recent', submenu: recentMenu() },
      { label: 'Open Recordings Folder', click: () => void shell.openPath(settings.get().recording.outputDirectory) },
      { type: 'separator' },
      { label: 'Settings…', click: () => menuAction('settings') },
      { label: `About ${APP_NAME}`, click: () => openAbout() },
      { label: `Quit ${APP_NAME}`, role: 'quit' },
    ]),
  );
}

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function createTray(): void {
  tray = new Tray(trayIcon(false));
  tray.setToolTip(APP_NAME);
  if (process.platform === 'win32') tray.on('click', () => void ensureMainWindow());
  buildTrayMenu();
}

let lastMenuPhase = '';
/** Rebuild menus when recording state or recent projects change. */
function refreshMenus(): void {
  if (lastMenuPhase !== lastStatus.phase) {
    lastMenuPhase = lastStatus.phase;
    buildMenu();
  }
  if (!tray) return;
  const recording = lastStatus.phase === 'recording' || lastStatus.phase === 'paused';
  if (recording !== trayRecordingIcon) {
    trayRecordingIcon = recording;
    tray.setImage(trayIcon(recording));
  }
  if (process.platform === 'darwin') tray.setTitle(recording ? ` ${clock(lastStatus.elapsed)}` : '', { fontType: 'monospacedDigit' });
  buildTrayMenu();
}

function registerShortcuts(s: AppSettings): void {
  globalShortcut.unregisterAll();
  const bind = (accel: string, cmd: () => RecorderCommand) => {
    if (!accel) return;
    try {
      if (!globalShortcut.register(accel, () => recorderCommand(cmd()))) console.warn(`Shortcut ${accel} is taken`);
    } catch (err) {
      console.warn(`Invalid shortcut ${accel}:`, err);
    }
  };
  bind(s.hotkeys.startStop, () => 'toggle');
  bind(s.hotkeys.pauseResume, () => (lastStatus.phase === 'paused' ? 'resume' : 'pause'));
}

function updateRecorderWindows(status: RecorderStatus, target?: RecordingTarget): void {
  const prev = lastStatus.phase;
  const prevSecond = Math.floor(lastStatus.elapsed);
  lastStatus = status;
  if (prev !== status.phase || prevSecond !== Math.floor(status.elapsed)) refreshMenus();
  const active = status.phase !== 'idle';
  const display = displayById(target?.displayId);
  // Red frame around what is being recorded (screens and areas; window bounds aren't known for window capture).
  const wantBorder = (status.phase === 'recording' || status.phase === 'paused') && target?.kind === 'screen' && settings.get().recording.showBorder;
  if (wantBorder && (!borderWin || borderWin.isDestroyed())) {
    borderWin = createRecordingBorder(display, target!.region);
    borderWin.on('closed', () => (borderWin = null));
  }
  if (!wantBorder && borderWin && !borderWin.isDestroyed()) borderWin.close();
  const wantCaptions = (status.phase === 'recording' || status.phase === 'paused') && !!status.captionsActive;
  if (wantCaptions && (!captionWin || captionWin.isDestroyed())) {
    captionWin = createCaptionBar(display);
    captionWin.on('closed', () => (captionWin = null));
  }
  if (!wantCaptions && captionWin && !captionWin.isDestroyed()) captionWin.close();
  if (active && (!controlBar || controlBar.isDestroyed())) {
    controlBar = createControlBar(display);
    controlBar.on('closed', () => (controlBar = null));
  }
  if (status.phase === 'countdown' && (!countdownWin || countdownWin.isDestroyed())) {
    countdownWin = createCountdown(display);
    countdownWin.on('closed', () => (countdownWin = null));
  }
  if (status.phase !== 'countdown' && countdownWin && !countdownWin.isDestroyed()) countdownWin.close();
  if (!active && controlBar && !controlBar.isDestroyed()) controlBar.close();

  for (const w of [controlBar, countdownWin, borderWin, captionWin]) if (w && !w.isDestroyed()) w.webContents.send('recorder:status', status);

  const hide = settings.get().recording.hideMainWindow;
  if (hide && mainWindow) {
    if (prev === 'idle' && active) mainWindow.hide();
    if (prev !== 'idle' && !active) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
  if (process.platform === 'darwin') {
    app.dock?.setBadge(status.phase === 'recording' ? '●' : status.phase === 'paused' ? '❚❚' : '');
  }
}

function permissionStatus() {
  const get = (k: 'screen' | 'microphone' | 'camera') =>
    process.platform === 'darwin' || process.platform === 'win32' ? systemPreferences.getMediaAccessStatus(k) : 'granted';
  return { screen: get('screen'), microphone: get('microphone'), camera: get('camera') };
}

function setupIpc(): void {
  // ---- Settings ----
  const withAi = (s: AppSettings): AppSettings => ({ ...s, ai: { ...s.ai, hasApiKey: hasApiKey() } });
  ipcMain.handle('settings:get', () => withAi(settings.get()));
  ipcMain.handle('settings:update', (_e, patch: DeepPartial<AppSettings>) => {
    const s = settings.update(patch);
    if (patch.hotkeys) registerShortcuts(s);
    if (patch.ffmpegPath !== undefined) ffmpeg.configure(s.ffmpegPath);
    return withAi(s);
  });
  ipcMain.handle('settings:reset', () => {
    const s = settings.reset();
    registerShortcuts(s);
    ffmpeg.configure(s.ffmpegPath);
    return withAi(s);
  });

  // ---- AI ----
  ipcMain.handle('ai:set-key', (_e, key: string | null) => {
    setApiKey(key);
    return withAi(settings.get());
  });
  ipcMain.handle('ai:notes', (_e, input: { title: string; transcript: string; durationSec: number }) => generateNotes(input));
  ipcMain.handle('ai:speech-audio', (_e, project: Project) => extractSpeechAudio(project));
  ipcMain.handle('file:save-text', async (e, defaultName: string, ext: string, content: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: join(settings.get().recording.outputDirectory, `${defaultName}.${ext}`),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (r.canceled || !r.filePath) return null;
    const path = extname(r.filePath) ? r.filePath : `${r.filePath}.${ext}`;
    writeFileSync(path, content, 'utf8');
    return path;
  });
  ipcMain.handle('dialog:directory', async (e, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win!, { defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('ffmpeg:info', () => ffmpeg.getInfo());

  // ---- Capture ----
  ipcMain.handle('capture:sources', async (): Promise<ScreenSource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 400, height: 250 },
      fetchWindowIcons: true,
    });
    const displays = screen.getAllDisplays();
    const ownTitles = new Set(BrowserWindow.getAllWindows().map((w) => w.getTitle()));
    return sources
      .filter((s) => s.id.startsWith('screen:') || (!ownTitles.has(s.name) && s.name !== APP_NAME))
      .map((s) => {
        const isScreen = s.id.startsWith('screen:');
        const display = isScreen ? displays.find((d) => String(d.id) === s.display_id) : undefined;
        return {
          id: s.id,
          name: isScreen ? (displays.length > 1 ? s.name : 'Entire screen') : s.name,
          thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
          displayId: s.display_id,
          appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined,
          kind: isScreen ? 'screen' : 'window',
          bounds: display ? { x: display.bounds.x, y: display.bounds.y, w: display.bounds.width, h: display.bounds.height } : undefined,
          scaleFactor: display?.scaleFactor,
        } satisfies ScreenSource;
      });
  });
  ipcMain.handle('capture:set-source', (_e, id: string, systemAudio: boolean) => {
    captureSource = { id, systemAudio };
  });
  ipcMain.handle('capture:select-region', (_e, displayId: string) => {
    return new Promise<Rect | null>((resolve) => {
      regionResolve?.(null);
      regionWin?.close();
      const display = displayById(displayId);
      regionContext = {
        displayId: String(display.id),
        bounds: { x: display.bounds.x, y: display.bounds.y, w: display.bounds.width, h: display.bounds.height },
      };
      regionResolve = resolve;
      regionWin = createRegionSelector(display);
      regionWin.on('closed', () => {
        regionWin = null;
        regionResolve?.(null);
        regionResolve = null;
      });
    });
  });
  ipcMain.handle('region:context', () => regionContext);
  ipcMain.on('region:done', (_e, rect: Rect | null) => {
    regionResolve?.(rect);
    regionResolve = null;
    regionWin?.close();
    mainWindow?.focus();
  });

  ipcMain.handle('permissions:get', () => permissionStatus());
  ipcMain.handle('permissions:request', async (_e, kind: 'microphone' | 'camera') => {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.askForMediaAccess(kind);
  });
  ipcMain.handle('permissions:open-settings', (_e, kind: 'screen' | 'microphone' | 'camera') => {
    if (process.platform === 'darwin') {
      const pane = kind === 'screen' ? 'Privacy_ScreenCapture' : kind === 'microphone' ? 'Privacy_Microphone' : 'Privacy_Camera';
      return shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
    }
    if (process.platform === 'win32') {
      return shell.openExternal(kind === 'camera' ? 'ms-settings:privacy-webcam' : 'ms-settings:privacy-microphone');
    }
    return undefined;
  });

  // ---- Recording files ----
  ipcMain.handle('rec:new-session', () => {
    const dir = settings.get().recording.outputDirectory;
    mkdirSync(dir, { recursive: true });
    return recording.newSession(dir);
  });
  ipcMain.handle('rec:begin', (_e, dir: string, role, mime: string) => recording.begin(dir, role, mime));
  ipcMain.handle('rec:chunk', (_e, id: string, data: ArrayBuffer) => recording.chunk(id, data));
  ipcMain.handle('rec:end', (_e, id: string) => recording.end(id));
  ipcMain.handle('rec:discard', (_e, dir: string) => recording.discardSession(dir));
  ipcMain.on('recorder:status', (_e, status: RecorderStatus, target?: RecordingTarget) => updateRecorderWindows(status, target));
  ipcMain.on('recorder:command', (_e, cmd: RecorderCommand) => recorderCommand(cmd));

  // ---- Media ----
  ipcMain.handle('media:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (r.canceled) return [];
    const out = [];
    for (const p of r.filePaths) {
      try {
        out.push(await ffmpeg.assetFromFile(p));
      } catch (err) {
        dialog.showErrorBox('Import failed', (err as Error).message);
      }
    }
    return out;
  });
  ipcMain.handle('media:probe', (_e, path: string) => ffmpeg.assetFromFile(path));

  // ---- Projects ----
  ipcMain.handle('project:save', async (e, project: Project, path: string | null) => {
    let target = path;
    if (!target) {
      const win = BrowserWindow.fromWebContents(e.sender);
      const projectsDir = join(settings.get().recording.outputDirectory, 'Projects');
      mkdirSync(projectsDir, { recursive: true });
      const r = await dialog.showSaveDialog(win!, {
        defaultPath: join(projectsDir, `${project.name}.${PROJECT_EXTENSION}`),
        filters: [{ name: `${APP_NAME} Project`, extensions: [PROJECT_EXTENSION] }],
      });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath.endsWith(`.${PROJECT_EXTENSION}`) ? r.filePath : `${r.filePath}.${PROJECT_EXTENSION}`;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeProject(project, target);
    settings.addRecent(target);
    app.addRecentDocument(target);
    return target;
  });
  ipcMain.handle('project:open-dialog', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win!, {
      defaultPath: settings.get().recording.outputDirectory,
      properties: ['openFile'],
      filters: [{ name: `${APP_NAME} Project`, extensions: [PROJECT_EXTENSION] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const path = r.filePaths[0];
    settings.addRecent(path);
    return { project: readProject(path), path };
  });
  ipcMain.handle('project:load', (_e, path: string) => {
    const project = readProject(path);
    settings.addRecent(path);
    return { project, path };
  });
  ipcMain.handle('project:recent', () => {
    const list = settings.get().recentProjects.filter((p) => existsSync(p));
    return list.map(summary).filter(Boolean);
  });
  ipcMain.handle('project:remove-recent', (_e, path: string) => settings.removeRecent(path));

  // ---- Export ----
  ipcMain.handle('export:choose-path', async (e, defaultName: string, ext: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const dir = settings.get().recording.outputDirectory;
    mkdirSync(dir, { recursive: true });
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: join(dir, `${defaultName}.${ext}`),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (r.canceled || !r.filePath) return null;
    return extname(r.filePath) ? r.filePath : `${r.filePath}.${ext}`;
  });
  ipcMain.handle('export:start', (e, req) => startExport(req, e.sender));
  ipcMain.handle('export:cancel', (_e, jobId: string) => cancelExport(jobId));

  // ---- About ----
  ipcMain.handle('about:info', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    tagline: TAGLINE,
    publisher: PUBLISHER,
    copyright: `© ${COPYRIGHT_YEAR} ${PUBLISHER}`,
    repo: REPO_URL,
    issues: ISSUES_URL,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    os: `${process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'} ${process.getSystemVersion()} (${process.arch})`,
    ffmpeg: ffmpeg.getInfo(),
  }));
  ipcMain.handle('about:notices', () => {
    try {
      return readFileSync(noticesPath(), 'utf8');
    } catch {
      return 'Third-party notices are missing from this build.';
    }
  });
  ipcMain.handle('shell:external', (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
    return undefined;
  });
  ipcMain.on('about:open', () => openAbout());

  // ---- Native context menus ----
  ipcMain.handle('menu:popup', (e, items: ContextMenuItem[]) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return new Promise<string | null>((resolve) => {
      let chosen: string | null = null;
      const build = (list: ContextMenuItem[]): MenuItemConstructorOptions[] =>
        list.map((it) =>
          it.type === 'separator'
            ? { type: 'separator' }
            : {
                label: it.label,
                enabled: it.enabled !== false,
                type: it.checked !== undefined ? 'checkbox' : 'normal',
                checked: it.checked,
                accelerator: it.accelerator,
                registerAccelerator: false,
                submenu: it.submenu ? build(it.submenu) : undefined,
                click: it.submenu ? undefined : () => (chosen = it.id ?? null),
              },
        );
      Menu.buildFromTemplate(build(items)).popup({ window: win ?? undefined, callback: () => setTimeout(() => resolve(chosen), 0) });
    });
  });

  // ---- Shell ----
  ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p));
  ipcMain.handle('shell:open', async (_e, p: string) => {
    // Folders (like the recordings folder) are created if missing; files are opened in their default app.
    if (!existsSync(p)) {
      if (extname(p)) throw new Error(`File not found: ${p}`);
      mkdirSync(p, { recursive: true });
    }
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
  });
  ipcMain.handle('recorder:last-status', () => lastStatus);
  ipcMain.on('window:edited', (e, edited: boolean) => {
    BrowserWindow.fromWebContents(e.sender)?.setDocumentEdited(edited);
  });
}

function setupDisplayMedia(): void {
  // getDisplayMedia() in the renderer is answered with the source the user picked in our own UI.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
        const source = sources.find((s) => s.id === captureSource?.id) ?? sources.find((s) => s.id.startsWith('screen:'));
        if (!source) return callback({});
        const wantAudio = !!captureSource?.systemAudio && request.audioRequested;
        callback(wantAudio ? { video: source, audio: 'loopback' } : { video: source });
      } catch (err) {
        console.error('Display media request failed:', err);
        callback({});
      }
    },
    { useSystemPicker: false },
  );
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'display-capture', 'fullscreen', 'clipboard-sanitized-write'].includes(permission));
  });
}

app.whenReady().then(() => {
  settings = new SettingsStore();
  const s = settings.get();
  ffmpeg.configure(s.ffmpegPath);
  mkdirSync(s.recording.outputDirectory, { recursive: true });
  handleMediaProtocol();
  setupDisplayMedia();
  setupIpc();
  buildMenu();
  createTray();
  settings.onChange(() => {
    buildMenu();
    buildTrayMenu();
  });
  registerShortcuts(s);
  void ensureMainWindow();

  // Clicking the Dock icon brings the window back after it was closed.
  app.on('activate', () => void ensureMainWindow());
});

app.on('open-file', (e, path) => {
  e.preventDefault();
  if (basename(path).endsWith(`.${PROJECT_EXTENSION}`)) {
    if (app.isReady()) openProjectFromMenu(path);
    else app.once('ready', () => setTimeout(() => openProjectFromMenu(path), 500));
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  cancelAll();
});
