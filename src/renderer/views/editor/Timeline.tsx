import React, { memo, useEffect, useMemo, useRef } from 'react';
import { clsx } from 'clsx';
import { Eye, EyeOff, Lock, Mic, Search, Trash2, Unlock, Volume2, VolumeX } from 'lucide-react';
import type { Annotation, Clip, Project, Track, ZoomRegion } from '@shared/types';
import {
  assetDisplaySize,
  clipEnd,
  clipLength,
  deleteAnnotations,
  deleteClips,
  deleteZooms,
  fitTransform,
  splitAt,
  updateClip,
  uid,
  getAsset,
  moveClip,
  placeAsset,
  projectDuration,
  removeTrack,
  round,
  snapTime,
  trimClip,
  updateTrack,
  upsertAnnotation,
  upsertZoom,
} from '@shared/timeline';
import { useApp } from '../../store/app';
import { formatTime } from '../../lib/format';
import { ANNOTATION_LABELS } from '../../lib/annotations';

const HEADER_W = 172;
const RULER_H = 26;
const ZOOM_H = 26;
const ANN_H = 24;
const VIDEO_H = 58;
const AUDIO_H = 44;
const SNAP_PX = 8;

export const ASSET_MIME = 'application/x-sra-asset';

function annotationLanes(anns: Annotation[]): Map<string, number> {
  const lanes: number[] = [];
  const out = new Map<string, number>();
  for (const a of [...anns].sort((x, y) => x.start - y.start)) {
    let lane = lanes.findIndex((end) => end <= a.start + 1e-6);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = a.end;
    out.set(a.id, lane);
  }
  return out;
}

/** Drag helper: calls onMove with pixel deltas and the pointer event, onEnd when released. */
function drag(e: React.PointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onEnd?: () => void) {
  e.stopPropagation();
  e.preventDefault();
  const sx = e.clientX;
  const sy = e.clientY;
  let moved = false;
  const move = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return;
    moved = true;
    onMove(ev.clientX - sx, ev.clientY - sy, ev);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    onEnd?.();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

export function Timeline() {
  const project = useApp((s) => s.project)!;
  const pps = useApp((s) => s.pxPerSec);
  const setPps = useApp((s) => s.setPxPerSec);
  const setPlayhead = useApp((s) => s.setPlayhead);
  const select = useApp((s) => s.select);
  const scroller = useRef<HTMLDivElement>(null);

  const duration = projectDuration(project);
  const lanes = useMemo(() => annotationLanes(project.annotations), [project.annotations]);
  const laneCount = Math.max(1, ...[...lanes.values()].map((l) => l + 1));
  const contentW = Math.max((duration + 30) * pps, 1200);

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, (clientX - r.left - HEADER_W + el.scrollLeft) / pps);
  };

  const snap = (t: number, ignore?: string, extra: number[] = []) =>
    snapTime(project, t, SNAP_PX / pps, [useApp.getState().playhead, ...extra, ...project.annotations.flatMap((a) => [a.start, a.end])], ignore);

  // Ctrl/Cmd + wheel zooms around the pointer
  useEffect(() => {
    const el = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const s = useApp.getState();
      const t = timeAt(e.clientX);
      const next = Math.min(400, Math.max(2, s.pxPerSec * Math.exp(-e.deltaY * 0.01)));
      s.setPxPerSec(next);
      requestAnimationFrame(() => {
        el.scrollLeft = t * next - (e.clientX - el.getBoundingClientRect().left - HEADER_W);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // Keep the playhead in view while playing
  useEffect(
    () =>
      useApp.subscribe((s, prev) => {
        if (!s.playing || s.playhead === prev.playhead) return;
        const el = scroller.current;
        if (!el) return;
        const x = s.playhead * s.pxPerSec;
        const view = el.clientWidth - HEADER_W;
        if (x > el.scrollLeft + view - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
      }),
    [],
  );

  const scrub = (e: React.PointerEvent) => {
    useApp.getState().setPlaying(false);
    setPlayhead(snap(timeAt(e.clientX)));
    drag(e, (_dx, _dy, ev) => setPlayhead(timeAt(ev.clientX)));
  };

  const fit = () => {
    const el = scroller.current!;
    setPps(Math.max(2, (el.clientWidth - HEADER_W - 40) / Math.max(1, duration)));
    el.scrollLeft = 0;
  };

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) select({ kind: 'none' });
        }}
      >
        <div className="relative" style={{ width: contentW + HEADER_W, minHeight: '100%' }} onPointerDown={(e) => e.target === e.currentTarget && select({ kind: 'none' })}>
          {/* Ruler */}
          <div className="sticky top-0 z-20 flex" style={{ height: RULER_H }}>
            <div className="sticky left-0 z-30 flex shrink-0 items-center gap-1 border-b border-r border-ink-800 bg-ink-900 px-2" style={{ width: HEADER_W }}>
              <button className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-200" title="Fit timeline" onClick={fit}>
                <Search size={13} />
              </button>
              <input
                type="range"
                className="w-24"
                min={Math.log(2)}
                max={Math.log(400)}
                step={0.01}
                value={Math.log(pps)}
                onChange={(e) => setPps(Math.exp(parseFloat(e.target.value)))}
                title="Timeline zoom"
              />
            </div>
            <Ruler pps={pps} width={contentW} onPointerDown={scrub} />
          </div>

          {/* Zoom row */}
          <Row label="Zoom & pan" height={ZOOM_H} kind="special">
            {project.zooms.map((z) => (
              <ZoomBar key={z.id} z={z} pps={pps} snap={snap} />
            ))}
          </Row>

          {/* Annotation lanes */}
          {Array.from({ length: laneCount }, (_, lane) => (
            <Row key={`lane${lane}`} label={lane === 0 ? 'Annotations' : ''} height={ANN_H} kind="special">
              {project.annotations
                .filter((a) => (lanes.get(a.id) ?? 0) === lane)
                .map((a) => (
                  <AnnotationBar key={a.id} a={a} pps={pps} snap={snap} />
                ))}
            </Row>
          ))}

          {/* Tracks */}
          {project.tracks.map((t) => (
            <TrackRow key={t.id} track={t} project={project} pps={pps} timeAt={timeAt} snap={snap} />
          ))}

          <Playhead pps={pps} />
        </div>
      </div>
      <div className="flex h-6 shrink-0 items-center gap-3 border-t border-ink-800 bg-ink-900 px-3 text-[11px] text-ink-500">
        <span>Duration {formatTime(duration, true)}</span>
        <span>
          {project.width}×{project.height} · {project.fps} fps
        </span>
        <span className="ml-auto">Drag edges to trim · {window.api.platform === 'darwin' ? '⌘' : 'Ctrl'}+B split · Del delete · ⇧Del ripple delete · {window.api.platform === 'darwin' ? '⌘' : 'Ctrl'}+scroll zoom</span>
      </div>
    </div>
  );
}

