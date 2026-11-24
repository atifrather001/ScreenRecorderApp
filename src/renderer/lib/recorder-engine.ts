// Captures screen, microphone and camera with MediaRecorder and streams the data to disk via the main process.
// Each source is written to its own file so it lands on its own editable track.
import { cappedSize, recordingBitrate } from '@shared/presets';
import { uid } from '@shared/timeline';
import { LiveCaptioner } from './live-captions';
import type { AssetRole, CaptionSegment, MediaAsset, RecorderPhase, RecorderStatus, RecordingQuality, Rect, ScreenSource } from '@shared/types';

export interface RecordOptions {
  source: ScreenSource;
  region: Rect | null;
  systemAudio: boolean;
  microphoneId: string | null;
  cameraId: string | null;
  fps: number;
  quality: RecordingQuality;
  maxHeight: number;
  /** Physical pixel size of the display being captured, used to cap the resolution. */
  nativeSize: { width: number; height: number } | null;
  countdown: number;
  noiseSuppression: boolean;
  /** Transcribe speech live (the speech model must already be loaded). */
  liveCaptions: boolean;
  language: string;
}

export interface RecordingResult {
  dir: string;
  name: string;
  assets: MediaAsset[];
  warnings: string[];
  captions: CaptionSegment[];
}

interface Lane {
  role: AssetRole;
  recorder: MediaRecorder;
  fileId: string;
  queue: Promise<void>;
  stopped: Promise<void>;
  error: Error | null;
}

