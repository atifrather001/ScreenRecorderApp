// Locating and running ffmpeg / ffprobe.
import { ChildProcess, spawn, spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { uid } from '@shared/timeline';
import type { FFmpegInfo, MediaAsset } from '@shared/types';

function unpacked(p: string): string {
  // Binaries inside app.asar can't be executed; electron-builder unpacks them next to it.
  return p.replace(`app.asar${process.platform === 'win32' ? '\\' : '/'}`, `app.asar.unpacked${process.platform === 'win32' ? '\\' : '/'}`);
}

function bundled(pkg: '@ffmpeg-installer/ffmpeg' | '@ffprobe-installer/ffprobe'): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = unpacked(require(pkg).path as string);
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/** Binaries shipped as extra resources (used for the Windows installer). */
function resource(bin: 'ffmpeg' | 'ffprobe'): string | null {
  if (!process.resourcesPath) return null;
  const p = join(process.resourcesPath, 'ffmpeg', process.platform === 'win32' ? `${bin}.exe` : bin);
  return existsSync(p) ? p : null;
}

function which(bin: string): string | null {
  const exe = process.platform === 'win32' ? `${bin}.exe` : bin;
  const dirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
  // GUI apps on macOS don't inherit the shell PATH, so check the usual Homebrew/MacPorts locations too.
  if (process.platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin');
  if (process.platform === 'linux') dirs.push('/usr/bin', '/usr/local/bin', '/snap/bin');
  for (const d of dirs) {
    if (!d) continue;
    const p = join(d, exe);
    if (existsSync(p)) return p;
  }
  return null;
}

export class FFmpeg {
  ffmpeg = '';
  ffprobe = '';
  source: FFmpegInfo['source'] = 'missing';
  private info: FFmpegInfo | null = null;

  configure(customPath: string): void {
    this.info = null;
    if (customPath && existsSync(customPath)) {
      this.ffmpeg = customPath;
      const probe = join(dirname(customPath), basename(customPath).replace('ffmpeg', 'ffprobe'));
      this.ffprobe = existsSync(probe) ? probe : (which('ffprobe') ?? bundled('@ffprobe-installer/ffprobe') ?? '');
      this.source = 'custom';
      return;
    }
    // Use the ffmpeg shipped with the app so every machine behaves the same; fall back to a system install
    // (e.g. Homebrew) only if the bundled one is missing. A different binary can be chosen in Settings.
    const b = resource('ffmpeg') ?? bundled('@ffmpeg-installer/ffmpeg');
    if (b) {
      this.ffmpeg = b;
      this.ffprobe = resource('ffprobe') ?? bundled('@ffprobe-installer/ffprobe') ?? which('ffprobe') ?? '';
      this.source = 'bundled';
      return;
    }
    const sys = which('ffmpeg');
    this.ffmpeg = sys ?? '';
    this.ffprobe = which('ffprobe') ?? '';
    this.source = sys ? 'system' : 'missing';
  }

  getInfo(): FFmpegInfo {
    if (this.info) return this.info;
    if (!this.ffmpeg) return { path: '', version: '', source: 'missing', encoders: [] };
    const v = spawnSync(this.ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8' });
    const version = /ffmpeg version (\S+)/.exec(v.stdout ?? '')?.[1] ?? 'unknown';
    const e = spawnSync(this.ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    const encoders = (e.stdout ?? '')
      .split('\n')
      .map((l) => /^\s[VAS][\w.]{5}\s+(\S+)/.exec(l)?.[1])
      .filter((x): x is string => !!x);
    this.info = { path: this.ffmpeg, version, source: this.source, encoders };
    return this.info;
  }

  hardwareEncoders(): string[] {
    return this.getInfo().encoders.filter((e) => /videotoolbox|nvenc|qsv|amf|vaapi/.test(e));
  }

  /** Run ffmpeg to completion. Rejects with the tail of stderr on failure. */
  run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ffmpeg) return reject(new Error('ffmpeg was not found. Install it or set its path in Settings.'));
      const child = spawn(this.ffmpeg, args, { windowsHide: true });
      let err = '';
      child.stderr.on('data', (d) => (err = (err + d.toString()).slice(-6000)));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.split('\n').slice(-8).join('\n')))));
    });
  }

  /** Spawn ffmpeg with `-progress pipe:1` style args and report seconds encoded. */
  runWithProgress(args: string[], onTime: (seconds: number) => void): { child: ChildProcess; done: Promise<void> } {
    if (!this.ffmpeg) throw new Error('ffmpeg was not found. Install it or set its path in Settings.');
    const child = spawn(this.ffmpeg, args, { windowsHide: true });
    let err = '';
    let buf = '';
    child.stdout?.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m) onTime(Number(m[1]) / 1_000_000);
      }
    });
    child.stderr?.on('data', (d) => (err = (err + d.toString()).slice(-8000)));
    const done = new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => {
        if (code === 0) resolve();
        else if (signal) reject(new Error('cancelled'));
        else reject(new Error(err.split('\n').filter(Boolean).slice(-10).join('\n')));
      });
    });
    return { child, done };
  }

  probe(path: string): Promise<{ duration: number; width: number; height: number; hasAudio: boolean; hasVideo: boolean; videoCodec: string; isImage: boolean }> {
    return new Promise((resolve, reject) => {
      if (!this.ffprobe) return reject(new Error('ffprobe was not found.'));
      const child = spawn(this.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', (d) => (err += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(err || `Could not read ${basename(path)}`));
        try {
          const j = JSON.parse(out) as {
            streams: { codec_type: string; codec_name: string; width?: number; height?: number; duration?: string; tags?: Record<string, string>; side_data_list?: { rotation?: number }[] }[];
            format: { duration?: string; format_name?: string };
          };
          const v = j.streams.find((s) => s.codec_type === 'video');
          const a = j.streams.find((s) => s.codec_type === 'audio');
          const isImage = !!v && /image2|png_pipe|jpeg_pipe|webp_pipe|gif/.test(j.format.format_name ?? '') && !j.format.duration;
          let width = v?.width ?? 0;
          let height = v?.height ?? 0;
          const rotation = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0));
          if (rotation === 90 || rotation === 270) [width, height] = [height, width];
          resolve({
            duration: Number(j.format.duration ?? v?.duration ?? a?.duration ?? 0) || 0,
            width,
            height,
            hasAudio: !!a,
            hasVideo: !!v,
            videoCodec: v?.codec_name ?? '',
            isImage: isImage || /\.(png|jpe?g|webp|bmp)$/i.test(path),
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async assetFromFile(path: string, role: MediaAsset['role'] = 'imported'): Promise<MediaAsset> {
    const info = await this.probe(path);
    const kind: MediaAsset['kind'] = info.isImage ? 'image' : info.hasVideo ? 'video' : 'audio';
    if (!info.hasVideo && !info.hasAudio) throw new Error(`${basename(path)} has no audio or video.`);
    return {
      id: uid('asset'),
      name: basename(path, extname(path)),
      path,
      kind,
      role,
      duration: kind === 'image' ? 5 : info.duration,
      width: info.width,
      height: info.height,
      hasAudio: kind !== 'image' && info.hasAudio,
      hasVideo: info.hasVideo,
      createdAt: existsSync(path) ? statSync(path).mtimeMs : Date.now(),
    };
  }
}

export const ffmpeg = new FFmpeg();