function Ruler({ pps, width, onPointerDown }: { pps: number; width: number; onPointerDown: (e: React.PointerEvent) => void }) {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const major = steps.find((s) => s * pps >= 80) ?? 600;
  const minor = major / 5;
  const ticks: React.ReactNode[] = [];
  for (let t = 0; t * pps <= width; t = round(t + minor, 10000)) {
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ticks.push(
      <div key={t} className="absolute bottom-0 border-l border-ink-600" style={{ left: t * pps, height: isMajor ? 10 : 5 }}>
        {isMajor && <span className="absolute -top-[13px] left-1 whitespace-nowrap text-[10px] text-ink-400">{formatTime(t, major < 1)}</span>}
      </div>,
    );
  }
  return (
    <div className="relative cursor-pointer border-b border-ink-800 bg-ink-900" style={{ width }} onPointerDown={onPointerDown}>
      {ticks}
    </div>
  );
}

function Row({ label, height, kind, children, header }: { label: string; height: number; kind: 'special' | 'video' | 'audio'; children: React.ReactNode; header?: React.ReactNode }) {
  return (
    <div className="flex" style={{ height }}>
      <div
        className={clsx(
          'sticky left-0 z-10 flex shrink-0 items-center border-b border-r border-ink-800 px-2 text-[11px]',
          kind === 'special' ? 'bg-ink-900 text-ink-500' : 'bg-ink-850 text-ink-300',
        )}
        style={{ width: HEADER_W }}
      >
        {header ?? label}
      </div>
      <div className={clsx('relative flex-1 border-b border-ink-800/70', kind === 'special' ? 'bg-ink-950' : 'bg-ink-900/40')}>{children}</div>
    </div>
  );
}

