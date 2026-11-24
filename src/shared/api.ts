// The API the preload script exposes to the renderer as `window.api`.
import type {
  AppSettings,
  ExportProgress,
  ExportRequest,
  FFmpegInfo,
  MediaAsset,
  PermissionStatus,
  Project,
  ProjectSummary,
  RecordedTrackInfo,
  RecorderCommand,
  RecorderStatus,
  Rect,
  ScreenSource,
} from './types';

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export type MenuAction =
  | 'new-recording'
  | 'new-project'
  | 'open-project'
  | 'import-media'
  | 'save'
  | 'save-as'
  | 'export'
  | 'undo'
  | 'redo'
  | 'split'
  | 'delete'
  | 'settings'
  | 'home';

/** What is being recorded, so the main process can frame it with a border. */
export interface RecordingTarget {
  displayId: string;
  kind: 'screen' | 'window';
  /** Normalised area of the display, or null for the whole display. */
  region: Rect | null;
}

export interface AboutInfo {
  name: string;
  version: string;
  tagline: string;
  publisher: string;
  copyright: string;
  repo: string;
  issues: string;
  electron: string;
  chrome: string;
  node: string;
  os: string;
  ffmpeg: FFmpegInfo;
}

export interface ContextMenuItem {
  id?: string;
  label?: string;
  type?: 'separator';
  enabled?: boolean;
  checked?: boolean;
  accelerator?: string;
  submenu?: ContextMenuItem[];
}

export interface RegionContext {
  displayId: string;
  bounds: Rect;
}

export interface DesktopAPI {
  platform: string;

  // Settings
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: DeepPartial<AppSettings>): Promise<AppSettings>;
  resetSettings(): Promise<AppSettings>;
  chooseDirectory(defaultPath?: string): Promise<string | null>;
  ffmpegInfo(): Promise<FFmpegInfo>;

  // AI
  setApiKey(key: string | null): Promise<AppSettings>;
  generateNotes(input: { title: string; transcript: string; durationSec: number }): Promise<string>;
  /** Timeline audio as mono 16 kHz Float32 PCM. */
  speechAudio(project: Project): Promise<ArrayBuffer>;
  saveTextFile(defaultName: string, extension: string, content: string): Promise<string | null>;

  // Capture setup
  getSources(): Promise<ScreenSource[]>;
  setCaptureSource(sourceId: string, systemAudio: boolean): Promise<void>;
  selectRegion(displayId: string): Promise<Rect | null>;
  permissions(): Promise<PermissionStatus>;
  requestPermission(kind: 'microphone' | 'camera'): Promise<boolean>;
  openPermissionSettings(kind: 'screen' | 'microphone' | 'camera'): Promise<void>;

  // Recording files (renderer streams MediaRecorder chunks to disk)
  recNewSession(): Promise<{ dir: string; name: string }>;
  recBegin(dir: string, role: RecordedTrackInfo['role'], mimeType: string): Promise<string>;
  recChunk(id: string, data: ArrayBuffer): Promise<void>;
  recEnd(id: string): Promise<RecordedTrackInfo>;
  recDiscardSession(dir: string): Promise<void>;

  // Recorder status/command relay between the main window, control bar and global shortcuts
  setRecorderStatus(status: RecorderStatus, target?: RecordingTarget): void;
  onRecorderStatus(cb: (s: RecorderStatus) => void): () => void;
  lastRecorderStatus(): Promise<RecorderStatus>;
  sendRecorderCommand(cmd: RecorderCommand): void;
  onRecorderCommand(cb: (cmd: RecorderCommand) => void): () => void;

  // Region selector window
  getRegionContext(): Promise<RegionContext>;
  regionDone(rect: Rect | null): void;

  // Media
  importMediaDialog(): Promise<MediaAsset[]>;
  probeMedia(path: string): Promise<MediaAsset>;
  mediaUrl(path: string): string;
  pathForFile(file: File): string;

  // Projects
  saveProject(project: Project, path: string | null): Promise<string | null>;
  openProjectDialog(): Promise<{ project: Project; path: string } | null>;
  loadProject(path: string): Promise<{ project: Project; path: string }>;
  recentProjects(): Promise<ProjectSummary[]>;
  removeRecentProject(path: string): Promise<void>;

  // Export
  chooseExportPath(defaultName: string, extension: string): Promise<string | null>;
  startExport(req: ExportRequest): Promise<string>;
  cancelExport(jobId: string): Promise<void>;
  onExportProgress(cb: (p: ExportProgress) => void): () => void;

  // Shell
  revealInFolder(path: string): Promise<void>;
  openPath(path: string): Promise<void>;
  onMenu(cb: (action: MenuAction) => void): () => void;
  /** Show a native context menu; resolves with the chosen item's id (or null). */
  contextMenu(items: ContextMenuItem[]): Promise<string | null>;
  onOpenProjectPath(cb: (path: string) => void): () => void;
  setDocumentEdited(edited: boolean): void;
  aboutInfo(): Promise<AboutInfo>;
  thirdPartyNotices(): Promise<string>;
  openExternal(url: string): Promise<void>;
  openAbout(): void;
  relaunch(): void;
}
