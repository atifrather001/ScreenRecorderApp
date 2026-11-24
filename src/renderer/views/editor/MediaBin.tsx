import { useState } from 'react';
import { clsx } from 'clsx';
import { ArrowUpRight, Circle, EyeOff, Film, Hash, Highlighter, ImageIcon, Music, Plus, Square, SunDim, Type, Upload, ZoomIn } from 'lucide-react';
import type { AnnotationType, MediaAsset } from '@shared/types';
import { findClip, makeAnnotation, makeZoom, placeAsset, removeAsset, upsertAnnotation, upsertZoom } from '@shared/timeline';
import { useApp } from '../../store/app';
import { Button } from '../../components/ui';
import { formatTime } from '../../lib/format';
import { importMedia } from '../../lib/actions';
import { ASSET_MIME } from './Timeline';
import { CaptionsTab, NotesTab } from './AiPanels';

type Tab = 'media' | 'annotate' | 'zoom' | 'captions' | 'notes';

export function MediaBin() {
  const [tab, setTab] = useState<Tab>('media');
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 border-b border-ink-800 p-1.5">
        {(
          [
            ['media', 'Media'],
            ['annotate', 'Annotate'],
            ['zoom', 'Zoom'],
            ['captions', 'Captions'],
            ['notes', 'Notes'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx('flex-1 rounded-md py-1.5 text-[11px] font-medium', tab === t ? 'bg-ink-800 text-ink-200' : 'text-ink-400 hover:text-ink-200')}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'media' && <MediaTab />}
        {tab === 'annotate' && <AnnotateTab />}
        {tab === 'zoom' && <ZoomTab />}
        {tab === 'captions' && <CaptionsTab />}
        {tab === 'notes' && <NotesTab />}
      </div>
    </div>
  );
}

function MediaTab() {
  const project = useApp((s) => s.project)!;
  const edit = useApp((s) => s.edit);
  const select = useApp((s) => s.select);
  const toast = useApp((s) => s.toast);

  const addToTimeline = (a: MediaAsset) => {
    const s = useApp.getState();
    const track = s.project!.tracks.find((t) => !t.locked && (a.hasVideo ? t.kind === 'video' : t.kind === 'audio'));
    if (!track) return toast(`Add ${a.hasVideo ? 'a video' : 'an audio'} track first`, 'error');
    let clipId = '';
    edit((p) => {
      const r = placeAsset(p, a.id, track.id, s.playhead);
      clipId = r.clipId;
      return r.project;
    });
    if (clipId) {
      select({ kind: 'clips', ids: [clipId] });
      const c = findClip(useApp.getState().project!, clipId);
      if (c && c.clip.start !== s.playhead) toast(`Placed on “${track.name}” at the next free spot`, 'info');
    }
  };

  const used = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.assetId)));

  return (
    <div className="space-y-2">
      <Button className="w-full" icon={<Upload size={14} />} onClick={() => void importMedia()}>
        Import media
      </Button>
      {project.assets.length === 0 && <p className="px-1 pt-2 text-xs text-ink-500">Import video, audio or images, or drop files anywhere on the editor.</p>}
      {project.assets.map((a) => (
        <div
          key={a.id}
          draggable
          onContextMenu={async (e) => {
            e.preventDefault();
            const choice = await window.api.contextMenu([
              { id: 'add', label: 'Add at Playhead' },
              { id: 'reveal', label: window.api.platform === 'darwin' ? 'Show in Finder' : 'Show in Folder' },
              { type: 'separator' },
              { id: 'remove', label: 'Remove from Project' },
            ]);
            if (choice === 'add') addToTimeline(a);
            else if (choice === 'reveal') void window.api.revealInFolder(a.path);
            else if (choice === 'remove') {
              if (used.has(a.id) && !window.confirm(`“${a.name}” is used on the timeline. Remove it and its clips?`)) return;
              edit((p) => removeAsset(p, a.id));
            }
          }}
          onDragStart={(e) => {
            e.dataTransfer.setData(ASSET_MIME, a.id);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          className="group flex cursor-grab items-center gap-2 rounded-lg border border-ink-800 bg-ink-900 p-1.5 hover:border-ink-600"
        >
          <div className="relative flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-black text-ink-500">
            {a.kind === 'video' ? (
              <video src={`${window.api.mediaUrl(a.path)}#t=0.5`} preload="metadata" muted className="h-full w-full object-cover" />
            ) : a.kind === 'image' ? (
              <img src={window.api.mediaUrl(a.path)} className="h-full w-full object-cover" draggable={false} />
            ) : (
              <Music size={16} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 truncate text-xs text-ink-200">
              {a.kind === 'video' ? <Film size={11} /> : a.kind === 'image' ? <ImageIcon size={11} /> : <Music size={11} />}
              {a.name}
            </div>
            <div className="text-[11px] text-ink-500">
              {a.kind !== 'image' && formatTime(a.duration)} {a.width ? `· ${a.width}×${a.height}` : ''} {!used.has(a.id) && '· unused'}
            </div>
          </div>
          <div className="flex flex-col opacity-0 group-hover:opacity-100">
            <button title="Add at playhead" className="rounded p-0.5 text-ink-300 hover:bg-ink-700" onClick={() => addToTimeline(a)}>
              <Plus size={14} />
            </button>
            <button
              title="Remove from project"
              className="rounded p-0.5 text-ink-500 hover:bg-ink-700 hover:text-rose-400"
              onClick={() => {
                if (used.has(a.id) && !window.confirm(`“${a.name}” is used on the timeline. Remove it and its clips?`)) return;
                edit((p) => removeAsset(p, a.id));
              }}
            >
              <EyeOff size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const TOOLS: { type: AnnotationType; label: string; icon: React.ReactNode; hint: string }[] = [
  { type: 'text', label: 'Text', icon: <Type size={18} />, hint: 'Title or caption' },
  { type: 'arrow', label: 'Arrow', icon: <ArrowUpRight size={18} />, hint: 'Point at something' },
  { type: 'rect', label: 'Box', icon: <Square size={18} />, hint: 'Outline an area' },
  { type: 'ellipse', label: 'Circle', icon: <Circle size={18} />, hint: 'Ring an area' },
  { type: 'highlight', label: 'Highlight', icon: <Highlighter size={18} />, hint: 'Marker-style tint' },
  { type: 'spotlight', label: 'Spotlight', icon: <SunDim size={18} />, hint: 'Dim everything else' },
  { type: 'blur', label: 'Blur', icon: <EyeOff size={18} />, hint: 'Hide private info' },
  { type: 'step', label: 'Step', icon: <Hash size={18} />, hint: 'Numbered badge' },
];

function AnnotateTab() {
  const edit = useApp((s) => s.edit);
  const select = useApp((s) => s.select);
  const add = (type: AnnotationType) => {
    const s = useApp.getState();
    const a = makeAnnotation(s.project!, type, s.playhead);
    edit((p) => upsertAnnotation(p, a));
    select({ kind: 'annotation', id: a.id });
    s.setPlaying(false);
  };
  return (
    <>
      <p className="mb-3 text-xs text-ink-500">Adds at the playhead for 4 seconds. Drag it in the preview to place it.</p>
      <div className="grid grid-cols-2 gap-2">
        {TOOLS.map((t) => (
          <button
            key={t.type}
            onClick={() => add(t.type)}
            className="flex flex-col items-center gap-1.5 rounded-lg border border-ink-800 bg-ink-900 px-2 py-3 text-ink-300 hover:border-accent-600 hover:text-accent-400"
          >
            {t.icon}
            <span className="text-xs font-medium text-ink-200">{t.label}</span>
            <span className="text-[10.5px] text-ink-500">{t.hint}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function ZoomTab() {
  const edit = useApp((s) => s.edit);
  const select = useApp((s) => s.select);
  const toast = useApp((s) => s.toast);
  const zooms = useApp((s) => s.project!.zooms);
  const add = (scale: number) => {
    const s = useApp.getState();
    const z = makeZoom(s.playhead, 3, scale);
    const before = s.project!;
    edit((p) => upsertZoom(p, z));
    if (useApp.getState().project === before) return toast('There is already a zoom here. Move the playhead to a free spot.', 'error');
    select({ kind: 'zoom', id: z.id });
    s.setPlaying(false);
  };
  return (
    <>
      <p className="mb-3 text-xs text-ink-500">Zoom in on part of the screen, then ease back out. Camera clips stay where they are.</p>
      <div className="grid grid-cols-3 gap-2">
        {[1.5, 2, 3].map((s) => (
          <Button key={s} onClick={() => add(s)} icon={<ZoomIn size={14} />}>
            {s}×
          </Button>
        ))}
      </div>
      <div className="mt-4 space-y-1">
        {zooms.map((z) => (
          <button
            key={z.id}
            onClick={() => {
              select({ kind: 'zoom', id: z.id });
              useApp.getState().setPlayhead((z.start + z.end) / 2);
            }}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-ink-300 hover:bg-ink-800"
          >
            <span>
              {formatTime(z.start, true)} – {formatTime(z.end, true)}
            </span>
            <span className="text-ink-500">{z.scale.toFixed(1)}×</span>
          </button>
        ))}
      </div>
    </>
  );
}