function Playhead({ pps }: { pps: number }) {
  const t = useApp((s) => s.playhead);
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-30" style={{ left: HEADER_W + t * pps }}>
      <div className="absolute -left-[6px] top-[12px] h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-rose-500" />
      <div className="absolute bottom-0 top-[12px] w-px bg-rose-500" />
    </div>
  );
}

type SnapFn = (t: number, ignore?: string, extra?: number[]) => number;

const TrackRow = memo(function TrackRow({
  track,
  project,
  pps,
  timeAt,
  snap,
}: {
  track: Track;
  project: Project;
  pps: number;
  timeAt: (x: number) => number;
  snap: SnapFn;
}) {
  const edit = useApp((s) => s.edit);
  const select = useApp((s) => s.select);
  const toast = useApp((s) => s.toast);
  const h = track.kind === 'video' ? VIDEO_H : AUDIO_H;

  const header = (
    <div className="flex w-full items-center gap-1">
      {track.kind === 'audio' ? <Mic size={12} className="shrink-0 text-ink-500" /> : null}
      <input
        className="min-w-0 flex-1 bg-transparent text-[12px] text-ink-200 outline-none"
        value={track.name}
        onChange={(e) => edit((p) => updateTrack(p, track.id, { name: e.target.value }), true)}
        onBlur={() => useApp.getState().commitCoalesced()}
      />
      <TrackBtn label={track.muted ? 'Unmute' : 'Mute'} on={track.muted} onClick={() => edit((p) => updateTrack(p, track.id, { muted: !track.muted }))}>
        {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
      </TrackBtn>
      {track.kind === 'video' && (
        <TrackBtn label={track.hidden ? 'Show' : 'Hide'} on={track.hidden} onClick={() => edit((p) => updateTrack(p, track.id, { hidden: !track.hidden }))}>
          {track.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </TrackBtn>
      )}
      <TrackBtn label={track.locked ? 'Unlock' : 'Lock'} on={track.locked} onClick={() => edit((p) => updateTrack(p, track.id, { locked: !track.locked }))}>
        {track.locked ? <Lock size={12} /> : <Unlock size={12} />}
      </TrackBtn>
      <TrackBtn
        label="Delete track"
        onClick={() => {
          if (track.clips.length && !window.confirm(`Delete “${track.name}” and its ${track.clips.length} clip(s)?`)) return;
          edit((p) => removeTrack(p, track.id));
        }}
      >
        <Trash2 size={12} />
      </TrackBtn>
    </div>
  );

  return (
    <div data-track-id={track.id}>
      <Row label={track.name} height={h} kind={track.kind} header={header}>
        <div
          className={clsx('absolute inset-0', track.locked && 'bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(255,255,255,0.02)_6px,rgba(255,255,255,0.02)_12px)]')}
          onPointerDown={(e) => e.target === e.currentTarget && select({ kind: 'none' })}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(ASSET_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => {
            const assetId = e.dataTransfer.getData(ASSET_MIME);
            if (!assetId) return;
            e.preventDefault();
            const asset = getAsset(project, assetId);
            if (!asset) return;
            if (track.locked) return toast('That track is locked', 'error');
            if (track.kind === 'audio' && !asset.hasAudio) return toast('That file has no audio', 'error');
            if (track.kind === 'video' && !asset.hasVideo) return toast('Audio files go on an audio track', 'error');
            let clipId = '';
            edit((p) => {
              const r = placeAsset(p, assetId, track.id, snap(timeAt(e.clientX)));
              clipId = r.clipId;
              return r.project;
            });
            if (clipId) select({ kind: 'clips', ids: [clipId] });
          }}
        />
        {track.clips.map((c) => (
          <ClipBlock key={c.id} clip={c} track={track} project={project} pps={pps} snap={snap} />
        ))}
      </Row>
    </div>
  );
});

function TrackBtn({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={label} aria-label={label} onClick={onClick} className={clsx('rounded p-1 hover:bg-ink-700', on ? 'text-amber-400' : 'text-ink-500 hover:text-ink-200')}>
      {children}
    </button>
  );
}

const ROLE_COLORS: Record<string, string> = {
  screen: 'bg-sky-700/80 border-sky-500',
  camera: 'bg-violet-700/80 border-violet-500',
  microphone: 'bg-emerald-700/80 border-emerald-500',
  imported: 'bg-indigo-700/80 border-indigo-500',
  audio: 'bg-emerald-800/80 border-emerald-600',
};

function ClipBlock({ clip, track, project, pps, snap }: { clip: Clip; track: Track; project: Project; pps: number; snap: SnapFn }) {
  const selected = useApp((s) => s.selection.kind === 'clips' && s.selection.ids.includes(clip.id));
  const asset = getAsset(project, clip.assetId);
  const left = clip.start * pps;
  const width = Math.max(4, clipLength(clip) * pps);
  const color = !asset ? 'bg-rose-900 border-rose-600' : track.kind === 'audio' ? ROLE_COLORS[asset.role === 'microphone' ? 'microphone' : 'audio'] : ROLE_COLORS[asset.role];

  const onBody = (e: React.PointerEvent) => {
    const s = useApp.getState();
    const sel = s.selection;
    if (e.shiftKey || e.metaKey) {
      const ids = sel.kind === 'clips' ? sel.ids : [];
      s.select({ kind: 'clips', ids: ids.includes(clip.id) ? ids.filter((i) => i !== clip.id) : [...ids, clip.id] });
      return;
    }
    s.select({ kind: 'clips', ids: [clip.id] });
    if (track.locked) return;
    const start0 = clip.start;
    const len = clipLength(clip);
    drag(
      e,
      (dx, _dy, ev) => {
        let t = start0 + dx / pps;
        // snap either edge
        const a = snap(t, clip.id);
        const b = snap(t + len, clip.id) - len;
        t = Math.abs(a - t) <= Math.abs(b - t) ? a : b;
        const row = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-track-id]') as HTMLElement | null;
        const targetId = row?.dataset.trackId ?? track.id;
        s.edit((p) => moveClip(p, clip.id, round(t), targetId), true);
      },
      () => s.commitCoalesced(),
    );
  };

  const onEdge = (edge: 'left' | 'right') => (e: React.PointerEvent) => {
    const s = useApp.getState();
    s.select({ kind: 'clips', ids: [clip.id] });
    if (track.locked) return;
    const t0 = edge === 'left' ? clip.start : clipEnd(clip);
    drag(
      e,
      (dx) => s.edit((p) => trimClip(p, clip.id, edge, snap(t0 + dx / pps, clip.id)), true),
      () => s.commitCoalesced(),
    );
  };

  const onContext = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const s = useApp.getState();
    const sel = s.selection;
    const ids = sel.kind === 'clips' && sel.ids.includes(clip.id) ? sel.ids : [clip.id];
    s.select({ kind: 'clips', ids });
    const under = s.playhead > clip.start && s.playhead < clipEnd(clip);
    const mod = window.api.platform === 'darwin' ? 'Cmd' : 'Ctrl';
    const choice = await window.api.contextMenu([
      { id: 'split', label: 'Split at Playhead', enabled: under && !track.locked, accelerator: `${mod}+B` },
      { id: 'playhead', label: 'Move Playhead Here' },
      { type: 'separator' },
      { id: 'mute', label: clip.muted ? 'Unmute Clip' : 'Mute Clip', enabled: !!asset?.hasAudio },
      { id: 'fit', label: 'Fit to Canvas', enabled: !!asset?.hasVideo && track.kind === 'video' },
      { id: 'fill', label: 'Fill Canvas', enabled: !!asset?.hasVideo && track.kind === 'video' },
      { type: 'separator' },
      { id: 'reveal', label: window.api.platform === 'darwin' ? 'Show Source in Finder' : 'Show Source in Folder', enabled: !!asset },
      { type: 'separator' },
      { id: 'delete', label: ids.length > 1 ? `Delete ${ids.length} Clips` : 'Delete', enabled: !track.locked, accelerator: 'Backspace' },
      { id: 'ripple', label: 'Ripple Delete', enabled: !track.locked, accelerator: 'Shift+Backspace' },
    ]);
    switch (choice) {
      case 'split':
        s.edit((p) => splitAt(p, s.playhead, [clip.id]));
        break;
      case 'playhead':
        s.setPlayhead(clip.start);
        break;
      case 'mute':
        s.edit((p) => updateClip(p, clip.id, { muted: !clip.muted }));
        break;
      case 'fit':
        if (asset) {
          const d = assetDisplaySize(asset);
          s.edit((p) => updateClip(p, clip.id, { transform: fitTransform(p, d.w, d.h) }));
        }
        break;
      case 'fill':
        s.edit((p) => updateClip(p, clip.id, { transform: { x: 0, y: 0, w: 1, h: 1 } }));
        break;
      case 'reveal':
        if (asset) void window.api.revealInFolder(asset.path);
        break;
      case 'delete':
      case 'ripple':
        s.edit((p) => deleteClips(p, ids, choice === 'ripple'));
        s.select({ kind: 'none' });
        break;
    }
  };

  return (
    <div
      onContextMenu={(e) => void onContext(e)}
      className={clsx(
        'group absolute bottom-1 top-1 cursor-grab overflow-hidden rounded-md border text-[11px] text-white/90 active:cursor-grabbing',
        color,
        selected && 'ring-2 ring-white',
        clip.muted && 'opacity-60',
      )}
      style={{ left, width }}
      onPointerDown={onBody}
      title={asset?.name}
    >
      {asset?.hasVideo && track.kind === 'video' && width > 40 && <Filmstrip assetPath={asset.path} kind={asset.kind} />}
      <div className="relative flex items-center gap-1 truncate px-2 pt-0.5 font-medium drop-shadow">
        {clip.muted && <VolumeX size={10} />}
        {asset?.name ?? 'Missing media'}
      </div>
      {track.kind === 'audio' && <div className="absolute inset-x-2 bottom-1.5 top-5 rounded-sm bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.25)_0_2px,transparent_2px_4px)] opacity-60" />}
      <div className="absolute bottom-0 left-0 top-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40" onPointerDown={onEdge('left')} />
      <div className="absolute bottom-0 right-0 top-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40" onPointerDown={onEdge('right')} />
    </div>
  );
}

