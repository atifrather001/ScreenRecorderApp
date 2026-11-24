import { useEffect, useState } from 'react';

export function Countdown() {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => window.api.onRecorderStatus((s) => setN(s.phase === 'countdown' ? s.countdown : null)), []);
  if (!n) return null;
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex h-48 w-48 items-center justify-center rounded-full bg-black/70 text-[96px] font-semibold text-white shadow-2xl">
        <span key={n} className="animate-[ping_1s_ease-out_reverse]" style={{ animationIterationCount: 1 }}>
          {n}
        </span>
      </div>
    </div>
  );
}
