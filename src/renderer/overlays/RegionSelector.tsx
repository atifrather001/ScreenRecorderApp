import { useEffect, useRef, useState } from 'react';
import type { Rect } from '@shared/types';

/** Full-screen overlay: drag to choose a recording area, Enter to confirm, Esc to cancel. */
export function RegionSelector() {
  const [rect, setRect] = useState<Rect | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const size = { w: window.innerWidth, h: window.innerHeight };

  const confirm = (r: Rect | null) => {
    if (!r || r.w < 16 || r.h < 16) return window.api.regionDone(null);
    // Even pixel sizes keep video encoders happy; return normalised to the display.
    const w = Math.round(r.w / 2) * 2;
    const h = Math.round(r.h / 2) * 2;
    window.api.regionDone({ x: r.x / size.w, y: r.y / size.h, w: w / size.w, h: h / size.h });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.api.regionDone(null);
      if (e.key === 'Enter') confirm(rect);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const { x, y } = drag.current;
    setRect({ x: Math.min(x, e.clientX), y: Math.min(y, e.clientY), w: Math.abs(e.clientX - x), h: Math.abs(e.clientY - y) });
  };
  const onUp = () => {
    drag.current = null;
  };

  const presets: [string, number][] = [
    ['16:9', 16 / 9],
    ['4:3', 4 / 3],
    ['1:1', 1],
    ['9:16', 9 / 16],
  ];
  const applyPreset = (ratio: number) => {
    let w = size.w * 0.6;
    let h = w / ratio;
    if (h > size.h * 0.8) {
      h = size.h * 0.8;
      w = h * ratio;
    }
    setRect({ x: (size.w - w) / 2, y: (size.h - h) / 2, w, h });
  };

  return (
    <div className="fixed inset-0 cursor-crosshair" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      <svg className="pointer-events-none absolute inset-0" width="100%" height="100%">
        <defs>
          <mask id="hole">
            <rect width="100%" height="100%" fill="white" />
            {rect && <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.45)" mask="url(#hole)" />
        {rect && <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="none" stroke="#14b8a6" strokeWidth={2} strokeDasharray="6 4" />}
      </svg>
      {rect && rect.w > 0 && (
        <div className="pointer-events-none absolute rounded bg-black/80 px-2 py-0.5 font-mono text-xs text-white" style={{ left: rect.x, top: Math.max(0, rect.y - 24) }}>
          {Math.round(rect.w * window.devicePixelRatio)} × {Math.round(rect.h * window.devicePixelRatio)}
        </div>
      )}
      <div
        className="absolute left-1/2 top-6 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/10 bg-ink-900/95 px-3 py-2 text-[13px] text-ink-200 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="pr-1 text-ink-300">Drag to select an area</span>
        {presets.map(([label, r]) => (
          <button key={label} className="rounded-md bg-ink-800 px-2 py-1 text-xs hover:bg-ink-700" onClick={() => applyPreset(r)}>
            {label}
          </button>
        ))}
        <button className="rounded-md px-2 py-1 text-xs text-ink-300 hover:bg-ink-800" onClick={() => window.api.regionDone(null)}>
          Cancel
        </button>
        <button
          disabled={!rect || rect.w < 16 || rect.h < 16}
          className="rounded-md bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-500 disabled:opacity-40"
          onClick={() => confirm(rect)}
        >
          Use area
        </button>
      </div>
    </div>
  );
}
