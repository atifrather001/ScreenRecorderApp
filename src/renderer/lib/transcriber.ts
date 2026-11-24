// Main-thread client for the speech-to-text worker.
import { normaliseSegments, capDurations } from '@shared/captions';
import type { CaptionSegment } from '@shared/types';

type Progress = (fraction: number, label: string) => void;
interface Pending {
  resolve: (s: { start: number; end: number; text: string }[]) => void;
  reject: (e: Error) => void;
}

class Transcriber {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private model = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private files = new Map<string, { loaded: number; total: number }>();
  private onProgress: Progress | null = null;
  /** 'webgpu' or 'wasm' once a model has loaded. */
  device = '';

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./transcriber.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress' && m.file) {
        this.files.set(m.file, { loaded: m.loaded ?? 0, total: m.total ?? 0 });
        let l = 0;
        let t = 0;
        for (const f of this.files.values()) {
          l += f.loaded;
          t += f.total;
        }
        this.onProgress?.(t ? l / t : 0, `Downloading speech model… ${Math.round(l / 1e6)} / ${Math.round(t / 1e6)} MB`);
      } else if (m.type === 'result') {
        this.pending.get(m.id)?.resolve(m.segments);
        this.pending.delete(m.id);
      } else if (m.type === 'error') {
        if (m.id !== undefined && this.pending.has(m.id)) {
          this.pending.get(m.id)!.reject(new Error(m.message));
          this.pending.delete(m.id);
        } else this.loadError?.(new Error(m.message));
      } else if (m.type === 'ready') {
        if (m.device !== 'cached') this.device = m.device;
        this.loadDone?.();
      }
    };
    this.worker = w;
    return w;
  }

  private loadDone: (() => void) | null = null;
  private loadError: ((e: Error) => void) | null = null;

  /** Load (and on first use download) the speech model. */
  load(model: string, onProgress?: Progress): Promise<void> {
    if (this.ready && this.model === model) return this.ready;
    this.model = model;
    this.onProgress = onProgress ?? null;
    this.files.clear();
    const w = this.ensureWorker();
    this.ready = new Promise<void>((resolve, reject) => {
      this.loadDone = resolve;
      this.loadError = (e) => {
        this.ready = null;
        reject(e);
      };
    });
    const ortBase = new URL('./ort/', document.baseURI).href;
    w.postMessage({ type: 'load', model, ortBase });
    return this.ready;
  }

  /** Transcribe 16 kHz mono audio. Times in the result are offset by `offset` seconds. */
  transcribe(audio: Float32Array, offset: number, language: string): Promise<CaptionSegment[]> {
    const run = async () => {
      await this.ready;
      const id = this.nextId++;
      const raw = await new Promise<{ start: number; end: number; text: string }[]>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.ensureWorker().postMessage({ type: 'transcribe', id, audio, language }, [audio.buffer]);
      });
      return normaliseSegments(raw.map((r) => ({ ...r, start: r.start + offset, end: r.end + offset })));
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Transcribe a long recording in windows so progress can be reported. */
  async transcribeLong(audio: Float32Array, language: string, onProgress?: (f: number) => void): Promise<CaptionSegment[]> {
    const win = 16000 * 60;
    const out: CaptionSegment[] = [];
    for (let i = 0; i < audio.length; i += win) {
      const slice = audio.slice(i, Math.min(audio.length, i + win));
      out.push(...(await this.transcribe(slice, i / 16000, language)));
      onProgress?.(Math.min(1, (i + win) / audio.length));
    }
    return capDurations(out);
  }
}

export const transcriber = new Transcriber();
