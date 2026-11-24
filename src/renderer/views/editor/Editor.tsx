import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronFirst, ChevronLast, Download, Film, Music, Pause, Play, Redo2, Save, Scissors, Trash2, Undo2 } from 'lucide-react';
import { addTrack, projectDuration, splitAt } from '@shared/timeline';
import { useApp } from '../../store/app';
import { Button, IconButton } from '../../components/ui';
import { formatTime, isMac } from '../../lib/format';
import { importMedia, saveProject } from '../../lib/actions';
import { deleteSelection, isTyping } from '../../App';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';
import { MediaBin } from './MediaBin';
import { ExportDialog } from './ExportDialog';

export function Editor() {
  const project = useApp((s) => s.project)!;
  const projectPath = useApp((s) => s.projectPath);
  const dirty = useApp((s) => s.dirty);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const edit = useApp((s) => s.edit);
  const [exporting, setExporting] = useState(false);
  const [timelineH, setTimelineH] = useState(300);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    const open = () => setExporting(true);
    window.addEventListener('open-export', open);
    return () => window.removeEventListener('open-export', open);
  }, []);

  // Autosave saved projects every 30 seconds
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = useApp.getState();
      if (s.dirty && s.projectPath && s.project) {
        void window.api.saveProject(s.project, s.projectPath).then((p) => {
          if (p && useApp.getState().project === s.project) s.markSaved(p);
        });
      }
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Editor keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || exporting) return;
      const s = useApp.getState();
      const p = s.project;
      if (!p) return;
      const frame = 1 / p.fps;
      const mod = e.metaKey || e.ctrlKey;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          s.setPlaying(false);
          s.setPlayhead(Math.max(0, s.playhead - (e.shiftKey ? 1 : frame)));
          break;
        case 'ArrowRight':
          e.preventDefault();
          s.setPlaying(false);
          s.setPlayhead(Math.min(projectDuration(p), s.playhead + (e.shiftKey ? 1 : frame)));
          break;
        case 'Home':
          s.setPlayhead(0);
          break;
        case 'End':
          s.setPlayhead(projectDuration(p));
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelection(e.shiftKey);
          break;
        case 's':
          if (!mod) s.edit((q) => splitAt(q, s.playhead, s.selection.kind === 'clips' ? s.selection.ids : undefined));
          break;
        case 'Escape':
          s.select({ kind: 'none' });
          break;
        case '=':
        case '+':
          if (!mod) s.setPxPerSec(s.pxPerSec * 1.25);
          break;
        case '-':
          if (!mod) s.setPxPerSec(s.pxPerSec / 1.25);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exporting]);

  const resizeTimeline = (e: React.PointerEvent) => {
    const startY = e.clientY;
    const h0 = timelineH;
    const move = (ev: PointerEvent) => setTimelineH(Math.min(window.innerHeight - 260, Math.max(160, h0 - (ev.clientY - startY))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDrop = async (e: React.DragEvent) => {
    setDropping(false);
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const assets = [];
    for (const f of Array.from(e.dataTransfer.files)) {
      try {
        assets.push(await window.api.probeMedia(window.api.pathForFile(f)));
      } catch (err) {
        useApp.getState().toast(`${f.name}: ${(err as Error).message}`, 'error');
      }
    }
    if (assets.length) await importMedia(assets);
  };

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => void onDrop(e)}
    >
      {/* Top bar */}
      <div className={clsx('drag flex h-12 shrink-0 items-center gap-2 border-b border-ink-800 bg-ink-900 pr-3', isMac() ? 'pl-4' : 'pl-3')}>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink-200">
            {project.name}
            {dirty && <span className="ml-1 text-ink-500">•</span>}
          </div>
          <div className="truncate text-[11px] text-ink-500">{projectPath ?? 'Not saved yet'}</div>
        </div>
        <div className="no-drag ml-auto flex items-center gap-1">
          <IconButton label="Undo" disabled={!canUndo} onClick={undo}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton label="Redo" disabled={!canRedo} onClick={redo}>
            <Redo2 size={16} />
          </IconButton>
          <div className="mx-2 h-5 w-px bg-ink-700" />
          <Button size="sm" variant="ghost" icon={<Save size={14} />} onClick={() => void saveProject()}>
            Save
          </Button>
          <Button size="sm" variant="primary" icon={<Download size={14} />} onClick={() => setExporting(true)} disabled={projectDuration(project) <= 0}>
            Export
          </Button>
        </div>
      </div>

      {/* Middle */}
      <div className="flex min-h-0 flex-1">
        <div className="w-72 shrink-0 border-r border-ink-800 bg-ink-900">
          <MediaBin />
        </div>
        <div className="flex min-w-0 flex-1 flex-col bg-ink-950">
          <div className="min-h-0 flex-1 p-4">
            <Preview />
          </div>
          <Transport />
        </div>
        <div className="w-72 shrink-0 border-l border-ink-800 bg-ink-900">
          <Inspector />
        </div>
      </div>

      {/* Timeline */}
      <div className="h-1 shrink-0 cursor-row-resize bg-ink-800 hover:bg-accent-600" onPointerDown={resizeTimeline} />
      <div className="flex shrink-0 items-center gap-1 border-b border-ink-800 bg-ink-900 px-2 py-1" >
        <Button size="sm" variant="ghost" icon={<Scissors size={14} />} onClick={() => {
          const s = useApp.getState();
          edit((p) => splitAt(p, s.playhead, s.selection.kind === 'clips' ? s.selection.ids : undefined));
        }}>
          Split
        </Button>
        <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => deleteSelection()}>
          Delete
        </Button>
        <div className="mx-1 h-4 w-px bg-ink-700" />
        <Button size="sm" variant="ghost" icon={<Film size={14} />} onClick={() => edit((p) => addTrack(p, 'video'))}>
          Video track
        </Button>
        <Button size="sm" variant="ghost" icon={<Music size={14} />} onClick={() => edit((p) => addTrack(p, 'audio'))}>
          Audio track
        </Button>
      </div>
      <div className="shrink-0 bg-ink-900" style={{ height: timelineH }}>
        <Timeline />
      </div>

      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-4 border-dashed border-accent-500 bg-accent-600/10 text-lg font-semibold text-accent-400">
          Drop to import
        </div>
      )}
    </div>
  );
}

function togglePlay() {
  const s = useApp.getState();
  const d = projectDuration(s.project!);
  if (!s.playing && s.playhead >= d - 0.01) s.setPlayhead(0);
  s.setPlaying(!s.playing);
}

function Transport() {
  const playing = useApp((s) => s.playing);
  const playhead = useApp((s) => s.playhead);
  const project = useApp((s) => s.project)!;
  const setPlayhead = useApp((s) => s.setPlayhead);
  const duration = projectDuration(project);
  return (
    <div className="flex h-11 shrink-0 items-center justify-center gap-2 border-t border-ink-800 bg-ink-900">
      <span className="w-24 text-right font-mono text-xs tabular-nums text-ink-300">{formatTime(playhead, true)}</span>
      <IconButton label="Go to start" onClick={() => setPlayhead(0)}>
        <ChevronFirst size={18} />
      </IconButton>
      <button
        onClick={togglePlay}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-200 text-ink-950 hover:bg-white"
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
      >
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
      </button>
      <IconButton label="Go to end" onClick={() => setPlayhead(duration)}>
        <ChevronLast size={18} />
      </IconButton>
      <span className="w-24 font-mono text-xs tabular-nums text-ink-500">{formatTime(duration, true)}</span>
    </div>
  );
}
