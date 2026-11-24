import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Rect } from '@shared/types';
import { annotationsAt, findClip, projectDuration, upsertAnnotation, upsertZoom, updateClip, videoClipsAt } from '@shared/timeline';
import { zoomAt } from '@shared/zoom';
import { useApp } from '../../store/app';
import { MediaPool, renderFrame, syncMedia } from '../../lib/playback';

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'start' | 'end';

export function Preview() {
  const project = useApp((s) => s.project)!;
  const selection = useApp((s) => s.selection);
  const playhead = useApp((s) => s.playhead);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const work = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const pool = useRef(new MediaPool());
  const [box, setBox] = useState({ w: 0, h: 0 });
  const needsRender = useRef(true);

  // Fit the canvas into the available space, keeping the project aspect ratio.
  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const aspect = project.width / project.height;
      let w = r.width;
      let h = w / aspect;
      if (h > r.height) {
        h = r.height;
        w = h * aspect;
      }
      setBox({ w: Math.floor(w), h: Math.floor(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  useEffect(() => {
    const c = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(1, (box.w * dpr) / project.width);
    c.width = Math.max(2, Math.round(project.width * scale));
    c.height = Math.max(2, Math.round(project.height * scale));
    needsRender.current = true;
  }, [box, project.width, project.height]);

  useEffect(() => {
    needsRender.current = true;
  }, [project, playhead, selection]);

  // Playback clock + render loop
  useEffect(() => {
    const p = pool.current;
    p.onFrame = () => (needsRender.current = true);
    let raf = 0;
    let base = 0;
    let wall = 0;
    let lastSet = -1;
    let wasPlaying = false;
    const loop = () => {
      const s = useApp.getState();
      const proj = s.project;
      if (!proj) return;
      let t = s.playhead;
      if (s.playing) {
        if (!wasPlaying || Math.abs(s.playhead - lastSet) > 1e-6) {
          base = s.playhead;
          wall = performance.now();
        }
        t = base + (performance.now() - wall) / 1000;
        const end = projectDuration(proj);
        if (t >= end) {
          t = end;
          s.setPlaying(false);
        }
        lastSet = t;
        s.setPlayhead(t);
      }
      wasPlaying = s.playing;
      if (s.playing || needsRender.current) {
        needsRender.current = false;
        const { video } = syncMedia(p, proj, t, s.playing);
        renderFrame({ work: work.current, out: canvas.current! }, proj, t, video, s.selection.kind === 'zoom');
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      p.pauseAll();
    };
  }, []);

  useEffect(() => () => pool.current.dispose(), []);

  return (
    <div ref={wrap} className="relative flex h-full w-full items-center justify-center">
      <div className="relative shadow-2xl" style={{ width: box.w, height: box.h }}>
        <canvas ref={canvas} className="checker h-full w-full" />
        <EditOverlay w={box.w} h={box.h} />
      </div>
    </div>
  );
}

/** Interactive handles for the selected annotation, clip or zoom, drawn over the preview. */
function EditOverlay({ w, h }: { w: number; h: number }) {
  const project = useApp((s) => s.project)!;
  const selection = useApp((s) => s.selection);
  const playhead = useApp((s) => s.playhead);
  const edit = useApp((s) => s.edit);
  const commit = useApp((s) => s.commitCoalesced);
  const select = useApp((s) => s.select);
  const playing = useApp((s) => s.playing);

  const zoom = selection.kind === 'zoom' ? { scale: 1, x: 0, y: 0 } : zoomAt(project.zooms, playhead);
  const toScreen = (r: Rect, zoomed: boolean): Rect => {
    if (!zoomed) return { x: r.x * w, y: r.y * h, w: r.w * w, h: r.h * h };
    return { x: (r.x - zoom.x) * zoom.scale * w, y: (r.y - zoom.y) * zoom.scale * h, w: r.w * zoom.scale * w, h: r.h * zoom.scale * h };
  };

  // What is being edited
  let target: { rect: Rect; zoomed: boolean; apply: (r: Rect) => void; arrow?: boolean; keepAspect?: boolean } | null = null;
  if (selection.kind === 'annotation') {
    const a = project.annotations.find((x) => x.id === selection.id);
    if (a && playhead >= a.start && playhead < a.end) {
      target = {
        rect: a.box,
        zoomed: true,
        arrow: a.type === 'arrow',
        keepAspect: a.type === 'step',
        apply: (r) => edit((p) => upsertAnnotation(p, { ...a, box: r }), true),
      };
    }
  } else if (selection.kind === 'clips' && selection.ids.length === 1) {
    const f = findClip(project, selection.ids[0]);
    const asset = f && project.assets.find((x) => x.id === f.clip.assetId);
    if (f && asset?.hasVideo && f.track.kind === 'video') {
      target = {
        rect: f.clip.transform,
        zoomed: asset.role !== 'camera',
        keepAspect: true,
        apply: (r) => edit((p) => updateClip(p, f.clip.id, { transform: r }), true),
      };
    }
  } else if (selection.kind === 'zoom') {
    const z = project.zooms.find((x) => x.id === selection.id);
    if (z) {
      const v = 1 / z.scale;
      const rect = { x: Math.min(1 - v, Math.max(0, z.cx - v / 2)), y: Math.min(1 - v, Math.max(0, z.cy - v / 2)), w: v, h: v };
      target = {
        rect,
        zoomed: false,
        keepAspect: true,
        apply: (r) => {
          const scale = Math.min(8, Math.max(1.1, 1 / Math.max(r.w, 0.05)));
          edit((p) => upsertZoom(p, { ...z, scale: Math.round(scale * 100) / 100, cx: r.x + r.w / 2, cy: r.y + r.h / 2 }), true);
        },
      };
    }
  }

  const startDrag = (e: React.PointerEvent, handle: Handle) => {
    if (!target) return;
    e.stopPropagation();
    e.preventDefault();
    const t = target;
    const sx = e.clientX;
    const sy = e.clientY;
    const r0 = { ...t.rect };
    const k = t.zoomed ? zoom.scale : 1;
    const aspect = (r0.w * w) / Math.max(1e-6, r0.h * h);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / (w * k);
      const dy = (ev.clientY - sy) / (h * k);
      let r = { ...r0 };
      if (handle === 'move') r = { ...r0, x: r0.x + dx, y: r0.y + dy };
      else if (handle === 'start') r = { x: r0.x + dx, y: r0.y + dy, w: r0.w - dx, h: r0.h - dy };
      else if (handle === 'end') r = { ...r0, w: r0.w + dx, h: r0.h + dy };
      else {
        const left = handle.includes('w');
        const top = handle.includes('n');
        let nw = left ? r0.w - dx : r0.w + dx;
        let nh = top ? r0.h - dy : r0.h + dy;
        if (t.keepAspect || ev.shiftKey) {
          nh = (nw * w) / aspect / h;
          if (selection.kind === 'zoom') nh = nw;
        }
        nw = Math.max(0.01, nw);
        nh = Math.max(0.01, nh);
        r = { x: left ? r0.x + r0.w - nw : r0.x, y: top ? r0.y + r0.h - nh : r0.y, w: nw, h: nh };
      }
      if (selection.kind === 'zoom') {
        r.x = Math.min(1 - r.w, Math.max(0, r.x));
        r.y = Math.min(1 - r.h, Math.max(0, r.y));
      }
      t.apply(r);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Click to select whatever is under the pointer (annotations first, then clips top-most first)
  const onBackgroundDown = (e: React.PointerEvent) => {
    if (playing) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = (e.clientX - rect.left) / w;
    const sy = (e.clientY - rect.top) / h;
    const unzoom = (x: number, y: number) => ({ x: zoom.x + x / zoom.scale, y: zoom.y + y / zoom.scale });
    const inside = (r: Rect, p: { x: number; y: number }) =>
      p.x >= Math.min(r.x, r.x + r.w) && p.x <= Math.max(r.x, r.x + r.w) && p.y >= Math.min(r.y, r.y + r.h) && p.y <= Math.max(r.y, r.y + r.h);
    const clips = videoClipsAt(project, playhead).reverse();
    const cam = clips.find((c) => c.asset.role === 'camera' && inside(c.clip.transform, { x: sx, y: sy }));
    if (cam) return select({ kind: 'clips', ids: [cam.clip.id] });
    const pz = unzoom(sx, sy);
    const ann = [...annotationsAt(project, playhead)].reverse().find((a) => a.type !== 'spotlight' && inside(a.box, pz));
    if (ann) {
      select({ kind: 'annotation', id: ann.id });
      return;
    }
    const clip = clips.find((c) => c.asset.role !== 'camera' && inside(c.clip.transform, pz));
    select(clip ? { kind: 'clips', ids: [clip.clip.id] } : { kind: 'none' });
  };

  const s = target ? toScreen(target.rect, target.zoomed) : null;
  const handleCls = 'absolute h-2.5 w-2.5 rounded-sm border border-white bg-accent-500 shadow';

  return (
    <div className="absolute inset-0 overflow-hidden" onPointerDown={onBackgroundDown}>
      {selection.kind === 'zoom' && (
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[11px] text-white">Drag the frame to set what the zoom shows</div>
      )}
      {s && target?.arrow && (
        <>
          <svg className="pointer-events-none absolute inset-0" width={w} height={h}>
            <line x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h} stroke="#14b8a6" strokeWidth={1} strokeDasharray="4 3" />
          </svg>
          <div className={handleCls} style={{ left: s.x - 5, top: s.y - 5, cursor: 'move' }} onPointerDown={(e) => startDrag(e, 'start')} />
          <div className={handleCls} style={{ left: s.x + s.w - 5, top: s.y + s.h - 5, cursor: 'move' }} onPointerDown={(e) => startDrag(e, 'end')} />
          <div
            className="absolute cursor-move"
            style={{ left: s.x + s.w / 2 - 8, top: s.y + s.h / 2 - 8, width: 16, height: 16 }}
            onPointerDown={(e) => startDrag(e, 'move')}
          />
        </>
      )}
      {s && !target?.arrow && (
        <div
          className={`absolute cursor-move border ${selection.kind === 'zoom' ? 'border-2 border-accent-400 bg-accent-500/10' : 'border-accent-400'}`}
          style={{ left: s.x, top: s.y, width: Math.abs(s.w), height: Math.abs(s.h) }}
          onPointerDown={(e) => startDrag(e, 'move')}
        >
          {(['nw', 'ne', 'sw', 'se'] as Handle[]).map((hd) => (
            <div
              key={hd}
              className={handleCls}
              style={{
                left: hd.includes('w') ? -5 : undefined,
                right: hd.includes('e') ? -5 : undefined,
                top: hd.includes('n') ? -5 : undefined,
                bottom: hd.includes('s') ? -5 : undefined,
                cursor: hd === 'nw' || hd === 'se' ? 'nwse-resize' : 'nesw-resize',
              }}
              onPointerDown={(e) => startDrag(e, hd)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
