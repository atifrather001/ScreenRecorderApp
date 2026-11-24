// Pure, immutable operations on a Project. Used by the editor store and by export.
import type {
  Annotation,
  AnnotationType,
  Clip,
  MediaAsset,
  Project,
  Rect,
  Track,
  TrackKind,
  ZoomRegion,
} from './types';

export const MIN_CLIP = 0.05;
export const EPS = 1e-6;

export function uid(prefix = ''): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const id = g.crypto?.randomUUID
    ? g.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}_${id}` : id;
}

export const clipLength = (c: Clip): number => c.out - c.in;
export const clipEnd = (c: Clip): number => c.start + clipLength(c);
export const round = (n: number, p = 1000): number => Math.round(n * p) / p;

export function createProject(name: string, width = 1920, height = 1080, fps = 30): Project {
  const now = Date.now();
  return {
    version: 1,
    id: uid('proj'),
    name,
    createdAt: now,
    updatedAt: now,
    width: even(width),
    height: even(height),
    fps,
    background: '#000000',
    assets: [],
    tracks: [newTrack('video', 'Track 2'), newTrack('video', 'Track 1'), newTrack('audio', 'Audio 1')],
    annotations: [],
    zooms: [],
  };
}

export function even(n: number): number {
  const r = Math.max(2, Math.round(n));
  return r % 2 === 0 ? r : r - 1;
}

export function newTrack(kind: TrackKind, name: string): Track {
  return { id: uid('trk'), kind, name, muted: false, hidden: false, locked: false, clips: [] };
}

export function projectDuration(p: Project): number {
  let d = 0;
  for (const t of p.tracks) for (const c of t.clips) d = Math.max(d, clipEnd(c));
  for (const a of p.annotations) d = Math.max(d, a.end);
  return round(d);
}

export function getAsset(p: Project, id: string): MediaAsset | undefined {
  return p.assets.find((a) => a.id === id);
}

export function findClip(p: Project, clipId: string): { track: Track; clip: Clip; trackIndex: number } | null {
  for (let i = 0; i < p.tracks.length; i++) {
    const clip = p.tracks[i].clips.find((c) => c.id === clipId);
    if (clip) return { track: p.tracks[i], clip, trackIndex: i };
  }
  return null;
}

function touch(p: Project): Project {
  return { ...p, updatedAt: Date.now() };
}

function mapTrack(p: Project, trackId: string, fn: (t: Track) => Track): Project {
  return touch({ ...p, tracks: p.tracks.map((t) => (t.id === trackId ? fn(t) : t)) });
}

function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

/** Fit an asset of size w x h inside the canvas, preserving its aspect ratio. */
export function fitTransform(p: Project, w: number, h: number): Rect {
  if (!w || !h) return { x: 0, y: 0, w: 1, h: 1 };
  const canvasAspect = p.width / p.height;
  const aspect = w / h;
  if (Math.abs(aspect - canvasAspect) < 0.01) return { x: 0, y: 0, w: 1, h: 1 };
  if (aspect > canvasAspect) {
    const nh = canvasAspect / aspect;
    return { x: 0, y: (1 - nh) / 2, w: 1, h: nh };
  }
  const nw = aspect / canvasAspect;
  return { x: (1 - nw) / 2, y: 0, w: nw, h: 1 };
}

export function assetDisplaySize(a: MediaAsset): { w: number; h: number } {
  const w = a.crop ? a.width * a.crop.w : a.width;
  const h = a.crop ? a.height * a.crop.h : a.height;
  return { w, h };
}

export function addAsset(p: Project, asset: MediaAsset): Project {
  return touch({ ...p, assets: [...p.assets, asset] });
}

export function removeAsset(p: Project, assetId: string): Project {
  return touch({
    ...p,
    assets: p.assets.filter((a) => a.id !== assetId),
    tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.assetId !== assetId) })),
  });
}

/** First free position >= desired on a track where a clip of `len` fits. */
export function freeSlot(track: Track, desired: number, len: number, ignoreId?: string): number {
  const clips = sortClips(track.clips.filter((c) => c.id !== ignoreId));
  let start = Math.max(0, desired);
  for (const c of clips) {
    if (start + len <= c.start + EPS) break;
    if (start < clipEnd(c) - EPS) start = clipEnd(c);
  }
  return round(start);
}

export function makeClip(p: Project, asset: MediaAsset, start: number, transform?: Rect): Clip {
  const size = assetDisplaySize(asset);
  return {
    id: uid('clip'),
    assetId: asset.id,
    start,
    in: 0,
    out: asset.kind === 'image' ? 5 : asset.duration,
    volume: 1,
    muted: false,
    opacity: 1,
    transform: transform ?? fitTransform(p, size.w, size.h),
  };
}

/** Insert an asset on a track at the first free slot at or after `at`. */
export function placeAsset(p: Project, assetId: string, trackId: string, at: number, transform?: Rect): { project: Project; clipId: string } {
  const asset = getAsset(p, assetId);
  const track = p.tracks.find((t) => t.id === trackId);
  if (!asset || !track) return { project: p, clipId: '' };
  const clip = makeClip(p, asset, 0, transform);
  clip.start = freeSlot(track, at, clipLength(clip));
  return {
    project: mapTrack(p, trackId, (t) => ({ ...t, clips: sortClips([...t.clips, clip]) })),
    clipId: clip.id,
  };
}

export function updateClip(p: Project, clipId: string, patch: Partial<Clip>): Project {
  const found = findClip(p, clipId);
  if (!found) return p;
  return mapTrack(p, found.track.id, (t) => ({
    ...t,
    clips: sortClips(t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c))),
  }));
}

export function deleteClips(p: Project, clipIds: string[], ripple = false): Project {
  const ids = new Set(clipIds);
  return touch({
    ...p,
    tracks: p.tracks.map((t) => {
      if (!t.clips.some((c) => ids.has(c.id))) return t;
      let clips = t.clips;
      if (ripple) {
        for (const removed of sortClips(t.clips.filter((c) => ids.has(c.id))).reverse()) {
          const len = clipLength(removed);
          clips = clips.map((c) => (c.start >= clipEnd(removed) - EPS ? { ...c, start: round(c.start - len) } : c));
        }
      }
      return { ...t, clips: clips.filter((c) => !ids.has(c.id)) };
    }),
  });
}

/** Split a clip at timeline time t. Returns the project and the id of the right-hand piece. */
export function splitClip(p: Project, clipId: string, t: number): { project: Project; newClipId: string | null } {
  const found = findClip(p, clipId);
  if (!found) return { project: p, newClipId: null };
  const { clip } = found;
  if (t <= clip.start + MIN_CLIP || t >= clipEnd(clip) - MIN_CLIP) return { project: p, newClipId: null };
  const cut = round(clip.in + (t - clip.start));
  const left: Clip = { ...clip, out: cut };
  const right: Clip = { ...clip, id: uid('clip'), in: cut, start: round(t) };
  return {
    project: mapTrack(p, found.track.id, (tr) => ({
      ...tr,
      clips: sortClips(tr.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c]))),
    })),
    newClipId: right.id,
  };
}

/** Split every unlocked clip under the playhead (or only the given ones). */
export function splitAt(p: Project, t: number, onlyClipIds?: string[]): Project {
  let next = p;
  for (const track of p.tracks) {
    if (track.locked) continue;
    for (const c of track.clips) {
      if (onlyClipIds && onlyClipIds.length && !onlyClipIds.includes(c.id)) continue;
      if (t > c.start && t < clipEnd(c)) next = splitClip(next, c.id, t).project;
    }
  }
  return next;
}

export type TrimEdge = 'left' | 'right';

/** Trim a clip edge to timeline time t, clamped to source media and neighbouring clips. */
export function trimClip(p: Project, clipId: string, edge: TrimEdge, t: number): Project {
  const found = findClip(p, clipId);
  if (!found) return p;
  const { clip, track } = found;
  const asset = getAsset(p, clip.assetId);
  const maxSource = asset && asset.kind !== 'image' ? asset.duration : Infinity;
  const others = track.clips.filter((c) => c.id !== clipId);
  if (edge === 'left') {
    const prevEnd = Math.max(0, ...others.filter((c) => clipEnd(c) <= clip.start + EPS).map(clipEnd));
    const minStart = Math.max(prevEnd, clip.start - clip.in);
    const maxStart = clipEnd(clip) - MIN_CLIP;
    const start = round(Math.min(Math.max(t, minStart), maxStart));
    const delta = start - clip.start;
    return updateClip(p, clipId, { start, in: round(clip.in + delta) });
  }
  const nextStart = Math.min(Infinity, ...others.filter((c) => c.start >= clipEnd(clip) - EPS).map((c) => c.start));
  const maxEnd = Math.min(nextStart, clip.start + (maxSource - clip.in));
  const end = Math.min(Math.max(t, clip.start + MIN_CLIP), maxEnd);
  return updateClip(p, clipId, { out: round(clip.in + (end - clip.start)) });
}

/** Move a clip to a new start time and (optionally) another track of the same kind. */
export function moveClip(p: Project, clipId: string, newStart: number, targetTrackId?: string): Project {
  const found = findClip(p, clipId);
  if (!found) return p;
  const { clip, track } = found;
  const target = p.tracks.find((t) => t.id === (targetTrackId ?? track.id));
  if (!target || target.locked) return p;
  const asset = getAsset(p, clip.assetId);
  if (target.kind === 'audio' && asset && !asset.hasAudio) return p;
  if (target.kind === 'video' && asset && !asset.hasVideo) return p;
  const len = clipLength(clip);
  const start = resolveOverlap(target, Math.max(0, newStart), len, clipId);
  if (start === null) return p;
  const moved = { ...clip, start };
  if (target.id === track.id) return updateClip(p, clipId, { start });
  return touch({
    ...p,
    tracks: p.tracks.map((t) => {
      if (t.id === track.id) return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
      if (t.id === target.id) return { ...t, clips: sortClips([...t.clips, moved]) };
      return t;
    }),
  });
}

/** Nearest non-overlapping start to `desired`, or null if no gap fits nearby. */
export function resolveOverlap(track: Track, desired: number, len: number, ignoreId?: string): number | null {
  const clips = sortClips(track.clips.filter((c) => c.id !== ignoreId));
  const fits = (s: number) => s >= -EPS && clips.every((c) => s + len <= c.start + EPS || s >= clipEnd(c) - EPS);
  if (fits(desired)) return round(Math.max(0, desired));
  const candidates: number[] = [];
  for (const c of clips) {
    candidates.push(clipEnd(c), c.start - len);
  }
  const valid = candidates.filter((s) => s >= 0 && fits(s)).sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
  return valid.length ? round(valid[0]) : null;
}

/** Snap a time to nearby edges (clip edges, playhead, 0) within `threshold` seconds. */
export function snapTime(p: Project, t: number, threshold: number, extra: number[] = [], ignoreClipId?: string): number {
  const points = [0, ...extra];
  for (const tr of p.tracks) for (const c of tr.clips) if (c.id !== ignoreClipId) points.push(c.start, clipEnd(c));
  let best = t;
  let bestDist = threshold;
  for (const pt of points) {
    const d = Math.abs(pt - t);
    if (d < bestDist) {
      best = pt;
      bestDist = d;
    }
  }
  return best;
}

export function addTrack(p: Project, kind: TrackKind, index?: number): Project {
  const count = p.tracks.filter((t) => t.kind === kind).length + 1;
  const track = newTrack(kind, kind === 'video' ? `Track ${count}` : `Audio ${count}`);
  const tracks = [...p.tracks];
  const at = index ?? (kind === 'video' ? 0 : tracks.length);
  tracks.splice(at, 0, track);
  return touch({ ...p, tracks });
}

export function removeTrack(p: Project, trackId: string): Project {
  return touch({ ...p, tracks: p.tracks.filter((t) => t.id !== trackId) });
}

export function updateTrack(p: Project, trackId: string, patch: Partial<Track>): Project {
  return mapTrack(p, trackId, (t) => ({ ...t, ...patch }));
}

// ---------- Annotations ----------

const ANNOTATION_DEFAULTS: Record<AnnotationType, Partial<Annotation>> = {
  text: { color: '#ffffff', text: 'Your text', fontSize: 0.06, fill: true, box: { x: 0.3, y: 0.4, w: 0.4, h: 0.12 } },
  rect: { color: '#f43f5e', strokeWidth: 6, fill: false },
  ellipse: { color: '#f43f5e', strokeWidth: 6, fill: false },
  arrow: { color: '#f43f5e', strokeWidth: 8, box: { x: 0.3, y: 0.3, w: 0.2, h: 0.15 } },
  highlight: { color: '#facc15', fill: true },
  spotlight: { color: '#000000', fill: true },
  blur: { color: '#000000', fill: true },
  step: { color: '#14b8a6', text: '1', fontSize: 0.05, fill: true, box: { x: 0.45, y: 0.45, w: 0.06, h: 0.0 } },
};

export function makeAnnotation(p: Project, type: AnnotationType, start: number, duration = 4): Annotation {
  const d = ANNOTATION_DEFAULTS[type];
  const box = { ...(d.box ?? { x: 0.35, y: 0.35, w: 0.3, h: 0.3 }) };
  if (type === 'step') {
    // keep the step badge circular regardless of canvas aspect
    box.h = (box.w * p.width) / p.height;
    const next = p.annotations.filter((a) => a.type === 'step').length + 1;
    return { ...baseAnnotation(type, start, duration, box, d), text: String(next) };
  }
  return baseAnnotation(type, start, duration, box, d);
}

function baseAnnotation(type: AnnotationType, start: number, duration: number, box: Rect, d: Partial<Annotation>): Annotation {
  return {
    id: uid('ann'),
    type,
    start: round(start),
    end: round(start + duration),
    box,
    color: d.color ?? '#ffffff',
    strokeWidth: d.strokeWidth ?? 4,
    text: d.text ?? '',
    fontSize: d.fontSize ?? 0.05,
    fill: d.fill ?? false,
  };
}

export function upsertAnnotation(p: Project, a: Annotation): Project {
  const exists = p.annotations.some((x) => x.id === a.id);
  return touch({
    ...p,
    annotations: exists ? p.annotations.map((x) => (x.id === a.id ? a : x)) : [...p.annotations, a],
  });
}

export function deleteAnnotations(p: Project, ids: string[]): Project {
  const set = new Set(ids);
  return touch({ ...p, annotations: p.annotations.filter((a) => !set.has(a.id)) });
}

// ---------- Zooms ----------

export function makeZoom(start: number, duration = 3, scale = 2, cx = 0.5, cy = 0.5): ZoomRegion {
  return { id: uid('zoom'), start: round(start), end: round(start + duration), scale, cx, cy, ease: 0.6 };
}

/** Insert or update a zoom, trimming it so zoom regions never overlap. */
export function upsertZoom(p: Project, z: ZoomRegion): Project {
  const others = p.zooms.filter((x) => x.id !== z.id).sort((a, b) => a.start - b.start);
  let { start, end } = z;
  for (const o of others) {
    if (start < o.end && end > o.start) {
      if (start >= o.start) start = o.end;
      else end = o.start;
    }
  }
  if (end - start < 0.2) return p;
  const fixed = { ...z, start: round(start), end: round(end) };
  return touch({ ...p, zooms: [...others, fixed].sort((a, b) => a.start - b.start) });
}

export function deleteZooms(p: Project, ids: string[]): Project {
  const set = new Set(ids);
  return touch({ ...p, zooms: p.zooms.filter((z) => !set.has(z.id)) });
}

// ---------- Queries used by preview and export ----------

export interface ActiveClip {
  clip: Clip;
  track: Track;
  asset: MediaAsset;
  /** Source time for timeline time t. */
  sourceTime: number;
}

/** Visible video clips at time t, bottom track first (draw order). */
export function videoClipsAt(p: Project, t: number): ActiveClip[] {
  const out: ActiveClip[] = [];
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const track = p.tracks[i];
    if (track.kind !== 'video' || track.hidden) continue;
    for (const clip of track.clips) {
      if (t >= clip.start - EPS && t < clipEnd(clip) - EPS) {
        const asset = getAsset(p, clip.assetId);
        if (asset && asset.hasVideo) out.push({ clip, track, asset, sourceTime: clip.in + (t - clip.start) });
      }
    }
  }
  return out;
}

/** All clips at time t that contribute audio. */
export function audioClipsAt(p: Project, t: number): ActiveClip[] {
  const out: ActiveClip[] = [];
  for (const track of p.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      if (clip.muted) continue;
      if (t >= clip.start - EPS && t < clipEnd(clip) - EPS) {
        const asset = getAsset(p, clip.assetId);
        if (asset && asset.hasAudio) out.push({ clip, track, asset, sourceTime: clip.in + (t - clip.start) });
      }
    }
  }
  return out;
}

export function annotationsAt(p: Project, t: number): Annotation[] {
  return p.annotations.filter((a) => t >= a.start && t < a.end);
}

/** Build a ready-to-edit project from the files of one recording session. */
export function projectFromRecording(
  name: string,
  assets: MediaAsset[],
  fps: number,
): Project {
  const screen = assets.find((a) => a.role === 'screen');
  const size = screen ? assetDisplaySize(screen) : { w: 1920, h: 1080 };
  // Cap the canvas at 4K on the long edge; export scales anyway.
  const scale = Math.min(1, 3840 / Math.max(size.w, size.h));
  let p = createProject(name, size.w * scale, size.h * scale, fps);
  p = { ...p, tracks: [] };
  const camera = assets.find((a) => a.role === 'camera');
  const mic = assets.find((a) => a.role === 'microphone');
  for (const a of assets) p = addAsset(p, a);

  const tracks: Track[] = [];
  if (camera) {
    const t = newTrack('video', 'Camera');
    const camW = 0.24;
    const camH = (camW * p.width * (camera.height / Math.max(1, camera.width))) / p.height;
    const clip = makeClip(p, camera, 0, { x: 1 - camW - 0.025, y: 1 - camH - 0.04, w: camW, h: camH });
    t.clips.push(clip);
    tracks.push(t);
  }
  const screenTrack = newTrack('video', 'Screen');
  if (screen) screenTrack.clips.push(makeClip(p, screen, 0, { x: 0, y: 0, w: 1, h: 1 }));
  tracks.push(screenTrack);
  const micTrack = newTrack('audio', 'Microphone');
  if (mic) micTrack.clips.push(makeClip(p, mic, 0));
  tracks.push(micTrack);
  return { ...p, tracks };
}
