// Draws annotations on a 2D canvas. The same code renders the live preview and the PNGs used for export,
// so what you see is what you get.
import type { Annotation, Project } from '@shared/types';

const scaleFor = (H: number) => H / 1080;

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function normBox(a: Annotation, W: number, H: number) {
  const x1 = a.box.x * W;
  const y1 = a.box.y * H;
  const x2 = (a.box.x + a.box.w) * W;
  const y2 = (a.box.y + a.box.h) * H;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rr);
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export interface DrawOptions {
  /** Canvas that already holds the composited frame; used for blur. */
  blurSource?: CanvasImageSource;
}

export function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation, W: number, H: number, opts: DrawOptions = {}): void {
  const k = scaleFor(H);
  const b = normBox(a, W, H);
  const lw = Math.max(1, a.strokeWidth * k);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (a.type) {
    case 'rect': {
      roundRect(ctx, b.x, b.y, b.w, b.h, 10 * k);
      if (a.fill) {
        ctx.fillStyle = hexToRgba(a.color, 0.25);
        ctx.fill();
      }
      ctx.strokeStyle = a.color;
      ctx.lineWidth = lw;
      ctx.stroke();
      break;
    }
    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      if (a.fill) {
        ctx.fillStyle = hexToRgba(a.color, 0.25);
        ctx.fill();
      }
      ctx.strokeStyle = a.color;
      ctx.lineWidth = lw;
      ctx.stroke();
      break;
    }
    case 'arrow': {
      const x1 = a.box.x * W;
      const y1 = a.box.y * H;
      const x2 = (a.box.x + a.box.w) * W;
      const y2 = (a.box.y + a.box.h) * H;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(lw * 3.2, 14 * k);
      ctx.strokeStyle = a.color;
      ctx.fillStyle = a.color;
      ctx.lineWidth = lw;
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 6 * k;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2 - Math.cos(ang) * head * 0.8, y2 - Math.sin(ang) * head * 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45));
      ctx.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'highlight': {
      roundRect(ctx, b.x, b.y, b.w, b.h, 4 * k);
      ctx.fillStyle = hexToRgba(a.color, 0.35);
      ctx.fill();
      break;
    }
    case 'spotlight': {
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.roundRect(b.x, b.y, b.w, b.h, 12 * k);
      ctx.fillStyle = hexToRgba(a.color, 0.6);
      ctx.fill('evenodd');
      break;
    }
    case 'blur': {
      if (opts.blurSource && b.w > 2 && b.h > 2) {
        ctx.beginPath();
        ctx.rect(b.x, b.y, b.w, b.h);
        ctx.clip();
        ctx.filter = `blur(${Math.max(4, Math.min(b.w, b.h) / 12)}px)`;
        ctx.drawImage(opts.blurSource, 0, 0, W, H);
        ctx.filter = 'none';
      }
      break;
    }
    case 'step': {
      const r = Math.min(b.w, b.h) / 2;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 8 * k;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = a.color;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(2, r * 0.08);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${r * 1.1}px -apple-system, "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.text, cx, cy + r * 0.05);
      break;
    }
    case 'text': {
      const size = Math.max(6, a.fontSize * H);
      ctx.font = `600 ${size}px -apple-system, "Segoe UI", system-ui, sans-serif`;
      const pad = size * 0.4;
      const lines = wrapLines(ctx, a.text || ' ', Math.max(size, b.w - pad * 2));
      const lh = size * 1.25;
      const textH = lines.length * lh;
      if (a.fill) {
        roundRect(ctx, b.x, b.y, b.w, Math.max(b.h, textH + pad * 2), size * 0.3);
        ctx.fillStyle = 'rgba(12, 14, 20, 0.78)';
        ctx.fill();
      } else {
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = size * 0.15;
      }
      ctx.fillStyle = a.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const boxH = Math.max(b.h, textH + pad * 2);
      const top = b.y + (boxH - textH) / 2 + lh / 2;
      lines.forEach((l, i) => ctx.fillText(l, b.x + b.w / 2, top + i * lh));
      break;
    }
  }
  ctx.restore();
}

/** Render one annotation to a transparent PNG at the project's canvas size (for ffmpeg). */
export function annotationPng(a: Annotation, project: Project): string {
  const c = document.createElement('canvas');
  c.width = project.width;
  c.height = project.height;
  const ctx = c.getContext('2d')!;
  drawAnnotation(ctx, a, c.width, c.height);
  return c.toDataURL('image/png');
}

export const ANNOTATION_LABELS: Record<Annotation['type'], string> = {
  text: 'Text',
  rect: 'Box',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
  highlight: 'Highlight',
  spotlight: 'Spotlight',
  blur: 'Blur',
  step: 'Step number',
};
