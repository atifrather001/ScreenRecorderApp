import { Trash2 } from 'lucide-react';
import type { Annotation, Rect } from '@shared/types';
import { assetDisplaySize, clipLength, even, findClip, fitTransform, getAsset, round, updateClip, upsertAnnotation, upsertZoom } from '@shared/timeline';
import { useApp } from '../../store/app';
import { Button, NumberField, Select, Slider, Toggle } from '../../components/ui';
import { ANNOTATION_LABELS } from '../../lib/annotations';
import { formatTime } from '../../lib/format';
import { deleteSelection } from '../../App';

const COLORS = ['#ffffff', '#111827', '#f43f5e', '#f59e0b', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#a855f7'];

export function Inspector() {
  const selection = useApp((s) => s.selection);
  return (
    <div className="h-full overflow-auto p-4">
      {selection.kind === 'clips' && <ClipInspector ids={selection.ids} />}
      {selection.kind === 'annotation' && <AnnotationInspector id={selection.id} />}
      {selection.kind === 'zoom' && <ZoomInspector id={selection.id} />}
      {selection.kind === 'none' && <ProjectInspector />}
    </div>
  );
}

function Title({ children, onDelete }: { children: React.ReactNode; onDelete?: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-[13px] font-semibold text-ink-200">{children}</h3>
      {onDelete && (
        <button className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-rose-400" title="Delete" onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-20 shrink-0 text-xs text-ink-400">{label}</div>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {COLORS.map((c) => (
        <button
          key={c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={`h-5 w-5 rounded-full border ${value.toLowerCase() === c ? 'border-white ring-2 ring-accent-500' : 'border-ink-600'}`}
          style={{ background: c }}
        />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-5 w-6 cursor-pointer bg-transparent" />
    </div>
  );
}

function RectFields({ r, onChange }: { r: Rect; onChange: (r: Rect) => void }) {
  const pct = (v: number) => round(v * 100, 10);
  return (
    <div className="grid grid-cols-2 gap-2">
      {(['x', 'y', 'w', 'h'] as const).map((k) => (
        <label key={k} className="flex items-center gap-1.5 text-[11px] text-ink-500">
          {k.toUpperCase()}
          <NumberField value={pct(r[k])} step={1} suffix="%" onChange={(v) => onChange({ ...r, [k]: v / 100 })} />
        </label>
      ))}
    </div>
  );
}

function ClipInspector({ ids }: { ids: string[] }) {
  const project = useApp((s) => s.project)!;
  const edit = useApp((s) => s.edit);
  const commit = useApp((s) => s.commitCoalesced);
  if (ids.length > 1) {
    return (
      <>
        <Title onDelete={() => deleteSelection()}>{ids.length} clips selected</Title>
        <p className="text-xs text-ink-500">Press Delete to remove them, or Shift+Delete to also close the gaps.</p>
      </>
    );
  }
  const f = findClip(project, ids[0]);
  if (!f) return null;
  const { clip, track } = f;
  const asset = getAsset(project, clip.assetId);
  const set = (patch: Partial<typeof clip>, coalesce = false) => edit((p) => updateClip(p, clip.id, patch), coalesce);

  const placeCorner = (corner: 'tl' | 'tr' | 'bl' | 'br') => {
    const { w, h } = clip.transform;
    const m = 0.025;
    const my = (m * project.width) / project.height;
    set({ transform: { w, h, x: corner.includes('l') ? m : 1 - w - m, y: corner.includes('t') ? my : 1 - h - my } });
  };

  return (
    <>
      <Title onDelete={() => deleteSelection()}>{asset?.name ?? 'Clip'}</Title>
      <div className="mb-3 rounded-md bg-ink-850 px-3 py-2 text-[11px] leading-5 text-ink-400">
        <div>
          Starts {formatTime(clip.start, true)} · length {formatTime(clipLength(clip), true)}
        </div>
        <div>
          Source {formatTime(clip.in, true)} – {formatTime(clip.out, true)}
        </div>
        {asset && (
          <div className="truncate" title={asset.path}>
            {asset.kind} {asset.width ? `· ${asset.width}×${asset.height}` : ''} · {asset.role}
          </div>
        )}
      </div>

      {asset?.hasAudio && (
        <>
          <Row label="Volume">
            <Slider value={clip.volume} min={0} max={2} step={0.01} onChange={(v) => set({ volume: v }, true)} onCommit={commit} />
            <span className="w-10 text-right text-xs tabular-nums text-ink-400">{Math.round(clip.volume * 100)}%</span>
          </Row>
          <Row label="Mute">
            <Toggle checked={clip.muted} onChange={(v) => set({ muted: v })} />
          </Row>
        </>
      )}

      {asset?.hasVideo && track.kind === 'video' && (
        <>
          <Row label="Opacity">
            <Slider value={clip.opacity} min={0} max={1} onChange={(v) => set({ opacity: v }, true)} onCommit={commit} />
            <span className="w-10 text-right text-xs tabular-nums text-ink-400">{Math.round(clip.opacity * 100)}%</span>
          </Row>
          <div className="mt-3 text-xs text-ink-400">Position & size</div>
          <div className="mt-2">
            <RectFields r={clip.transform} onChange={(r) => set({ transform: r })} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              onClick={() => {
                const s = asset ? assetDisplaySize(asset) : { w: 16, h: 9 };
                set({ transform: fitTransform(project, s.w, s.h) });
              }}
            >
              Fit
            </Button>
            <Button size="sm" onClick={() => set({ transform: { x: 0, y: 0, w: 1, h: 1 } })}>
              Fill
            </Button>
            {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
              <Button key={c} size="sm" variant="ghost" onClick={() => placeCorner(c)} title="Move to corner">
                {c === 'tl' ? '↖' : c === 'tr' ? '↗' : c === 'bl' ? '↙' : '↘'}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-ink-500">Tip: drag the clip in the preview to move it, drag corners to resize.</p>
        </>
      )}
    </>
  );
}

function AnnotationInspector({ id }: { id: string }) {
  const project = useApp((s) => s.project)!;
  const edit = useApp((s) => s.edit);
  const commit = useApp((s) => s.commitCoalesced);
  const a = project.annotations.find((x) => x.id === id);
  if (!a) return null;
  const set = (patch: Partial<Annotation>, coalesce = false) => edit((p) => upsertAnnotation(p, { ...a, ...patch }), coalesce);
  const hasText = a.type === 'text' || a.type === 'step';
  const hasStroke = a.type === 'rect' || a.type === 'ellipse' || a.type === 'arrow';
  const hasFill = a.type === 'rect' || a.type === 'ellipse' || a.type === 'text';

  return (
    <>
      <Title onDelete={() => deleteSelection()}>{ANNOTATION_LABELS[a.type]}</Title>
      {hasText && (
        <textarea
          className="mb-2 w-full resize-y rounded-md border border-ink-700 bg-ink-850 p-2 text-[13px] text-ink-200 outline-none focus:border-accent-500"
          rows={a.type === 'text' ? 3 : 1}
          value={a.text}
          onChange={(e) => set({ text: e.target.value }, true)}
          onBlur={commit}
        />
      )}
      {a.type !== 'blur' && (
        <Row label="Colour">
          <Swatches value={a.color} onChange={(c) => set({ color: c })} />
        </Row>
      )}
      {a.type === 'text' && (
        <Row label="Size">
          <Slider value={a.fontSize} min={0.02} max={0.2} step={0.005} onChange={(v) => set({ fontSize: v }, true)} onCommit={commit} />
        </Row>
      )}
      {hasStroke && (
        <Row label="Line width">
          <Slider value={a.strokeWidth} min={1} max={30} step={1} onChange={(v) => set({ strokeWidth: v }, true)} onCommit={commit} />
          <span className="w-8 text-right text-xs text-ink-400">{a.strokeWidth}</span>
        </Row>
      )}
      {hasFill && (
        <Row label={a.type === 'text' ? 'Background' : 'Fill'}>
          <Toggle checked={a.fill} onChange={(v) => set({ fill: v })} />
        </Row>
      )}
      <Row label="Start">
        <NumberField value={a.start} min={0} step={0.1} suffix="s" onChange={(v) => set({ start: v, end: Math.max(v + 0.2, a.end) })} />
      </Row>
      <Row label="Duration">
        <NumberField value={round(a.end - a.start)} min={0.2} step={0.1} suffix="s" onChange={(v) => set({ end: round(a.start + v) })} />
      </Row>
      <div className="mt-3 text-xs text-ink-400">{a.type === 'arrow' ? 'From (X, Y) and offset (W, H)' : 'Position & size'}</div>
      <div className="mt-2">
        <RectFields r={a.box} onChange={(r) => set({ box: r })} />
      </div>
    </>
  );
}

function ZoomInspector({ id }: { id: string }) {
  const project = useApp((s) => s.project)!;
  const edit = useApp((s) => s.edit);
  const commit = useApp((s) => s.commitCoalesced);
  const z = project.zooms.find((x) => x.id === id);
  if (!z) return null;
  const set = (patch: Partial<typeof z>, coalesce = false) => edit((p) => upsertZoom(p, { ...z, ...patch }), coalesce);
  return (
    <>
      <Title onDelete={() => deleteSelection()}>Zoom & pan</Title>
      <p className="mb-3 text-[11px] text-ink-500">The preview shows the whole frame while a zoom is selected. Drag the frame to choose the area.</p>
      <Row label="Scale">
        <Slider value={z.scale} min={1.1} max={6} step={0.05} onChange={(v) => set({ scale: v }, true)} onCommit={commit} />
        <span className="w-10 text-right text-xs tabular-nums text-ink-400">{z.scale.toFixed(2)}×</span>
      </Row>
      <Row label="Ease">
        <Slider value={z.ease} min={0} max={2} step={0.05} onChange={(v) => set({ ease: v }, true)} onCommit={commit} />
        <span className="w-10 text-right text-xs tabular-nums text-ink-400">{z.ease.toFixed(2)}s</span>
      </Row>
      <Row label="Start">
        <NumberField value={z.start} min={0} step={0.1} suffix="s" onChange={(v) => set({ start: v, end: Math.max(v + 0.3, z.end) })} />
      </Row>
      <Row label="Duration">
        <NumberField value={round(z.end - z.start)} min={0.3} step={0.1} suffix="s" onChange={(v) => set({ end: z.start + v })} />
      </Row>
    </>
  );
}

const SIZES = [
  { label: '1080p (16:9)', w: 1920, h: 1080 },
  { label: '1440p (16:9)', w: 2560, h: 1440 },
  { label: '4K (16:9)', w: 3840, h: 2160 },
  { label: '720p (16:9)', w: 1280, h: 720 },
  { label: 'Square 1080', w: 1080, h: 1080 },
  { label: 'Vertical 1080×1920', w: 1080, h: 1920 },
  { label: '4:3 1440×1080', w: 1440, h: 1080 },
];

function ProjectInspector() {
  const project = useApp((s) => s.project)!;
  const edit = useApp((s) => s.edit);
  const commit = useApp((s) => s.commitCoalesced);
  const current = SIZES.find((s) => s.w === project.width && s.h === project.height);
  return (
    <>
      <Title>Project</Title>
      <Row label="Name">
        <input
          className="h-7 w-full rounded-md border border-ink-700 bg-ink-850 px-2 text-xs text-ink-200 outline-none focus:border-accent-500"
          value={project.name}
          onChange={(e) => edit((p) => ({ ...p, name: e.target.value }), true)}
          onBlur={commit}
        />
      </Row>
      <Row label="Canvas">
        <Select
          className="w-full"
          value={current ? `${current.w}x${current.h}` : 'custom'}
          options={[
            ...(current ? [] : [{ value: 'custom', label: `Custom ${project.width}×${project.height}` }]),
            ...SIZES.map((s) => ({ value: `${s.w}x${s.h}`, label: s.label })),
          ]}
          onChange={(v) => {
            if (v === 'custom') return;
            const [w, h] = v.split('x').map(Number);
            edit((p) => ({ ...p, width: even(w), height: even(h) }));
          }}
        />
      </Row>
      <Row label="Size">
        <NumberField value={project.width} min={16} max={7680} onChange={(v) => edit((p) => ({ ...p, width: even(v) }))} suffix="w" />
        <NumberField value={project.height} min={16} max={7680} onChange={(v) => edit((p) => ({ ...p, height: even(v) }))} suffix="h" />
      </Row>
      <Row label="Frame rate">
        <Select value={project.fps} options={[24, 25, 30, 50, 60].map((v) => ({ value: v, label: `${v} fps` }))} onChange={(v) => edit((p) => ({ ...p, fps: v }))} />
      </Row>
      <Row label="Background">
        <Swatches value={project.background} onChange={(c) => edit((p) => ({ ...p, background: c }))} />
      </Row>
      <p className="mt-4 text-[11px] leading-5 text-ink-500">
        Select a clip, annotation or zoom on the timeline or in the preview to edit it. Changing the canvas size keeps clip positions proportional.
      </p>
    </>
  );
}
