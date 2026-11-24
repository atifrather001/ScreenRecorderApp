// Receives MediaRecorder chunks from the renderer, writes them to disk and finalises the files.
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync, unlinkSync, WriteStream } from 'fs';
import { join } from 'path';
import { uid } from '@shared/timeline';
import type { RecordedTrackInfo } from '@shared/types';
import { ffmpeg } from './ffmpeg';

interface OpenTrack {
  id: string;
  role: RecordedTrackInfo['role'];
  rawPath: string;
  dir: string;
  mimeType: string;
  stream: WriteStream;
}

const open = new Map<string, OpenTrack>();

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

export function newSession(outputDir: string): { dir: string; name: string } {
  const name = `Recording ${stamp()}`;
  let dir = join(outputDir, name);
  let i = 2;
  while (existsSync(dir)) dir = join(outputDir, `${name} (${i++})`);
  mkdirSync(dir, { recursive: true });
  return { dir, name };
}

export function begin(dir: string, role: RecordedTrackInfo['role'], mimeType: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const id = uid('rec');
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('matroska') ? 'mkv' : 'webm';
  const rawPath = join(dir, `${role}.raw.${ext}`);
  const stream = createWriteStream(rawPath);
  open.set(id, { id, role, rawPath, dir, mimeType, stream });
  return id;
}

export function chunk(id: string, data: ArrayBuffer): Promise<void> {
  const t = open.get(id);
  if (!t) return Promise.reject(new Error('Unknown recording track'));
  return new Promise((resolve, reject) => {
    t.stream.write(Buffer.from(data), (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Close the raw file and remux it so it has a proper duration index and seeks well.
 * H.264 video goes into MP4 (audio transcoded to AAC); VP8/VP9/Opus stays in WebM.
 */
export async function end(id: string): Promise<RecordedTrackInfo> {
  const t = open.get(id);
  if (!t) throw new Error('Unknown recording track');
  open.delete(id);
  await new Promise<void>((resolve) => t.stream.end(resolve));
  if (!existsSync(t.rawPath) || statSync(t.rawPath).size === 0) throw new Error(`No ${t.role} data was recorded.`);

  const info = await ffmpeg.probe(t.rawPath).catch(() => null);
  const isH264 = info?.videoCodec === 'h264';
  const finalPath = join(t.dir, `${t.role}.${isH264 ? 'mp4' : 'webm'}`);
  const args = ['-y', '-hide_banner', '-fflags', '+genpts', '-i', t.rawPath];
  if (isH264) args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
  else args.push('-c', 'copy');
  args.push(finalPath);

  let path = finalPath;
  try {
    await ffmpeg.run(args);
    unlinkSync(t.rawPath);
  } catch (err) {
    console.error(`Remux of ${t.rawPath} failed, keeping raw file:`, err);
    path = t.rawPath;
  }
  const probed = await ffmpeg.probe(path);
  return {
    id,
    role: t.role,
    path,
    duration: probed.duration,
    width: probed.width,
    height: probed.height,
    hasAudio: probed.hasAudio,
    hasVideo: probed.hasVideo,
  };
}

export function discardSession(dir: string): void {
  for (const [id, t] of open) {
    if (t.dir === dir) {
      t.stream.destroy();
      open.delete(id);
    }
  }
  if (existsSync(dir) && /Recording /.test(dir)) rmSync(dir, { recursive: true, force: true });
}
