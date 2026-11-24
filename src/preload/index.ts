// Preload: exposes a narrow, typed API to the sandboxed renderer.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopAPI } from '@shared/api';

function listen<T>(channel: string, cb: (v: T) => void): () => void {
  const fn = (_e: Electron.IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.off(channel, fn);
}

const api: DesktopAPI = {
  platform: process.platform,

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  chooseDirectory: (defaultPath) => ipcRenderer.invoke('dialog:directory', defaultPath),
  ffmpegInfo: () => ipcRenderer.invoke('ffmpeg:info'),

  setApiKey: (key) => ipcRenderer.invoke('ai:set-key', key),
  generateNotes: (input) => ipcRenderer.invoke('ai:notes', input),
  speechAudio: (project) => ipcRenderer.invoke('ai:speech-audio', project),
  saveTextFile: (name, ext, content) => ipcRenderer.invoke('file:save-text', name, ext, content),

  getSources: () => ipcRenderer.invoke('capture:sources'),
  setCaptureSource: (id, systemAudio) => ipcRenderer.invoke('capture:set-source', id, systemAudio),
  selectRegion: (displayId) => ipcRenderer.invoke('capture:select-region', displayId),
  permissions: () => ipcRenderer.invoke('permissions:get'),
  requestPermission: (kind) => ipcRenderer.invoke('permissions:request', kind),
  openPermissionSettings: (kind) => ipcRenderer.invoke('permissions:open-settings', kind),

  recNewSession: () => ipcRenderer.invoke('rec:new-session'),
  recBegin: (dir, role, mime) => ipcRenderer.invoke('rec:begin', dir, role, mime),
  recChunk: (id, data) => ipcRenderer.invoke('rec:chunk', id, data),
  recEnd: (id) => ipcRenderer.invoke('rec:end', id),
  recDiscardSession: (dir) => ipcRenderer.invoke('rec:discard', dir),

  setRecorderStatus: (status, target) => ipcRenderer.send('recorder:status', status, target),
  onRecorderStatus: (cb) => listen('recorder:status', cb),
  lastRecorderStatus: () => ipcRenderer.invoke('recorder:last-status'),
  sendRecorderCommand: (cmd) => ipcRenderer.send('recorder:command', cmd),
  onRecorderCommand: (cb) => listen('recorder:command', cb),

  getRegionContext: () => ipcRenderer.invoke('region:context'),
  regionDone: (rect) => ipcRenderer.send('region:done', rect),

  importMediaDialog: () => ipcRenderer.invoke('media:import'),
  probeMedia: (path) => ipcRenderer.invoke('media:probe', path),
  mediaUrl: (path) => `media://local/${encodeURIComponent(path)}`,
  pathForFile: (file) => webUtils.getPathForFile(file),

  saveProject: (project, path) => ipcRenderer.invoke('project:save', project, path),
  openProjectDialog: () => ipcRenderer.invoke('project:open-dialog'),
  loadProject: (path) => ipcRenderer.invoke('project:load', path),
  recentProjects: () => ipcRenderer.invoke('project:recent'),
  removeRecentProject: (path) => ipcRenderer.invoke('project:remove-recent', path),

  chooseExportPath: (name, ext) => ipcRenderer.invoke('export:choose-path', name, ext),
  startExport: (req) => ipcRenderer.invoke('export:start', req),
  cancelExport: (jobId) => ipcRenderer.invoke('export:cancel', jobId),
  onExportProgress: (cb) => listen('export:progress', cb),

  revealInFolder: (p) => ipcRenderer.invoke('shell:reveal', p),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  onMenu: (cb) => listen('menu', cb),
  contextMenu: (items) => ipcRenderer.invoke('menu:popup', items),
  onOpenProjectPath: (cb) => listen('open-project-path', cb),
  setDocumentEdited: (edited) => ipcRenderer.send('window:edited', edited),
  aboutInfo: () => ipcRenderer.invoke('about:info'),
  thirdPartyNotices: () => ipcRenderer.invoke('about:notices'),
  openExternal: (url) => ipcRenderer.invoke('shell:external', url),
  openAbout: () => ipcRenderer.send('about:open'),
  relaunch: () => ipcRenderer.send('app:relaunch'),
};

contextBridge.exposeInMainWorld('api', api);
