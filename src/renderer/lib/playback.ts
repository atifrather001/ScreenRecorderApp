// Real-time preview: keeps a pool of <video>/<img> elements in sync with the timeline clock and composites
// frames onto a canvas using the same rules as the ffmpeg export.
import type { MediaAsset, Project } from '@shared/types';
import { annotationsAt, audioClipsAt, videoClipsAt, ActiveClip } from '@shared/timeline';
import { zoomAt } from '@shared/zoom';
import { drawAnnotation } from './annotations';
import { drawCaption } from './caption-draw';
import { captionAt } from '@shared/captions';

type MediaEl = HTMLVideoElement | HTMLImageElement;

export class MediaPool {
  private els = new Map<string, MediaEl>();
  private used = new Set<string>();
  onFrame: (() => void) | null = null;

  /** Element for the n-th simultaneous use of an asset. */
  get(asset: MediaAsset, slot: number): MediaEl {
    const key = `${asset.id}#${slot}`;
    let el = this.els.get(key);
    if (!el || el.dataset.path !== asset.path) {
      if (asset.kind === 'image') {
        const img = new Image();
        img.src = window.api.mediaUrl(asset.path);
        img.onload = () => this.onFrame?.();
        el = img;
      } else {
        const v = document.createElement('video');
        v.preload = 'auto';
        v.playsInline = true;
        v.crossOrigin = 'anonymous';
        v.src = window.api.mediaUrl(asset.path);
        v.addEventListener('seeked', () => this.onFrame?.());
        v.addEventListener('loadeddata', () => this.onFrame?.());
        el = v;
      }
      el.dataset.path = asset.path;
      this.els.set(key, el);
    }
    this.used.add(key);
    return el;
  }

  beginFrame(): void {
    this.used.clear();
  }

  /** Pause anything that wasn't used this frame. */
  endFrame(): void {
    for (const [key, el] of this.els) {
      if (!this.used.has(key) && el instanceof HTMLVideoElement && !el.paused) el.pause();
    }
  }

  pauseAll(): void {
    for (const el of this.els.values()) if (el instanceof HTMLVideoElement) el.pause();
  }

  dispose(): void {
    for (const el of this.els.values()) {
      if (el instanceof HTMLVideoElement) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
    }
    this.els.clear();
  }
}

interface Slotted extends ActiveClip {
  el: MediaEl;
}

function assignSlots(pool: MediaPool, clips: ActiveClip[]): Slotted[] {
  const counts = new Map<string, number>();
  return clips.map((c) => {
    const n = counts.get(c.asset.id) ?? 0;
    counts.set(c.asset.id, n + 1);
    return { ...c, el: pool.get(c.asset, n) };
  });
}

const DRIFT = 0.25;

/**
 * Bring media elements to timeline time t. While playing, elements run freely and are only corrected on drift;
 * while paused they are seeked exactly.
 */
export function syncMedia(pool: MediaPool, project: Project, t: number, playing: boolean): { video: Slotted[] } {
  pool.beginFrame();
  const video = assignSlots(pool, videoClipsAt(project, t));
  const audio = assignSlots(pool, audioClipsAt(project, t));
  const audible = new Map(audio.map((a) => [a.el, a]));
  const all = new Map<MediaEl, Slotted>();
  for (const c of [...video, ...audio]) all.set(c.el, c);

  for (const [el, c] of all) {
    if (!(el instanceof HTMLVideoElement)) continue;
    const a = audible.get(el);
    el.muted = !a || !playing;
    el.volume = a ? Math.min(1, Math.max(0, a.clip.volume)) : 0;
    const target = c.sourceTime;
    if (playing) {
      if (el.paused) {
        if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
        void el.play().catch(() => undefined);
      } else if (Math.abs(el.currentTime - target) > DRIFT) {
        el.currentTime = target;
      }
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - target) > 0.02 && !el.seeking) el.currentTime = target;
    }
  }
  pool.endFrame();
  return { video };
}

function drawClip(ctx: CanvasRenderingContext2D, c: Slotted, W: number, H: number): void {
  const el = c.el;
  const ready = el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete && el.naturalWidth > 0;
  if (!ready) return;
  const sw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const sh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  const crop = c.asset.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const tr = c.clip.transform;
  ctx.save();
  ctx.globalAlpha = c.clip.opacity;
  ctx.drawImage(el, crop.x * sw, crop.y * sh, crop.w * sw, crop.h * sh, tr.x * W, tr.y * H, tr.w * W, tr.h * H);
  ctx.restore();
}

export interface Compositor {
  work: HTMLCanvasElement;
  out: HTMLCanvasElement;
}

/** Draw timeline time t into `comp.out`. `skipZoom` shows the unzoomed frame (used while editing a zoom). */
export function renderFrame(comp: Compositor, project: Project, t: number, video: Slotted[], skipZoom = false): void {
  const { work, out } = comp;
  const W = out.width;
  const H = out.height;
  if (work.width !== W || work.height !== H) {
    work.width = W;
    work.height = H;
  }
  const wctx = work.getContext('2d')!;
  wctx.fillStyle = project.background;
  wctx.fillRect(0, 0, W, H);
  wctx.imageSmoothingQuality = 'high';
  for (const c of video) if (c.asset.role !== 'camera') drawClip(wctx, c, W, H);
  for (const a of annotationsAt(project, t)) drawAnnotation(wctx, a, W, H, { blurSource: a.type === 'blur' ? snapshot(work) : undefined });

  const octx = out.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';
  const z = skipZoom ? { scale: 1, x: 0, y: 0 } : zoomAt(project.zooms, t);
  if (z.scale > 1.0001) {
    octx.drawImage(work, z.x * W, z.y * H, W / z.scale, H / z.scale, 0, 0, W, H);
  } else {
    octx.drawImage(work, 0, 0);
  }
  for (const c of video) if (c.asset.role === 'camera') drawClip(octx, c, W, H);
  if (project.burnCaptions) {
    const cap = captionAt(project.captions, t);
    if (cap) drawCaption(octx, cap.text, W, H);
  }
}

let snap: HTMLCanvasElement | null = null;
function snapshot(src: HTMLCanvasElement): HTMLCanvasElement {
  snap ??= document.createElement('canvas');
  snap.width = src.width;
  snap.height = src.height;
  snap.getContext('2d')!.drawImage(src, 0, 0);
  return snap;
}
