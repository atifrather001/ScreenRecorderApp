import type { AppSettings, ExportPreset } from './types';

export const APP_NAME = 'ScreenRecorderApp';
export const PROJECT_EXTENSION = 'srproj';

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'mp4-1080',
    name: 'MP4 · 1080p',
    description: 'H.264, good for YouTube, Vimeo and most players',
    format: 'mp4',
    codec: 'h264',
    height: 1080,
    fps: 30,
    quality: 75,
    audioBitrate: 192,
  },
  {
    id: 'mp4-720',
    name: 'MP4 · 720p',
    description: 'Smaller H.264 file for chat and email',
    format: 'mp4',
    codec: 'h264',
    height: 720,
    fps: 30,
    quality: 65,
    audioBitrate: 128,
  },
  {
    id: 'mp4-source',
    name: 'MP4 · Project size',
    description: 'H.264 at the full project resolution and frame rate',
    format: 'mp4',
    codec: 'h264',
    height: 0,
    fps: 0,
    quality: 85,
    audioBitrate: 256,
  },
  {
    id: 'mp4-hevc',
    name: 'MP4 · HEVC (H.265)',
    description: 'About half the size of H.264 at the same quality',
    format: 'mp4',
    codec: 'hevc',
    height: 0,
    fps: 0,
    quality: 75,
    audioBitrate: 192,
  },
  {
    id: 'webm-vp9',
    name: 'WebM · VP9',
    description: 'Open format for the web',
    format: 'webm',
    codec: 'vp9',
    height: 1080,
    fps: 30,
    quality: 70,
    audioBitrate: 160,
  },
  {
    id: 'mov-prores',
    name: 'MOV · ProRes 422',
    description: 'Edit-friendly master file (large)',
    format: 'mov',
    codec: 'prores',
    height: 0,
    fps: 0,
    quality: 90,
    audioBitrate: 320,
  },
  {
    id: 'gif-480',
    name: 'Animated GIF',
    description: '480p, 12 fps, no audio',
    format: 'gif',
    codec: 'gif',
    height: 480,
    fps: 12,
    quality: 60,
    audioBitrate: 0,
  },
  {
    id: 'm4a-audio',
    name: 'Audio only (M4A)',
    description: 'AAC audio of the mixed timeline',
    format: 'm4a',
    codec: 'none',
    height: 0,
    fps: 0,
    quality: 80,
    audioBitrate: 192,
  },
];

export function defaultSettings(outputDirectory: string, isMac: boolean): AppSettings {
  const mod = isMac ? 'Command' : 'Control';
  return {
    recording: {
      outputDirectory,
      fps: 30,
      quality: 'high',
      maxHeight: 1440,
      countdown: 3,
      systemAudio: false,
      microphone: true,
      microphoneDeviceId: 'default',
      noiseSuppression: true,
      camera: false,
      cameraDeviceId: '',
      hideMainWindow: true,
      showBorder: true,
      openEditorAfterRecording: true,
      liveCaptions: false,
    },
    hotkeys: {
      startStop: `${mod}+Shift+9`,
      pauseResume: `${mod}+Shift+0`,
    },
    ffmpegPath: '',
    theme: 'dark',
    ai: { captionModel: 'onnx-community/whisper-base', language: 'english', autoNotes: true, hasApiKey: false },
    recentProjects: [],
  };
}

/** Bits per second for MediaRecorder, scaled by pixel count. */
export function recordingBitrate(quality: 'standard' | 'high' | 'max', width: number, height: number, fps: number): number {
  // Screen content is mostly static text and UI, so it needs far fewer bits than camera video.
  const bppf = quality === 'max' ? 0.1 : quality === 'high' ? 0.05 : 0.028;
  const bps = width * height * Math.min(fps, 60) * bppf;
  return Math.round(Math.min(Math.max(bps, 1_500_000), 30_000_000));
}

/** Output size after capping the long-edge-aware height at maxHeight (0 = native). */
export function cappedSize(width: number, height: number, maxHeight: number): { width: number; height: number } {
  if (!maxHeight || height <= maxHeight) return { width, height };
  const k = maxHeight / height;
  return { width: Math.round((width * k) / 2) * 2, height: maxHeight };
}

/** Upper-bound estimate of megabytes per minute for the recording settings. */
export function estimateMBPerMinute(quality: 'standard' | 'high' | 'max', width: number, height: number, fps: number, extras: { mic: boolean; camera: boolean; systemAudio: boolean }): number {
  let bps = recordingBitrate(quality, width, height, fps);
  if (extras.mic) bps += 96_000;
  if (extras.systemAudio) bps += 128_000;
  if (extras.camera) bps += 2_500_000;
  return (bps * 60) / 8 / 1_000_000;
}
