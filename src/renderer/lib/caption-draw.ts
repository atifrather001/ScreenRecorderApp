// Caption styling shared by the preview and the export (burned-in captions).
import type { Project } from '@shared/types';

export function drawCaption(ctx: CanvasRenderingContext2D, text: string, W: number, H: number): void {
  if (!text) return;
  const size = Math.max(10, H * 0.042);
  ctx.save();
  ctx.font = `600 ${size}px -apple-system, "Segoe UI", system-ui, sans-serif`;
  const maxW = W * 0.8;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  const lh = size * 1.3;
  const padX = size * 0.6;
  const padY = size * 0.35;
  const bottom = H * 0.94;
  const boxW = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + padX * 2;
  const boxH = lines.length * lh + padY * 2;
  const x = (W - boxW) / 2;
  const y = bottom - boxH;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, size * 0.3);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y + padY + lh * i + lh / 2));
  ctx.restore();
}

export function captionPng(text: string, project: Project): string {
  const c = document.createElement('canvas');
  c.width = project.width;
  c.height = project.height;
  drawCaption(c.getContext('2d')!, text, c.width, c.height);
  return c.toDataURL('image/png');
}
