// Types shared by the main process, preload and renderer.
// All times are in seconds. All positions/sizes inside a project are normalised (0..1)
// relative to the project canvas, so a project can be exported at any resolution.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AssetKind = 'video' | 'audio' | 'image';
/** What a recorded asset came from. Camera clips are composited above zooms. */
export type AssetRole = 'screen' | 'camera' | 'microphone' | 'imported';

export interface MediaAsset {
  id: string;
  name: string;
  path: string;
  kind: AssetKind;
  role: AssetRole;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasVideo: boolean;
  /** Optional crop applied to the source before it is placed (region recordings). */
  crop?: Rect;
  createdAt: number;
}

export interface Clip {
  id: string;
  assetId: string;
  /** Position on the timeline. */
  start: number;
  /** Source in/out points. Clip length on the timeline is out - in. */
  in: number;
  out: number;
  volume: number;
  muted: boolean;
  opacity: number;
  /** Where the clip is drawn on the canvas (normalised). */
  transform: Rect;
}

export type TrackKind = 'video' | 'audio';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  clips: Clip[];
}

export type AnnotationType =
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'highlight'
  | 'spotlight'
  | 'blur'
  | 'step';

export interface Annotation {
  id: string;
  type: AnnotationType;
  start: number;
  end: number;
  /** Bounding box. For arrows the arrow runs from (x,y) to (x+w, y+h); w/h may be negative. */
  box: Rect;
  color: string;
  strokeWidth: number;
  text: string;
  /** Font size as a fraction of canvas height. */
  fontSize: number;
  fill: boolean;
}

export interface ZoomRegion {
  id: string;
  start: number;
  end: number;
  scale: number;
  /** Zoom centre (normalised). */
  cx: number;
  cy: number;
  /** Seconds spent easing in and out. */
  ease: number;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  width: number;
  height: number;
  fps: number;
  background: string;
  assets: MediaAsset[];
  /** Ordered top (index 0) to bottom, like the timeline UI. */
  tracks: Track[];
  annotations: Annotation[];
  zooms: ZoomRegion[];
  /** Transcript segments on the project timeline. */
  captions?: CaptionSegment[];
  /** Draw captions into the preview and exported video. */
  burnCaptions?: boolean;
  /** Markdown notes (AI-generated or typed). */
  notes?: string;
}

export interface CaptionSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface ProjectSummary {
  path: string;
  name: string;
  updatedAt: number;
  duration: number;
  thumbnail?: string;
}

// ---------- Recording ----------

export type RecordingQuality = 'standard' | 'high' | 'max';

export interface RecordingSettings {
  outputDirectory: string;
  fps: 24 | 30 | 60;
  quality: RecordingQuality;
  /** Downscale the capture to at most this height (0 = native resolution). */
  maxHeight: 0 | 1080 | 1440 | 2160;
  countdown: number;
  systemAudio: boolean;
  microphone: boolean;
  microphoneDeviceId: string;
  noiseSuppression: boolean;
  camera: boolean;
  cameraDeviceId: string;
  hideMainWindow: boolean;
  /** Show a red frame around the recorded area. */
  showBorder: boolean;
  openEditorAfterRecording: boolean;
  /** Transcribe speech while recording. */
  liveCaptions: boolean;
}

export interface HotkeySettings {
  startStop: string;
  pauseResume: string;
}

export interface AiSettings {
  /** Whisper model used for captions. */
  captionModel: 'onnx-community/whisper-base' | 'onnx-community/whisper-small' | 'onnx-community/whisper-tiny';
  /** Spoken language, or 'auto'. */
  language: string;
  /** Generate notes automatically when a recording with captions finishes (needs an API key). */
  autoNotes: boolean;
  /** True when an Anthropic API key is stored (the key itself never leaves the main process). */
  hasApiKey: boolean;
}

export interface AppSettings {
  recording: RecordingSettings;
  hotkeys: HotkeySettings;
  ffmpegPath: string;
  theme: 'dark' | 'light';
  ai: AiSettings;
  recentProjects: string[];
}

export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  displayId: string;
  appIcon?: string;
  kind: 'screen' | 'window';
  /** Display bounds in DIPs (screens only). */
  bounds?: Rect;
  scaleFactor?: number;
}

export type RecorderPhase = 'idle' | 'countdown' | 'recording' | 'paused' | 'finishing';

export interface RecorderStatus {
  phase: RecorderPhase;
  elapsed: number;
  countdown: number;
  micLevel: number;
  /** Latest live caption line, when live captions are on. */
  caption?: string;
  captionsActive?: boolean;
  /** Speech chunks still waiting for transcription. */
  captionBacklog?: number;
}

export type RecorderCommand = 'toggle' | 'pause' | 'resume' | 'stop' | 'cancel';

export interface RecordedTrackInfo {
  id: string;
  role: AssetRole;
  path: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

// ---------- Export ----------

export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'mov' | 'm4a';
export type VideoCodec = 'h264' | 'hevc' | 'vp9' | 'gif' | 'prores' | 'none';

export interface ExportPreset {
  id: string;
  name: string;
  description: string;
  format: ExportFormat;
  codec: VideoCodec;
  /** Output height. 0 keeps the project size. Width follows the project aspect ratio. */
  height: number;
  fps: number;
  /** Quality 0-100; mapped to CRF/bitrate per codec. */
  quality: number;
  audioBitrate: number;
}

export interface ExportRequest {
  project: Project;
  preset: ExportPreset;
  outputPath: string;
  /** PNG data URLs of rendered annotations, keyed by annotation id. */
  annotationImages: Record<string, string>;
  /** Burned-in captions: one full-canvas PNG data URL per segment plus a transparent blank frame. */
  captions?: { segments: { start: number; end: number }[]; images: string[]; blank: string };
  hardwareAcceleration: boolean;
}

export interface ExportProgress {
  jobId: string;
  percent: number;
  stage: 'preparing' | 'encoding' | 'done' | 'error' | 'cancelled';
  message?: string;
  outputPath?: string;
}

export interface FFmpegInfo {
  path: string;
  version: string;
  source: 'custom' | 'system' | 'bundled' | 'missing';
  encoders: string[];
}

export interface PermissionStatus {
  screen: string;
  microphone: string;
  camera: string;
}
