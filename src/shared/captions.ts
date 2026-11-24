// Caption helpers: tidy raw speech-to-text segments and write subtitle files.
import type { CaptionSegment } from './types';
import { uid } from './timeline';

const MAX_CHARS = 84;
const MAX_DURATION = 7;

/** Text Whisper tends to produce for silence or noise. */
const NOISE = /^\s*(\[.*\]|\(.*\)|♪+|thank you\.?|thanks for watching!?|you|\.+|-)\s*$/i;

/** Clean, drop noise and split long segments into readable caption lengths (timing split by characters). */
export function normaliseSegments(raw: { start: number; end: number; text: string }[]): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  for (const r of raw) {
    const text = r.text.replace(/\s+/g, ' ').trim();
    if (!text || NOISE.test(text) || !(r.end > r.start)) continue;
    const pieces = splitText(text);
    const total = pieces.reduce((n, p) => n + p.length, 0);
    let t = r.start;
    for (const p of pieces) {
      const d = ((r.end - r.start) * p.length) / total;
      out.push({ id: uid('cap'), start: round(t), end: round(t + d), text: p });
      t += d;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function splitText(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text];
  const words = text.split(' ');
  const pieces: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > MAX_CHARS && cur) {
      pieces.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) pieces.push(cur);
  return pieces;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Join fragments of a few words onto the caption before them when they follow without a pause. */
export function mergeShort(segs: CaptionSegment[]): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    const words = s.text.split(' ').length;
    const prevWords = prev ? prev.text.split(' ').length : 0;
    if (prev && (words < 4 || prevWords < 4) && s.start - prev.end < 0.8 && prev.text.length + s.text.length + 1 <= MAX_CHARS) {
      out[out.length - 1] = { ...prev, end: Math.max(prev.end, s.end), text: `${prev.text} ${s.text}` };
    } else out.push(s);
  }
  return out;
}

/** Merge fragments, then cap overly long captions so they don't linger over silence. */
export function capDurations(input: CaptionSegment[]): CaptionSegment[] {
  const segs = mergeShort([...input].sort((a, b) => a.start - b.start));
  return segs.map((s, i) => {
    const next = segs[i + 1];
    let end = Math.min(s.end, s.start + MAX_DURATION);
    if (next && end > next.start) end = next.start;
    return { ...s, end: round(Math.max(end, s.start + 0.3)) };
  });
}

function stamp(t: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(ms % 1000, 3)}`;
}

export function toSrt(segs: CaptionSegment[]): string {
  return segs.map((s, i) => `${i + 1}\n${stamp(s.start, ',')} --> ${stamp(s.end, ',')}\n${s.text}\n`).join('\n');
}

export function toVtt(segs: CaptionSegment[]): string {
  return `WEBVTT\n\n${segs.map((s) => `${stamp(s.start, '.')} --> ${stamp(s.end, '.')}\n${s.text}\n`).join('\n')}`;
}

/** Plain transcript with a timestamp at the start of each paragraph (new paragraph after a 2s pause). */
export function toTranscript(segs: CaptionSegment[], withTimes = true): string {
  const paras: { start: number; text: string[] }[] = [];
  let lastEnd = -Infinity;
  for (const s of segs) {
    if (!paras.length || s.start - lastEnd > 2) paras.push({ start: s.start, text: [] });
    paras[paras.length - 1].text.push(s.text);
    lastEnd = s.end;
  }
  return paras
    .map((p) => {
      const m = Math.floor(p.start / 60);
      const sec = Math.floor(p.start % 60);
      const t = `[${m}:${String(sec).padStart(2, '0')}] `;
      return `${withTimes ? t : ''}${p.text.join(' ')}`;
    })
    .join('\n\n');
}

export function captionAt(segs: CaptionSegment[] | undefined, t: number): CaptionSegment | undefined {
  return segs?.find((s) => t >= s.start && t < s.end);
}
