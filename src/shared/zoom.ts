// Zoom-and-pan maths shared by the live preview and the ffmpeg export,
// so both produce the same framing.
import type { ZoomRegion } from './types';

export interface ZoomState {
  scale: number;
  /** Top-left of the visible window, normalised. */
  x: number;
  y: number;
}

const smooth = (p: number) => p * p * (3 - 2 * p);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function zoomProgress(z: ZoomRegion, t: number): number {
  if (t < z.start || t > z.end) return 0;
  const ramp = Math.max(0.001, Math.min(z.ease, (z.end - z.start) / 2));
  const p = Math.min((t - z.start) / ramp, (z.end - t) / ramp, 1);
  return smooth(clamp(p, 0, 1));
}

export function zoomAt(zooms: ZoomRegion[], t: number): ZoomState {
  let scale = 1;
  let cx = 0.5;
  let cy = 0.5;
  for (const z of zooms) {
    const p = zoomProgress(z, t);
    if (p <= 0) continue;
    scale = 1 + (z.scale - 1) * p;
    cx = 0.5 + (z.cx - 0.5) * p;
    cy = 0.5 + (z.cy - 0.5) * p;
    break;
  }
  const view = 1 / scale;
  return {
    scale,
    x: clamp(cx - view / 2, 0, 1 - view),
    y: clamp(cy - view / 2, 0, 1 - view),
  };
}

const n = (v: number) => (Math.round(v * 10000) / 10000).toString();

/**
 * ffmpeg expression for the eased progress of one zoom region, in terms of the variable `T`
 * (seconds). Mirrors zoomProgress().
 */
function progressExpr(z: ZoomRegion, T: string): string {
  const ramp = Math.max(0.001, Math.min(z.ease, (z.end - z.start) / 2));
  const lin = `clip(min((${T}-${n(z.start)})/${n(ramp)},(${n(z.end)}-${T})/${n(ramp)}),0,1)`;
  // smoothstep: p*p*(3-2p)
  return `(${lin})*(${lin})*(3-2*(${lin}))`;
}

/**
 * Builds the z/x/y expressions for ffmpeg's zoompan filter. `T` is an expression for the
 * current time in seconds (e.g. `in/30`). Regions never overlap, so sums are safe.
 */
export function zoompanExpressions(zooms: ZoomRegion[], T: string): { z: string; x: string; y: string } {
  if (!zooms.length) return { z: '1', x: '0', y: '0' };
  const zTerms = zooms.map((z) => `${n(z.scale - 1)}*${progressExpr(z, T)}`);
  const cxTerms = zooms.map((z) => `${n(z.cx - 0.5)}*${progressExpr(z, T)}`);
  const cyTerms = zooms.map((z) => `${n(z.cy - 0.5)}*${progressExpr(z, T)}`);
  const zExpr = `1+${zTerms.join('+')}`;
  // zoompan: x,y are the top-left of the crop window in input pixels; `zoom` is the current z.
  const x = `clip((0.5+${cxTerms.join('+')})*iw-iw/zoom/2,0,iw-iw/zoom)`;
  const y = `clip((0.5+${cyTerms.join('+')})*ih-ih/zoom/2,0,ih-ih/zoom)`;
  return { z: zExpr, x, y };
}
