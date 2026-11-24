import { describe, expect, it } from 'vitest';
import {
  addAsset,
  clipEnd,
  createProject,
  deleteClips,
  findClip,
  makeZoom,
  moveClip,
  placeAsset,
  projectDuration,
  projectFromRecording,
  splitAt,
  splitClip,
  trimClip,
  upsertZoom,
  videoClipsAt,
} from '@shared/timeline';
import { zoomAt } from '@shared/zoom';
import type { MediaAsset } from '@shared/types';

const asset = (id: string, duration = 10, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  id,
  name: id,
  path: `/tmp/${id}.mp4`,
  kind: 'video',
  role: 'imported',
  duration,
  width: 1920,
  height: 1080,
  hasAudio: true,
  hasVideo: true,
  createdAt: 0,
  ...extra,
});

function setup() {
  let p = createProject('t');
  p = addAsset(p, asset('a', 10));
  const track = p.tracks.find((t) => t.kind === 'video')!;
  const r = placeAsset(p, 'a', track.id, 0);
  return { p: r.project, clipId: r.clipId, trackId: track.id };
}

describe('timeline', () => {
  it('places an asset and computes duration', () => {
    const { p } = setup();
    expect(projectDuration(p)).toBe(10);
  });

  it('places a second copy after the first instead of overlapping', () => {
    const { p, trackId } = setup();
    const r = placeAsset(p, 'a', trackId, 3);
    expect(findClip(r.project, r.clipId)!.clip.start).toBe(10);
    expect(projectDuration(r.project)).toBe(20);
  });

  it('splits a clip into two continuous pieces', () => {
    const { p, clipId } = setup();
    const { project, newClipId } = splitClip(p, clipId, 4);
    const left = findClip(project, clipId)!.clip;
    const right = findClip(project, newClipId!)!.clip;
    expect(left.out).toBe(4);
    expect(right.in).toBe(4);
    expect(right.start).toBe(4);
    expect(clipEnd(right)).toBe(10);
  });

  it('ignores splits at the clip edges', () => {
    const { p, clipId } = setup();
    expect(splitClip(p, clipId, 0).newClipId).toBeNull();
    expect(splitClip(p, clipId, 10).newClipId).toBeNull();
  });

  it('splitAt cuts every track under the playhead', () => {
    const { p } = setup();
    const out = splitAt(p, 5);
    expect(out.tracks.flatMap((t) => t.clips)).toHaveLength(2);
  });

  it('trims the left edge and keeps the source in sync', () => {
    const { p, clipId } = setup();
    const out = trimClip(p, clipId, 'left', 2);
    const c = findClip(out, clipId)!.clip;
    expect(c.start).toBe(2);
    expect(c.in).toBe(2);
    expect(clipEnd(c)).toBe(10);
  });

  it('cannot trim past the source media', () => {
    const { p, clipId } = setup();
    const out = trimClip(p, clipId, 'right', 50);
    expect(clipEnd(findClip(out, clipId)!.clip)).toBe(10);
  });

  it('cannot trim into a neighbouring clip', () => {
    const { p, clipId, trackId } = setup();
    let q = trimClip(p, clipId, 'right', 5);
    q = placeAsset(q, 'a', trackId, 6).project;
    q = trimClip(q, clipId, 'right', 9);
    expect(clipEnd(findClip(q, clipId)!.clip)).toBe(6);
  });

  it('moves a clip without overlapping others', () => {
    const { p, clipId, trackId } = setup();
    const r = placeAsset(trimClip(p, clipId, 'right', 4), 'a', trackId, 4);
    // Try to drop the second clip on top of the first: it snaps to a free spot.
    const moved = moveClip(r.project, r.clipId, 1);
    const c = findClip(moved, r.clipId)!.clip;
    const first = findClip(moved, clipId)!.clip;
    expect(c.start >= clipEnd(first) || clipEnd(c) <= first.start).toBe(true);
  });

  it('ripple delete closes the gap', () => {
    const { p, clipId, trackId } = setup();
    const short = trimClip(p, clipId, 'right', 3);
    const r = placeAsset(short, 'a', trackId, 3);
    const out = deleteClips(r.project, [clipId], true);
    expect(findClip(out, r.clipId)!.clip.start).toBe(0);
  });

  it('builds a recording project with camera above screen', () => {
    const screen = asset('s', 8, { role: 'screen', crop: { x: 0, y: 0, w: 0.5, h: 0.5 } });
    const cam = asset('c', 8, { role: 'camera', width: 1280, height: 720 });
    const mic = asset('m', 8, { role: 'microphone', kind: 'audio', hasVideo: false, width: 0, height: 0 });
    const p = projectFromRecording('rec', [screen, cam, mic], 30);
    expect(p.width).toBe(960);
    expect(p.height).toBe(540);
    expect(p.tracks.map((t) => t.name)).toEqual(['Camera', 'Screen', 'Microphone']);
    const drawn = videoClipsAt(p, 1).map((c) => c.asset.role);
    expect(drawn).toEqual(['screen', 'camera']);
  });
});

describe('zoom', () => {
  it('is 1x outside regions and full scale in the middle', () => {
    const z = makeZoom(2, 4, 2, 0.75, 0.25);
    expect(zoomAt([z], 0).scale).toBe(1);
    const mid = zoomAt([z], 4);
    expect(mid.scale).toBeCloseTo(2);
    expect(mid.x).toBeCloseTo(0.5);
    expect(mid.y).toBeCloseTo(0);
  });

  it('does not let zoom regions overlap', () => {
    let p = createProject('z');
    p = upsertZoom(p, makeZoom(0, 4));
    p = upsertZoom(p, makeZoom(2, 4));
    expect(p.zooms).toHaveLength(2);
    expect(p.zooms[1].start).toBe(4);
  });
});
