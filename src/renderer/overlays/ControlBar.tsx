import { useEffect, useState } from 'react';
import { Pause, Play, Square, Trash2 } from 'lucide-react';
import type { RecorderStatus } from '@shared/types';
import { formatTime } from '../lib/format';

export function ControlBar() {
  const [s, setS] = useState<RecorderStatus>({ phase: 'countdown', elapsed: 0, countdown: 0, micLevel: 0 });
  useEffect(() => window.api.onRecorderStatus(setS), []);
  const cmd = window.api.sendRecorderCommand;
  const paused = s.phase === 'paused';
  return (
    <div className="drag flex h-full items-center gap-1 rounded-2xl border border-white/10 bg-ink-900/95 px-2 text-ink-200 shadow-2xl">
      <div className="flex items-center gap-2 pl-2 pr-1">
        <span className={`h-2.5 w-2.5 rounded-full ${s.phase === 'recording' ? 'animate-pulse bg-rose-500' : paused ? 'bg-amber-400' : 'bg-ink-500'}`} />
        <span className="w-16 font-mono text-sm tabular-nums">
          {s.phase === 'countdown' ? `in ${s.countdown}` : s.phase === 'finishing' ? 'Saving…' : formatTime(s.elapsed)}
        </span>
      </div>
      <div className="mx-1 h-6 w-1.5 overflow-hidden rounded-full bg-ink-700" title="Microphone level">
        <div className="w-full bg-accent-500 transition-[height] duration-100" style={{ height: `${Math.round(s.micLevel * 100)}%`, marginTop: `${100 - Math.round(s.micLevel * 100)}%` }} />
      </div>
      <div className="no-drag ml-auto flex items-center gap-1">
        <button
          title={paused ? 'Resume' : 'Pause'}
          disabled={s.phase !== 'recording' && !paused}
          onClick={() => cmd(paused ? 'resume' : 'pause')}
          className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-white/10 disabled:opacity-30"
        >
          {paused ? <Play size={17} /> : <Pause size={17} />}
        </button>
        <button
          title="Stop and edit"
          disabled={s.phase === 'finishing'}
          onClick={() => cmd('stop')}
          className="flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 px-3 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-40"
        >
          <Square size={13} fill="currentColor" /> Stop
        </button>
        <button
          title="Discard recording"
          disabled={s.phase === 'finishing'}
          onClick={() => {
            if (window.confirm('Discard this recording?')) cmd('cancel');
          }}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-400 hover:bg-white/10 hover:text-ink-200 disabled:opacity-30"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
