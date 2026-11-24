import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildExportPlan, captionConcatList } from '@shared/export-graph';
import { writeFileSync } from 'fs';
import { EXPORT_PRESETS } from '@shared/presets';
import {
  addAsset,
  createProject,
  makeAnnotation,
  makeZoom,
  placeAsset,
  splitClip,
  upsertAnnotation,
  upsertZoom,
} from '@shared/timeline';
import type { MediaAsset, Project } from '@shared/types';

// Exercise the generated filter graphs against every ffmpeg we can find.
const candidates = [
  { name: 'bundled', path: require('@ffmpeg-installer/ffmpeg').path as string },
  { name: 'system', path: '/opt/homebrew/bin/ffmpeg' },
  { name: 'system', path: '/usr/local/bin/ffmpeg' },
  { name: 'system', path: '/usr/bin/ffmpeg' },
  ...(process.env.EXTRA_FFMPEG ? [{ name: 'extra', path: process.env.EXTRA_FFMPEG }] : []),
].filter((c) => existsSync(c.path));

const dir = mkdtempSync(join(tmpdir(), 'sra-export-'));
const screenPath = join(dir, 'screen.mp4');
const camPath = join(dir, 'cam.mp4');
const pngPath = join(dir, 'ann.png');

function probeDuration(ffmpeg: string, file: string): number {
  const r = spawnSync(ffmpeg, ['-i', file], { encoding: 'utf8' });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : -1;
}

const asset = (id: string, path: string, extra: Partial<MediaAsset>): MediaAsset => ({
  id, name: id, path, kind: 'video', role: 'imported', duration: 6, width: 640, height: 360,
  hasAudio: true, hasVideo: true, createdAt: 0, ...extra,
});

function buildProject(): Project {
  let p = createProject('export-test', 640, 360, 30);
  p = addAsset(p, asset('screen', screenPath, { role: 'screen', crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }));
  p = addAsset(p, asset('cam', camPath, { role: 'camera', hasAudio: false, width: 320, height: 240 }));
  const [top, bottom] = p.tracks;
  let r = placeAsset(p, 'screen', bottom.id, 0, { x: 0, y: 0, w: 1, h: 1 });
  p = splitClip(r.project, r.clipId, 2).project;
  r = placeAsset(p, 'cam', top.id, 0.5, { x: 0.7, y: 0.65, w: 0.25, h: 0.3 });
  p = r.project;
  p = upsertAnnotation(p, makeAnnotation(p, 'rect', 1, 2));
  p = upsertAnnotation(p, makeAnnotation(p, 'blur', 2, 2));
  p = upsertZoom(p, makeZoom(3, 2, 2, 0.3, 0.3));
  return p;
}

beforeAll(() => {
  if (!candidates.length) return;
  const ff = candidates[candidates.length - 1].path;
  execFileSync(ff, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=640x360:r=30:d=6', '-f', 'lavfi', '-i', 'sine=f=440:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', screenPath]);
  execFileSync(ff, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'smptebars=s=320x240:r=30:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', camPath]);
  execFileSync(ff, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red@0.5:s=640x360,format=rgba', '-frames:v', '1', pngPath]);
}, 60_000);

describe.skipIf(!candidates.length).each(candidates)('export with $name ffmpeg ($path)', ({ path: ffmpeg }) => {
  const presets = ['mp4-720', 'webm-vp9', 'gif-480', 'm4a-audio'].map((id) => EXPORT_PRESETS.find((p) => p.id === id)!);

  it.each(presets)('renders $name', (preset) => {
    const p = buildProject();
    const rectId = p.annotations.find((a) => a.type === 'rect')!.id;
    const out = join(dir, `${preset.id}-${Math.random().toString(36).slice(2, 6)}.${preset.format}`);
    const plan = buildExportPlan(p, preset, {
      outputPath: out,
      annotationFiles: { [rectId]: pngPath },
      hardwareEncoders: [],
      hardwareAcceleration: false,
    });
    const r = spawnSync(ffmpeg, plan.args, { encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0) throw new Error(r.stderr.split('\n').slice(-15).join('\n'));
    expect(existsSync(out)).toBe(true);
    expect(Math.abs(probeDuration(ffmpeg, out) - plan.duration)).toBeLessThan(0.3);
  }, 120_000);

  it('burns in captions and extracts speech audio', () => {
    const p = buildProject();
    const list = join(dir, 'caps.ffconcat');
    writeFileSync(list, captionConcatList([{ start: 0.5, end: 2 }], [pngPath], pngPath, 6));
    const out = join(dir, `caps-${Math.random().toString(36).slice(2, 6)}.mp4`);
    const preset = EXPORT_PRESETS.find((x) => x.id === 'mp4-720')!;
    const plan = buildExportPlan(p, preset, { outputPath: out, annotationFiles: {}, hardwareEncoders: [], hardwareAcceleration: false, captionTrack: list });
    let r = spawnSync(ffmpeg, plan.args, { encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0) throw new Error(r.stderr.split('\n').slice(-15).join('\n'));
    const pcm = join(dir, `speech-${Math.random().toString(36).slice(2, 6)}.f32`);
    const audio = buildExportPlan(p, EXPORT_PRESETS.find((x) => x.id === 'm4a-audio')!, { outputPath: pcm, annotationFiles: {}, hardwareEncoders: [], hardwareAcceleration: false, rawAudio16k: true });
    r = spawnSync(ffmpeg, audio.args, { encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0) throw new Error(r.stderr.split('\n').slice(-15).join('\n'));
    expect(existsSync(pcm)).toBe(true);
  }, 120_000);
});