/** A single poster frame tiled across the clip. Cheap and good enough to recognise clips. */
const Filmstrip = memo(function Filmstrip({ assetPath, kind }: { assetPath: string; kind: string }) {
  const url = window.api.mediaUrl(assetPath);
  if (kind === 'image') return <div className="absolute inset-0 opacity-40" style={{ backgroundImage: `url("${url}")`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} />;
  return <video className="pointer-events-none absolute inset-y-0 left-0 h-full opacity-40" src={`${url}#t=0.5`} preload="metadata" muted />;
});

function AnnotationBar({ a, pps, snap }: { a: Annotation; pps: number; snap: SnapFn }) {
  const selected = useApp((s) => s.selection.kind === 'annotation' && s.selection.id === a.id);
  const onDrag = (mode: 'move' | 'left' | 'right') => (e: React.PointerEvent) => {
    const s = useApp.getState();
    s.select({ kind: 'annotation', id: a.id });
    if (mode === 'move') s.setPlayhead(Math.max(s.playhead, a.start) < a.end ? Math.max(s.playhead, a.start) : a.start);
    const len = a.end - a.start;
    drag(
      e,
      (dx) => {
        const d = dx / pps;
        let next = a;
        if (mode === 'move') {
          const start = Math.max(0, snap(a.start + d));
          next = { ...a, start: round(start), end: round(start + len) };
        } else if (mode === 'left') next = { ...a, start: round(Math.min(a.end - 0.2, Math.max(0, snap(a.start + d)))) };
        else next = { ...a, end: round(Math.max(a.start + 0.2, snap(a.end + d))) };
        s.edit((p) => upsertAnnotation(p, next), true);
      },
      () => s.commitCoalesced(),
    );
  };
  const onContext = async (e: React.MouseEvent) => {
    e.preventDefault();
    const s = useApp.getState();
    s.select({ kind: 'annotation', id: a.id });
    const choice = await window.api.contextMenu([
      { id: 'duplicate', label: 'Duplicate' },
      { id: 'playhead', label: 'Move to Playhead' },
      { id: 'jump', label: 'Move Playhead Here' },
      { type: 'separator' },
      { id: 'delete', label: 'Delete', accelerator: 'Backspace' },
    ]);
    const len = a.end - a.start;
    if (choice === 'duplicate') {
      const copy = { ...a, id: uid('ann'), start: round(a.end), end: round(a.end + len) };
      s.edit((p) => upsertAnnotation(p, copy));
      s.select({ kind: 'annotation', id: copy.id });
    } else if (choice === 'playhead') s.edit((p) => upsertAnnotation(p, { ...a, start: round(s.playhead), end: round(s.playhead + len) }));
    else if (choice === 'jump') s.setPlayhead(a.start);
    else if (choice === 'delete') {
      s.edit((p) => deleteAnnotations(p, [a.id]));
      s.select({ kind: 'none' });
    }
  };
  return (
    <div
      onContextMenu={(e) => void onContext(e)}
      className={clsx('absolute bottom-0.5 top-0.5 cursor-grab truncate rounded border border-amber-500 bg-amber-600/70 px-1.5 text-[10.5px] leading-[18px] text-white', selected && 'ring-2 ring-white')}
      style={{ left: a.start * pps, width: Math.max(6, (a.end - a.start) * pps) }}
      onPointerDown={onDrag('move')}
    >
      {ANNOTATION_LABELS[a.type]}
      {a.type === 'text' || a.type === 'step' ? `: ${a.text}` : ''}
      <div className="absolute bottom-0 left-0 top-0 w-1.5 cursor-ew-resize" onPointerDown={onDrag('left')} />
      <div className="absolute bottom-0 right-0 top-0 w-1.5 cursor-ew-resize" onPointerDown={onDrag('right')} />
    </div>
  );
}

function ZoomBar({ z, pps, snap }: { z: ZoomRegion; pps: number; snap: SnapFn }) {
  const selected = useApp((s) => s.selection.kind === 'zoom' && s.selection.id === z.id);
  const onDrag = (mode: 'move' | 'left' | 'right') => (e: React.PointerEvent) => {
    const s = useApp.getState();
    s.select({ kind: 'zoom', id: z.id });
    s.setPlayhead((z.start + z.end) / 2);
    const len = z.end - z.start;
    drag(
      e,
      (dx) => {
        const d = dx / pps;
        let next = z;
        if (mode === 'move') {
          const start = Math.max(0, snap(z.start + d));
          next = { ...z, start, end: start + len };
        } else if (mode === 'left') next = { ...z, start: Math.min(z.end - 0.3, Math.max(0, snap(z.start + d))) };
        else next = { ...z, end: Math.max(z.start + 0.3, snap(z.end + d)) };
        s.edit((p) => upsertZoom(p, next), true);
      },
      () => s.commitCoalesced(),
    );
  };
  const w = Math.max(6, (z.end - z.start) * pps);
  const ease = Math.min(z.ease, (z.end - z.start) / 2) * pps;
  const onContext = async (e: React.MouseEvent) => {
    e.preventDefault();
    const s = useApp.getState();
    s.select({ kind: 'zoom', id: z.id });
    const choice = await window.api.contextMenu([
      { id: 's1.5', label: 'Zoom 1.5×', checked: z.scale === 1.5 },
      { id: 's2', label: 'Zoom 2×', checked: z.scale === 2 },
      { id: 's3', label: 'Zoom 3×', checked: z.scale === 3 },
      { type: 'separator' },
      { id: 'delete', label: 'Delete Zoom', accelerator: 'Backspace' },
    ]);
    if (choice?.startsWith('s')) s.edit((p) => upsertZoom(p, { ...z, scale: Number(choice.slice(1)) }));
    else if (choice === 'delete') {
      s.edit((p) => deleteZooms(p, [z.id]));
      s.select({ kind: 'none' });
    }
  };
  return (
    <div
      onContextMenu={(e) => void onContext(e)}
      className={clsx('absolute bottom-0.5 top-0.5 cursor-grab overflow-hidden rounded border border-teal-400 bg-teal-700/70 text-[10.5px] leading-[20px] text-white', selected && 'ring-2 ring-white')}
      style={{ left: z.start * pps, width: w }}
      onPointerDown={onDrag('move')}
    >
      <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-teal-300/40 to-transparent" style={{ width: ease }} />
      <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-teal-300/40 to-transparent" style={{ width: ease }} />
      <span className="relative px-1.5">{z.scale.toFixed(1)}×</span>
      <div className="absolute bottom-0 left-0 top-0 w-1.5 cursor-ew-resize" onPointerDown={onDrag('left')} />
      <div className="absolute bottom-0 right-0 top-0 w-1.5 cursor-ew-resize" onPointerDown={onDrag('right')} />
    </div>
  );
}
