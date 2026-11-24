import { useEffect, useState } from 'react';

/** Shows the most recent live caption while recording. Not captured in the video. */
export function LiveCaption() {
  const [text, setText] = useState('');
  useEffect(() => window.api.onRecorderStatus((s) => setText(s.caption ?? '')), []);
  return (
    <div className="flex h-full items-end justify-center p-2">
      <div className="max-w-full rounded-xl bg-black/75 px-4 py-2 text-center text-[17px] font-medium leading-snug text-white shadow-xl">
        {text || <span className="text-white/50">Listening…</span>}
      </div>
    </div>
  );
}
