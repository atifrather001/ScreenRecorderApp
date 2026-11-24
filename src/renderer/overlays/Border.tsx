import { useEffect, useState } from 'react';
import type { RecorderStatus } from '@shared/types';
import type { RecorderPhase } from '@shared/types';

/** Red frame around the area being recorded. Amber while paused. */
export function Border() {
  const [phase, setPhase] = useState<RecorderPhase>('recording');
  useEffect(() => {
    const apply = (s: RecorderStatus) => setPhase(s.phase);
    void window.api.lastRecorderStatus().then(apply);
    return window.api.onRecorderStatus(apply);
  }, []);
  const color = phase === 'paused' ? '#f59e0b' : '#ef4444';
  return (
    <div className="pointer-events-none fixed inset-0" style={{ border: `4px solid ${color}`, boxShadow: `0 0 12px ${color}88` }}>
      <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white" style={{ background: color }}>
        <span className={`h-1.5 w-1.5 rounded-full bg-white ${phase === 'recording' ? 'animate-pulse' : ''}`} />
        {phase === 'paused' ? 'PAUSED' : 'REC'}
      </div>
    </div>
  );
}
