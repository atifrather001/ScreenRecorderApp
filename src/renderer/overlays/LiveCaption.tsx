import { useEffect, useState } from 'react';
import type { RecorderStatus } from '@shared/types';

/** Shows the most recent live caption while recording. Not captured in the video. */
export function LiveCaption() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const apply = (s: RecorderStatus) => {
      setText(s.caption ?? '');
      setBusy((s.captionBacklog ?? 0) > 0);
    };
    void window.api.lastRecorderStatus().then(apply);
    return window.api.onRecorderStatus(apply);
  }, []);
  return (
    <div className="flex h-full items-end justify-center p-2">
      <div className="max-w-full rounded-xl bg-black/75 px-4 py-2 text-center text-[17px] font-medium leading-snug text-white shadow-xl">
        {text || <span className="text-white/60">{busy ? 'Transcribing…' : 'Listening…'}</span>}
        {text && busy && <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white/60 align-middle" />}
      </div>
    </div>
  );
}
