// Runs export jobs: writes annotation images, builds the ffmpeg graph and reports progress.
import { app, WebContents } from 'electron';
import { ChildProcess } from 'child_process';
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildExportPlan, captionConcatList } from '@shared/export-graph';
import { projectDuration } from '@shared/timeline';
import * as presets from '@shared/presets';
import { uid } from '@shared/timeline';
import type { ExportProgress, ExportRequest } from '@shared/types';
import { ffmpeg } from './ffmpeg';

const jobs = new Map<string, { child: ChildProcess | null; cancelled: boolean }>();

export function startExport(req: ExportRequest, sender: WebContents): string {
  const jobId = uid('job');
  jobs.set(jobId, { child: null, cancelled: false });
  const send = (p: Omit<ExportProgress, 'jobId'>) => {
    if (!sender.isDestroyed()) sender.send('export:progress', { jobId, ...p });
  };
  void run(jobId, req, send);
  return jobId;
}

async function run(jobId: string, req: ExportRequest, send: (p: Omit<ExportProgress, 'jobId'>) => void): Promise<void> {
  const tmp = join(app.getPath('temp'), 'ScreenRecorderApp', jobId);
  try {
    send({ percent: 0, stage: 'preparing' });
    mkdirSync(tmp, { recursive: true });
    const annotationFiles: Record<string, string> = {};
    for (const [id, dataUrl] of Object.entries(req.annotationImages)) {
      const file = join(tmp, `${id}.png`);
      writeFileSync(file, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
      annotationFiles[id] = file;
    }
    let captionTrack: string | undefined;
    if (req.captions && req.captions.segments.length) {
      const toFile = (name: string, url: string) => {
        const file = join(tmp, name);
        writeFileSync(file, Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
        return file;
      };
      const blank = toFile('cap-blank.png', req.captions.blank);
      const files = req.captions.images.map((u, i) => toFile(`cap-${i}.png`, u));
      captionTrack = join(tmp, 'captions.ffconcat');
      writeFileSync(captionTrack, captionConcatList(req.captions.segments, files, blank, projectDuration(req.project)));
    }
    const missing = req.project.assets.filter((a) => !existsSync(a.path));
    const used = new Set(req.project.tracks.flatMap((t) => t.clips.map((c) => c.assetId)));
    const missingUsed = missing.filter((a) => used.has(a.id));
    if (missingUsed.length) throw new Error(`Missing media: ${missingUsed.map((a) => a.name).join(', ')}`);

    const plan = buildExportPlan(req.project, req.preset, {
      outputPath: req.outputPath,
      annotationFiles,
      hardwareEncoders: ffmpeg.hardwareEncoders(),
      hardwareAcceleration: req.hardwareAcceleration,
      captionTrack,
    });
    const job = jobs.get(jobId);
    if (!job || job.cancelled) throw new Error('cancelled');
    const { child, done } = ffmpeg.runWithProgress(plan.args, (sec) =>
      send({ percent: Math.min(99, (sec / plan.duration) * 100), stage: 'encoding' }),
    );
    job.child = child;
    await done;
    send({ percent: 100, stage: 'done', outputPath: req.outputPath });
  } catch (err) {
    const cancelled = jobs.get(jobId)?.cancelled || (err as Error).message === 'cancelled';
    if (cancelled && existsSync(req.outputPath)) {
      try {
        unlinkSync(req.outputPath);
      } catch {
        /* ignore */
      }
    }
    send({ percent: 0, stage: cancelled ? 'cancelled' : 'error', message: cancelled ? undefined : (err as Error).message });
  } finally {
    jobs.delete(jobId);
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function cancelExport(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.cancelled = true;
  job.child?.kill('SIGTERM');
}

export function cancelAll(): void {
  for (const id of jobs.keys()) cancelExport(id);
}

/** Mix the timeline's audio down to mono 16 kHz float PCM for speech recognition. */
export async function extractSpeechAudio(project: import('@shared/types').Project): Promise<ArrayBuffer> {
  const { EXPORT_PRESETS } = presets;
  const { readFileSync } = await import('fs');
  const preset = EXPORT_PRESETS.find((p) => p.id === 'm4a-audio')!;
  const out = join(app.getPath('temp'), 'ScreenRecorderApp', `speech-${uid('pcm')}.f32`);
  mkdirSync(join(app.getPath('temp'), 'ScreenRecorderApp'), { recursive: true });
  const plan = buildExportPlan(project, preset, { outputPath: out, annotationFiles: {}, hardwareEncoders: [], hardwareAcceleration: false, rawAudio16k: true });
  const { done } = ffmpeg.runWithProgress(plan.args, () => undefined);
  await done;
  const buf = readFileSync(out);
  unlinkSync(out);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
