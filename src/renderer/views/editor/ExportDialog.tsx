import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { CheckCircle2, FolderOpen, Play } from 'lucide-react';
import type { ExportPreset, ExportProgress } from '@shared/types';
import { EXPORT_PRESETS } from '@shared/presets';
import { outputSize } from '@shared/export-graph';
import { projectDuration } from '@shared/timeline';
import { useApp } from '../../store/app';
import { Button, Modal, Toggle } from '../../components/ui';
import { annotationPng } from '../../lib/annotations';
import { captionPng } from '../../lib/caption-draw';
import { formatTime } from '../../lib/format';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useApp((s) => s.project)!;
  const toast = useApp((s) => s.toast);
  const [preset, setPreset] = useState<ExportPreset>(EXPORT_PRESETS[0]);
  const [hw, setHw] = useState(true);
  const [hasHw, setHasHw] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const running = useRef(false);

  useEffect(() => {
    void window.api.ffmpegInfo().then((i) => setHasHw(i.encoders.some((e) => /videotoolbox|nvenc|qsv/.test(e))));
  }, []);

  useEffect(
    () =>
      window.api.onExportProgress((p) => {
        // Only one export runs from this dialog at a time; events can arrive before startExport returns.
        if (!running.current) return;
        setProgress(p);
        if (p.stage === 'error') toast(`Export failed:\n${p.message}`, 'error');
        if (p.stage === 'done' || p.stage === 'error' || p.stage === 'cancelled') {
          running.current = false;
          setJob(null);
        }
      }),
    [toast],
  );

  const duration = projectDuration(project);
  const size = outputSize(project, preset);

  const start = async () => {
    const path = await window.api.chooseExportPath(project.name.replace(/[\\/:*?"<>|]/g, '-'), preset.format);
    if (!path) return;
    const annotationImages: Record<string, string> = {};
    for (const a of project.annotations) if (a.type !== 'blur') annotationImages[a.id] = annotationPng(a, project);
    setProgress({ jobId: '', percent: 0, stage: 'preparing' });
    running.current = true;
    const caps = project.burnCaptions && preset.codec !== 'none' ? (project.captions ?? []) : [];
    const captions = caps.length
      ? { segments: caps.map((c) => ({ start: c.start, end: c.end })), images: caps.map((c) => captionPng(c.text, project)), blank: captionPng('', project) }
      : undefined;
    const id = await window.api.startExport({ project, preset, outputPath: path, annotationImages, hardwareAcceleration: hw, captions });
    if (running.current) setJob(id);
  };

  const busy = !!job || progress?.stage === 'preparing' || progress?.stage === 'encoding';
  const done = progress?.stage === 'done';

  return (
    <Modal title="Export video" onClose={() => (busy ? undefined : onClose())} width={620}>
      {done && progress?.outputPath ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 size={40} className="text-accent-400" />
          <div className="text-base font-semibold text-ink-200">Export finished</div>
          <div className="max-w-md truncate text-xs text-ink-400">{progress.outputPath}</div>
          <div className="mt-2 flex gap-2">
            <Button icon={<FolderOpen size={14} />} onClick={() => void window.api.revealInFolder(progress.outputPath!)}>
              Show in folder
            </Button>
            <Button icon={<Play size={14} />} onClick={() => void window.api.openPath(progress.outputPath!)}>
              Play
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {EXPORT_PRESETS.map((p) => (
              <button
                key={p.id}
                disabled={busy}
                onClick={() => setPreset(p)}
                className={clsx(
                  'rounded-lg border px-3 py-2.5 text-left disabled:opacity-50',
                  preset.id === p.id ? 'border-accent-500 bg-accent-600/10' : 'border-ink-700 hover:border-ink-500',
                )}
              >
                <div className="text-[13px] font-medium text-ink-200">{p.name}</div>
                <div className="text-[11px] text-ink-400">{p.description}</div>
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg bg-ink-850 px-4 py-3 text-xs text-ink-300">
            <span>
              {preset.codec === 'none' ? 'Audio only' : `${size.width}×${size.height} · ${preset.fps || project.fps} fps`} · {formatTime(duration)}
            </span>
            {hasHw && (preset.codec === 'h264' || preset.codec === 'hevc') && (
              <label className="flex items-center gap-2">
                Hardware encoding <Toggle checked={hw} onChange={setHw} disabled={busy} />
              </label>
            )}
          </div>
          {progress && progress.stage !== 'done' && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-ink-400">
                <span>{progress.stage === 'preparing' ? 'Preparing…' : progress.stage === 'encoding' ? 'Encoding…' : progress.stage === 'cancelled' ? 'Cancelled' : 'Failed'}</span>
                <span>{Math.round(progress.percent)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ink-800">
                <div className="h-full bg-accent-500 transition-[width]" style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            {busy ? (
              <Button variant="danger" onClick={() => job && void window.api.cancelExport(job)}>
                Cancel export
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
                <Button variant="primary" disabled={duration <= 0} onClick={() => void start()}>
                  Export…
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
