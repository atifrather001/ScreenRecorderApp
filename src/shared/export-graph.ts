// Turns a Project + ExportPreset into an ffmpeg argument list. Pure, so it is unit tested.
import type { Annotation, ExportPreset, Project } from './types';
import { clipEnd, clipLength, even, getAsset, projectDuration } from './timeline';
import { zoompanExpressions } from './zoom';

export interface ExportPlanOptions {
  outputPath: string;
  /** Rendered annotation PNG files keyed by annotation id (blur annotations are done by ffmpeg). */
  annotationFiles: Record<string, string>;
  /** Hardware encoders available in this ffmpeg build, e.g. ['h264_videotoolbox']. */
  hardwareEncoders: string[];
  hardwareAcceleration: boolean;
  /** ffmpeg concat list of full-canvas caption PNGs (see writeCaptionConcat) to burn in on top. */
  captionTrack?: string;
  /** Write mono 16 kHz 32-bit float PCM instead of an encoded file (used for transcription). */
  rawAudio16k?: boolean;
}

export interface ExportPlan {
  args: string[];
  duration: number;
  width: number;
  height: number;
  fps: number;
}

const f = (v: number) => (Math.round(v * 1000) / 1000).toString();
const px = (v: number) => Math.max(2, Math.round(v));
/** Escape a value for single-quoted use inside a filtergraph. */
const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export function outputSize(project: Project, preset: ExportPreset): { width: number; height: number } {
  if (!preset.height || preset.height >= project.height) return { width: even(project.width), height: even(project.height) };
  const height = even(preset.height);
  return { width: even((project.width * height) / project.height), height };
}