function pickMime(candidates: string[]): string {
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

const SCREEN_MIMES = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const CAMERA_MIMES = ['video/webm;codecs=h264', 'video/webm;codecs=vp8', 'video/webm'];
const AUDIO_MIMES = ['audio/webm;codecs=opus', 'audio/webm'];

type Listener = (s: RecorderStatus) => void;

class RecorderEngine {
  private phase: RecorderPhase = 'idle';
  private listeners = new Set<Listener>();
  private streams: MediaStream[] = [];
  private lanes: Lane[] = [];
  private session: { dir: string; name: string } | null = null;
  private opts: RecordOptions | null = null;
  private startedAt = 0;
  private pausedTotal = 0;
  private pausedAt = 0;
  private countdownLeft = 0;
  private timer: number | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Float32Array<ArrayBuffer> | null = null;
  private cancelCountdown: (() => void) | null = null;
  private warnings: string[] = [];
  private captioner: LiveCaptioner | null = null;
  private caption = '';

  get status(): RecorderStatus {
    return {
      phase: this.phase,
      elapsed: this.elapsed(),
      countdown: this.countdownLeft,
      micLevel: this.micLevel(),
      caption: this.caption,
      captionsActive: !!this.captioner,
    };
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.status);
    return () => this.listeners.delete(l);
  }

  private emit(): void {
    const s = this.status;
    this.listeners.forEach((l) => l(s));
    window.api.setRecorderStatus(
      s,
      this.opts ? { displayId: this.opts.source.displayId, kind: this.opts.source.kind, region: this.opts.region } : undefined,
    );
  }

  private elapsed(): number {
    if (this.phase === 'recording') return (performance.now() - this.startedAt - this.pausedTotal) / 1000;
    if (this.phase === 'paused' || this.phase === 'finishing') return (this.pausedAt - this.startedAt - this.pausedTotal) / 1000;
    return 0;
  }

  private micLevel(): number {
    if (!this.analyser || !this.levelBuf) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let peak = 0;
    for (const v of this.levelBuf) peak = Math.max(peak, Math.abs(v));
    return Math.min(1, peak * 1.4);
  }

  /** Acquire all streams, count down, then start recording. Resolves once recording has started. */
  async start(opts: RecordOptions): Promise<void> {
    if (this.phase !== 'idle') throw new Error('Already recording');
    this.opts = opts;
    this.warnings = [];
    this.phase = 'countdown';
    this.countdownLeft = opts.countdown;
    try {
      await window.api.setCaptureSource(opts.source.id, opts.systemAudio);
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: opts.fps, max: opts.fps },
          ...(opts.nativeSize && opts.maxHeight
            ? (() => {
                const s = cappedSize(opts.nativeSize.width, opts.nativeSize.height, opts.maxHeight);
                return { width: { max: s.width }, height: { max: s.height } };
              })()
            : {}),
        },
        audio: opts.systemAudio,
      });
      this.streams.push(screen);
      if (opts.systemAudio && !screen.getAudioTracks().length) {
        this.warnings.push('System audio is not available on this system, so it was not recorded.');
      }
      screen.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (this.phase === 'recording' || this.phase === 'paused') void this.stopAndNotify();
      });

      let mic: MediaStream | null = null;
      if (opts.microphoneId) {
        try {
          mic = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: opts.microphoneId === 'default' ? undefined : { exact: opts.microphoneId },
              noiseSuppression: opts.noiseSuppression,
              echoCancellation: false,
              autoGainControl: true,
            },
          });
          this.streams.push(mic);
          this.audioCtx = new AudioContext();
          this.analyser = this.audioCtx.createAnalyser();
          this.analyser.fftSize = 1024;
          this.levelBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
          this.audioCtx.createMediaStreamSource(mic).connect(this.analyser);
        } catch (err) {
          this.warnings.push(`Microphone unavailable: ${(err as Error).message}`);
        }
      }

      let cam: MediaStream | null = null;
      if (opts.cameraId) {
        try {
          cam = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: opts.cameraId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          });
          this.streams.push(cam);
        } catch (err) {
          this.warnings.push(`Camera unavailable: ${(err as Error).message}`);
        }
      }

      this.session = await window.api.recNewSession();

      // Countdown (can be cancelled)
      if (opts.countdown > 0) {
        const ok = await this.runCountdown(opts.countdown);
        if (!ok) return;
      }

      const vt = screen.getVideoTracks()[0];
      const vs = vt?.getSettings() ?? {};
      const screenStream = new MediaStream([...screen.getVideoTracks(), ...screen.getAudioTracks()]);
      await this.addLane('screen', screenStream, pickMime(SCREEN_MIMES), {
        videoBitsPerSecond: recordingBitrate(opts.quality, vs.width ?? 1920, vs.height ?? 1080, opts.fps),
        audioBitsPerSecond: 128_000,
      });
      if (mic) await this.addLane('microphone', mic, pickMime(AUDIO_MIMES), { audioBitsPerSecond: 96_000 });
      if (cam) await this.addLane('camera', cam, pickMime(CAMERA_MIMES), { videoBitsPerSecond: 2_500_000 });

      if (opts.liveCaptions) {
        const speech = mic ?? (screen.getAudioTracks().length ? new MediaStream(screen.getAudioTracks()) : null);
        if (speech) {
          this.caption = '';
          this.captioner = new LiveCaptioner(
            speech,
            () => this.elapsed(),
            () => this.phase === 'recording',
            opts.language,
            (text) => {
              this.caption = text;
              this.emit();
            },
          );
        } else this.warnings.push('Live captions need the microphone or system audio turned on.');
      }

      for (const lane of this.lanes) lane.recorder.start(1000);
      this.startedAt = performance.now();
      this.pausedTotal = 0;
      this.phase = 'recording';
      this.timer = window.setInterval(() => this.emit(), 200);
      this.emit();
    } catch (err) {
      await this.teardown(true);
      throw err;
    }
  }

  private runCountdown(seconds: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.countdownLeft = seconds;
      this.emit();
      const id = window.setInterval(() => {
        this.countdownLeft -= 1;
        if (this.countdownLeft <= 0) {
          window.clearInterval(id);
          this.cancelCountdown = null;
          resolve(true);
        } else this.emit();
      }, 1000);
      this.cancelCountdown = () => {
        window.clearInterval(id);
        this.cancelCountdown = null;
        resolve(false);
      };
    });
  }

  private async addLane(role: AssetRole, stream: MediaStream, mimeType: string, bitrates: MediaRecorderOptions): Promise<void> {
    const recorder = new MediaRecorder(stream, { mimeType: mimeType || undefined, ...bitrates });
    const fileId = await window.api.recBegin(this.session!.dir, role, recorder.mimeType || mimeType);
    let resolveStopped!: () => void;
    const lane: Lane = {
      role,
      recorder,
      fileId,
      queue: Promise.resolve(),
      stopped: new Promise<void>((r) => (resolveStopped = r)),
      error: null,
    };
    recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      lane.queue = lane.queue
        .then(async () => window.api.recChunk(fileId, await e.data.arrayBuffer()))
        .catch((err) => {
          lane.error = err as Error;
        });
    };
    recorder.onstop = () => resolveStopped();
    recorder.onerror = (ev) => {
      lane.error = new Error(`Recorder error (${role}): ${(ev as unknown as { error?: Error }).error?.message ?? 'unknown'}`);
    };
    this.lanes.push(lane);
  }

  pause(): void {
    if (this.phase !== 'recording') return;
    this.lanes.forEach((l) => l.recorder.state === 'recording' && l.recorder.pause());
    this.pausedAt = performance.now();
    this.phase = 'paused';
    this.emit();
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.lanes.forEach((l) => l.recorder.state === 'paused' && l.recorder.resume());
    this.pausedTotal += performance.now() - this.pausedAt;
    this.phase = 'recording';
    this.emit();
  }

  private onFinished: ((r: Promise<RecordingResult | null>) => void) | null = null;

  /** Called when recording stops from outside the app UI (control bar, shortcut, source closed). */
  setFinishedHandler(fn: (r: Promise<RecordingResult | null>) => void): void {
    this.onFinished = fn;
  }

  stopAndNotify(): Promise<RecordingResult | null> {
    const p = this.stop();
    this.onFinished?.(p);
    return p;
  }

  async stop(): Promise<RecordingResult | null> {
    if (this.phase === 'countdown') {
      await this.cancel();
      return null;
    }
    if (this.phase !== 'recording' && this.phase !== 'paused') return null;
    if (this.phase === 'recording') this.pausedAt = performance.now();
    this.phase = 'finishing';
    this.emit();
    try {
      for (const l of this.lanes) if (l.recorder.state !== 'inactive') l.recorder.stop();
      await Promise.all(this.lanes.map((l) => l.stopped));
      await Promise.all(this.lanes.map((l) => l.queue));
      const failed = this.lanes.find((l) => l.error);
      if (failed) throw failed.error;
      const assets: MediaAsset[] = [];
      for (const lane of this.lanes) {
        try {
          const info = await window.api.recEnd(lane.fileId);
          assets.push({
            id: uid('asset'),
            name: lane.role === 'screen' ? 'Screen' : lane.role === 'camera' ? 'Camera' : 'Microphone',
            path: info.path,
            kind: info.hasVideo ? 'video' : 'audio',
            role: lane.role,
            duration: info.duration,
            width: info.width,
            height: info.height,
            hasAudio: info.hasAudio,
            hasVideo: info.hasVideo,
            crop: lane.role === 'screen' && this.opts?.region ? this.opts.region : undefined,
            createdAt: Date.now(),
          });
        } catch (err) {
          this.warnings.push((err as Error).message);
        }
      }
      if (!assets.some((a) => a.role === 'screen')) throw new Error('The screen recording could not be saved.');
      const captions = this.captioner ? await this.captioner.stop().catch(() => []) : [];
      this.captioner = null;
      const result = { dir: this.session!.dir, name: this.session!.name, assets, warnings: [...this.warnings], captions };
      await this.teardown(false);
      return result;
    } catch (err) {
      await this.teardown(false);
      throw err;
    }
  }

  async cancel(): Promise<void> {
    this.cancelCountdown?.();
    for (const l of this.lanes) {
      l.recorder.ondataavailable = null;
      if (l.recorder.state !== 'inactive') l.recorder.stop();
    }
    const dir = this.session?.dir;
    await this.teardown(true);
    if (dir) await window.api.recDiscardSession(dir);
  }

  private async teardown(discard: boolean): Promise<void> {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
    if (this.captioner) void this.captioner.stop();
    this.captioner = null;
    this.caption = '';
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    this.streams = [];
    this.lanes = [];
    await this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.analyser = null;
    if (discard && this.session && this.phase === 'countdown') {
      await window.api.recDiscardSession(this.session.dir).catch(() => undefined);
    }
    this.session = null;
    this.phase = 'idle';
    this.countdownLeft = 0;
    this.emit();
  }
}

export const recorder = new RecorderEngine();
