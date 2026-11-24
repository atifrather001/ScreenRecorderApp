import { useState } from 'react';
import { Copy, Download, FileText, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { toSrt, toTranscript, toVtt } from '@shared/captions';
import type { CaptionSegment } from '@shared/types';
import { useApp } from '../../store/app';
import { Button, Toggle } from '../../components/ui';
import { formatTime } from '../../lib/format';
import { generateNotes, transcribeProject } from '../../lib/actions';

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-');

export function CaptionsTab() {
  const project = useApp((s) => s.project)!;
  const playhead = useApp((s) => s.playhead);
  const edit = useApp((s) => s.edit);
  const commit = useApp((s) => s.commitCoalesced);
  const toast = useApp((s) => s.toast);
  const [progress, setProgress] = useState<{ f: number; label: string } | null>(null);
  const caps = project.captions ?? [];

  const run = async () => {
    if (caps.length && !window.confirm('Replace the current captions with a new transcription?')) return;
    setProgress({ f: 0, label: 'Starting…' });
    await transcribeProject((f, label) => setProgress({ f, label }));
    setProgress(null);
  };

  const save = async (ext: 'srt' | 'vtt' | 'txt') => {
    const content = ext === 'srt' ? toSrt(caps) : ext === 'vtt' ? toVtt(caps) : toTranscript(caps);
    const p = await window.api.saveTextFile(safeName(project.name), ext, content);
    if (p) toast(`Saved ${ext.toUpperCase()}`, 'success', { label: 'Show', run: () => void window.api.revealInFolder(p) });
  };

  const setSeg = (id: string, patch: Partial<CaptionSegment>, coalesce = false) =>
    edit((p) => ({ ...p, captions: (p.captions ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) }), coalesce);

  return (
    <div className="space-y-3">
      <Button className="w-full" variant="primary" icon={<Wand2 size={14} />} disabled={!!progress} onClick={() => void run()}>
        {caps.length ? 'Transcribe again' : 'Transcribe timeline'}
      </Button>
      {progress && (
        <div>
          <div className="mb-1 text-[11px] text-ink-400">{progress.label}</div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
            <div className="h-full bg-accent-500 transition-[width]" style={{ width: `${Math.round(progress.f * 100)}%` }} />
          </div>
        </div>
      )}
      <p className="text-[11px] text-ink-500">Runs on this computer with Whisper; nothing is uploaded.</p>
      {caps.length > 0 && (
        <>
          <label className="flex items-center justify-between rounded-md bg-ink-850 px-2.5 py-2 text-xs text-ink-200">
            Show captions in video
            <Toggle checked={!!project.burnCaptions} onChange={(v) => edit((p) => ({ ...p, burnCaptions: v }))} />
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {(['srt', 'vtt', 'txt'] as const).map((e) => (
              <Button key={e} size="sm" icon={<Download size={12} />} onClick={() => void save(e)}>
                {e.toUpperCase()}
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            {caps.map((c) => {
              const active = playhead >= c.start && playhead < c.end;
              return (
                <div key={c.id} className={`group rounded-md border px-2 py-1.5 ${active ? 'border-accent-600 bg-accent-600/10' : 'border-transparent hover:bg-ink-850'}`}>
                  <div className="flex items-center justify-between">
                    <button className="font-mono text-[10.5px] text-ink-500 hover:text-accent-400" onClick={() => useApp.getState().setPlayhead(c.start)}>
                      {formatTime(c.start, true)}
                    </button>
                    <button
                      className="hidden text-ink-500 hover:text-rose-400 group-hover:block"
                      title="Delete caption"
                      onClick={() => edit((p) => ({ ...p, captions: (p.captions ?? []).filter((x) => x.id !== c.id) }))}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <textarea
                    rows={Math.min(3, Math.ceil(c.text.length / 34))}
                    className="mt-0.5 w-full resize-none bg-transparent text-xs leading-snug text-ink-200 outline-none"
                    value={c.text}
                    onChange={(e) => setSeg(c.id, { text: e.target.value }, true)}
                    onBlur={commit}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function NotesTab() {
  const project = useApp((s) => s.project)!;
  const settings = useApp((s) => s.settings)!;
  const edit = useApp((s) => s.edit);
  const commit = useApp((s) => s.commitCoalesced);
  const toast = useApp((s) => s.toast);
  const setView = useApp((s) => s.setView);
  const [busy, setBusy] = useState(false);
  const caps = project.captions ?? [];

  const exportMd = async (withTranscript: boolean) => {
    let md = project.notes ?? '';
    if (withTranscript && caps.length) md += `\n\n---\n\n## Transcript\n\n${toTranscript(caps)}\n`;
    const p = await window.api.saveTextFile(`${safeName(project.name)} notes`, 'md', md);
    if (p) toast('Notes saved', 'success', { label: 'Show', run: () => void window.api.revealInFolder(p) });
  };

  return (
    <div className="flex h-full flex-col gap-2">
      {!settings.ai.hasApiKey ? (
        <div className="rounded-md bg-ink-850 p-2.5 text-xs text-ink-300">
          AI notes use Claude. Add your Anthropic API key in Settings to turn them on.
          <Button size="sm" className="mt-2 w-full" onClick={() => setView('settings')}>
            Open settings
          </Button>
        </div>
      ) : (
        <Button
          variant="primary"
          icon={<Sparkles size={14} />}
          disabled={busy || !caps.length}
          onClick={async () => {
            if (project.notes && !window.confirm('Replace the current notes?')) return;
            setBusy(true);
            await generateNotes();
            setBusy(false);
          }}
        >
          {busy ? 'Writing notes…' : project.notes ? 'Write notes again' : 'Write AI notes'}
        </Button>
      )}
      {!caps.length && <p className="text-[11px] text-ink-500">Notes are written from the transcript. Transcribe the timeline in the Captions tab first.</p>}
      <textarea
        className="min-h-[220px] flex-1 resize-none rounded-md border border-ink-700 bg-ink-850 p-2 font-mono text-[11.5px] leading-relaxed text-ink-200 outline-none focus:border-accent-500"
        placeholder="Your notes (Markdown). Type here, or let AI write them."
        value={project.notes ?? ''}
        onChange={(e) => edit((p) => ({ ...p, notes: e.target.value }), true)}
        onBlur={commit}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" icon={<FileText size={12} />} disabled={!project.notes} onClick={() => void exportMd(true)}>
          Export .md
        </Button>
        <Button
          size="sm"
          icon={<Copy size={12} />}
          disabled={!project.notes}
          onClick={() => {
            void navigator.clipboard.writeText(project.notes ?? '');
            toast('Copied', 'success');
          }}
        >
          Copy
        </Button>
      </div>
    </div>
  );
}