export function buildExportPlan(project: Project, preset: ExportPreset, opts: ExportPlanOptions): ExportPlan {
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('The timeline is empty.');
  const W = even(project.width);
  const H = even(project.height);
  const fps = project.fps || 30;
  const out = outputSize(project, preset);
  const outFps = preset.fps || fps;
  const audioOnly = preset.format === 'm4a';
  const wantAudio = preset.format !== 'gif';

  const args: string[] = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1'];
  const filters: string[] = [];
  let inputIndex = 0;

  // ---- Inputs: one per clip, seeked with -ss/-t so ffmpeg only decodes what it needs ----
  interface ClipInput {
    index: number;
    start: number;
    end: number;
    clip: Project['tracks'][number]['clips'][number];
    asset: NonNullable<ReturnType<typeof getAsset>>;
    trackKind: 'video' | 'audio';
    visible: boolean;
    audible: boolean;
  }
  const inputs: ClipInput[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const asset = getAsset(project, clip.assetId);
      if (!asset) continue;
      const visible = track.kind === 'video' && !track.hidden && asset.hasVideo && clip.opacity > 0 && !audioOnly;
      const audible = wantAudio && !track.muted && !clip.muted && clip.volume > 0 && asset.hasAudio;
      if (!visible && !audible) continue;
      if (asset.kind === 'image') {
        args.push('-loop', '1', '-framerate', String(fps), '-t', f(clipLength(clip)), '-i', asset.path);
      } else {
        args.push('-ss', f(clip.in), '-t', f(clipLength(clip)), '-i', asset.path);
      }
      inputs.push({
        index: inputIndex++,
        start: clip.start,
        end: clipEnd(clip),
        clip,
        asset,
        trackKind: track.kind,
        visible,
        audible,
      });
    }
  }

  const annotationInputs = new Map<string, number>();
  if (!audioOnly) {
    for (const a of project.annotations) {
      const file = opts.annotationFiles[a.id];
      if (a.type !== 'blur' && file) {
        args.push('-loop', '1', '-framerate', String(fps), '-t', f(a.end), '-i', file);
        annotationInputs.set(a.id, inputIndex++);
      }
    }
  }

  // ---- Video graph ----
  let videoLabel = '';
  if (!audioOnly) {
    filters.push(`color=c=${project.background.replace('#', '0x')}:s=${W}x${H}:r=${fps}:d=${f(duration)},format=yuv420p[base0]`);
    let cur = 'base0';
    let n = 0;
    const next = () => `v${++n}`;

    const overlayClip = (ci: ClipInput) => {
      const { clip, asset } = ci;
      const w = px(clip.transform.w * W);
      const h = px(clip.transform.h * H);
      const x = Math.round(clip.transform.x * W);
      const y = Math.round(clip.transform.y * H);
      const chain: string[] = [`setpts=PTS-STARTPTS+${f(ci.start)}/TB`];
      if (asset.crop) {
        const c = asset.crop;
        chain.push(`crop=w=iw*${f(c.w)}:h=ih*${f(c.h)}:x=iw*${f(c.x)}:y=ih*${f(c.y)}`);
      }
      chain.push(`scale=${w}:${h}`, 'format=yuva420p');
      if (clip.opacity < 1) chain.push(`colorchannelmixer=aa=${f(clip.opacity)}`);
      const src = `c${ci.index}`;
      filters.push(`[${ci.index}:v]${chain.join(',')}[${src}]`);
      const dst = next();
      filters.push(
        `[${cur}][${src}]overlay=x=${x}:y=${y}:eof_action=pass:enable=${q(`between(t,${f(ci.start)},${f(ci.end)})`)}[${dst}]`,
      );
      cur = dst;
    };

    // Draw order: bottom track first. Camera clips go on after the zoom so they stay put.
    const order = [...project.tracks].reverse();
    const drawn = (role: 'camera' | 'other') =>
      order.flatMap((t) => inputs.filter((ci) => ci.visible && t.clips.includes(ci.clip) && (role === 'camera') === (ci.asset.role === 'camera')));

    for (const ci of drawn('other')) overlayClip(ci);

    // Annotations (in list order, so later ones draw on top)
    for (const a of project.annotations) {
      if (a.type === 'blur') {
        cur = blurAnnotation(filters, cur, a, W, H, next);
      } else {
        const idx = annotationInputs.get(a.id);
        if (idx === undefined) continue;
        const dst = next();
        filters.push(
          `[${cur}][${idx}:v]overlay=0:0:eof_action=pass:enable=${q(`between(t,${f(a.start)},${f(a.end)})`)}[${dst}]`,
        );
        cur = dst;
      }
    }

    if (project.zooms.length) {
      const e = zoompanExpressions(project.zooms, `in/${fps}`);
      const dst = next();
      filters.push(`[${cur}]zoompan=z=${q(e.z)}:x=${q(e.x)}:y=${q(e.y)}:d=1:s=${W}x${H}:fps=${fps}[${dst}]`);
      cur = dst;
    }

    for (const ci of drawn('camera')) overlayClip(ci);

    if (opts.captionTrack) {
      const idx = inputIndex++;
      args.push('-f', 'concat', '-safe', '0', '-i', opts.captionTrack);
      const dst = next();
      filters.push(`[${idx}:v]format=rgba[capsrc]`, `[${cur}][capsrc]overlay=0:0:eof_action=pass[${dst}]`);
      cur = dst;
    }

    // Final scaling / frame rate / pixel format for the chosen preset
    const tail: string[] = [];
    if (out.width !== W || out.height !== H) tail.push(`scale=${out.width}:${out.height}:flags=lanczos`);
    if (outFps !== fps) tail.push(`fps=${outFps}`);
    if (preset.codec === 'gif') {
      const pre = tail.length ? `${tail.join(',')},` : '';
      filters.push(`[${cur}]${pre}split[g1][g2]`, `[g1]palettegen=stats_mode=diff[pal]`, `[g2][pal]paletteuse=dither=bayer:bayer_scale=4[vout]`);
    } else {
      tail.push(preset.codec === 'prores' ? 'format=yuv422p10le' : 'format=yuv420p');
      filters.push(`[${cur}]${tail.join(',')}[vout]`);
    }
    videoLabel = 'vout';
  }

  // ---- Audio graph ----
  let audioLabel = '';
  const audible = inputs.filter((ci) => ci.audible);
  if (wantAudio && audible.length) {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${f(duration)}[abase]`);
    const labels = ['abase'];
    for (const ci of audible) {
      const ms = Math.round(ci.start * 1000);
      const label = `a${ci.index}`;
      filters.push(
        `[${ci.index}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,volume=${f(ci.clip.volume)},adelay=${ms}|${ms},apad[${label}]`,
      );
      labels.push(label);
    }
    // amix divides by the input count; every input is padded so the weight stays constant,
    // and the trailing volume filter restores the original level.
    filters.push(
      `${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:duration=first:dropout_transition=0,volume=${labels.length}[aout]`,
    );
    audioLabel = 'aout';
  }

  if (audioOnly && !audioLabel) throw new Error('There is no audio on the timeline to export.');

  args.push('-filter_complex', filters.join(';'));
  if (videoLabel) args.push('-map', `[${videoLabel}]`);
  if (audioLabel) args.push('-map', `[${audioLabel}]`);

  // ---- Encoders ----
  args.push(...videoCodecArgs(preset, opts, out.width * out.height));
  if (audioLabel && opts.rawAudio16k) args.push('-ac', '1', '-ar', '16000', '-f', 'f32le');
  else if (audioLabel) args.push(...audioCodecArgs(preset));
  else args.push('-an');

  if (!opts.rawAudio16k && (preset.format === 'mp4' || preset.format === 'mov' || preset.format === 'm4a')) args.push('-movflags', '+faststart');
  if (videoLabel) args.push('-r', String(outFps));
  args.push('-t', f(duration), opts.outputPath);

  return { args, duration, width: out.width, height: out.height, fps: outFps };
}

function blurAnnotation(filters: string[], cur: string, a: Annotation, W: number, H: number, next: () => string): string {
  const x = Math.max(0, Math.round(Math.min(a.box.x, a.box.x + a.box.w) * W));
  const y = Math.max(0, Math.round(Math.min(a.box.y, a.box.y + a.box.h) * H));
  const w = Math.min(W - x, px(Math.abs(a.box.w) * W));
  const h = Math.min(H - y, px(Math.abs(a.box.h) * H));
  if (w < 4 || h < 4) return cur;
  const s1 = next();
  const s2 = next();
  const bl = next();
  const dst = next();
  const radius = Math.max(2, Math.min(Math.floor(Math.min(w, h) / 2) - 1, 24));
  filters.push(`[${cur}]split[${s1}][${s2}]`);
  filters.push(`[${s2}]crop=${w}:${h}:${x}:${y},boxblur=${radius}:3[${bl}]`);
  filters.push(`[${s1}][${bl}]overlay=${x}:${y}:enable=${q(`between(t,${f(a.start)},${f(a.end)})`)}[${dst}]`);
  return dst;
}

/** Map 0-100 quality to CRF for x264/x265 (lower CRF = better). */
export function qualityToCrf(quality: number, codec: 'h264' | 'hevc' | 'vp9'): number {
  const q01 = Math.min(1, Math.max(0, quality / 100));
  if (codec === 'vp9') return Math.round(48 - q01 * 30); // 48..18
  if (codec === 'hevc') return Math.round(34 - q01 * 16); // 34..18
  return Math.round(32 - q01 * 16); // 32..16
}

function videoCodecArgs(preset: ExportPreset, opts: ExportPlanOptions, pixels: number): string[] {
  const hw = (name: string) => opts.hardwareAcceleration && opts.hardwareEncoders.includes(name);
  // Rough bitrate target for hardware encoders that don't do CRF.
  const kbps = Math.round(((pixels * 30 * 0.1) / 1000) * (0.5 + preset.quality / 100));
  switch (preset.codec) {
    case 'none':
      return ['-vn'];
    case 'gif':
      return ['-loop', '0'];
    case 'prores':
      return ['-c:v', 'prores_ks', '-profile:v', '2'];
    case 'vp9':
      return ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(qualityToCrf(preset.quality, 'vp9')), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4'];
    case 'hevc':
      if (hw('hevc_videotoolbox')) return ['-c:v', 'hevc_videotoolbox', '-b:v', `${kbps}k`, '-tag:v', 'hvc1'];
      if (hw('hevc_nvenc')) return ['-c:v', 'hevc_nvenc', '-b:v', `${kbps}k`, '-tag:v', 'hvc1'];
      return ['-c:v', 'libx265', '-preset', 'medium', '-crf', String(qualityToCrf(preset.quality, 'hevc')), '-tag:v', 'hvc1'];
    case 'h264':
    default:
      if (hw('h264_videotoolbox')) return ['-c:v', 'h264_videotoolbox', '-b:v', `${kbps}k`, '-profile:v', 'high'];
      if (hw('h264_nvenc')) return ['-c:v', 'h264_nvenc', '-b:v', `${kbps}k`];
      if (hw('h264_qsv')) return ['-c:v', 'h264_qsv', '-b:v', `${kbps}k`];
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(qualityToCrf(preset.quality, 'h264')), '-profile:v', 'high'];
  }
}

function audioCodecArgs(preset: ExportPreset): string[] {
  const br = `${preset.audioBitrate || 192}k`;
  if (preset.format === 'webm') return ['-c:a', 'libopus', '-b:a', br];
  if (preset.format === 'mov' && preset.codec === 'prores') return ['-c:a', 'pcm_s16le'];
  return ['-c:a', 'aac', '-b:a', br];
}

/**
 * Contents of an ffmpeg concat-demuxer list that shows each caption image for its time range and a blank
 * image in between. `files` maps caption index to a PNG path; `blank` is a transparent full-canvas PNG.
 */
export function captionConcatList(segments: { start: number; end: number }[], files: string[], blank: string, total: number): string {
  const esc = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
  const lines: string[] = ['ffconcat version 1.0'];
  let t = 0;
  const push = (file: string, d: number) => {
    if (d <= 0.0005) return;
    lines.push(`file ${esc(file)}`, `duration ${f(d)}`);
  };
  segments.forEach((s, i) => {
    const start = Math.max(t, s.start);
    push(blank, start - t);
    const end = Math.min(Math.max(s.end, start), total);
    push(files[i], end - start);
    t = Math.max(t, end);
  });
  push(blank, Math.max(0.04, total - t));
  // The concat demuxer ignores the last duration, so repeat the final file.
  lines.push(`file ${esc(blank)}`);
  return lines.join('\n') + '\n';
}
