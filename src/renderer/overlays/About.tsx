import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Globe, Bug, FileText, ArrowLeft } from 'lucide-react';
import type { AboutInfo } from '@shared/api';
import { isMac } from '../lib/format';

export function About() {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [notices, setNotices] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void window.api.aboutInfo().then(setInfo);
  }, []);
  if (!info) return <div className="h-full bg-ink-950" />;

  const details = [
    `${info.name} ${info.version}`,
    `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`,
    `ffmpeg ${info.ffmpeg.version || 'not found'}${info.ffmpeg.source !== 'missing' ? ` (${info.ffmpeg.source})` : ''}`,
    info.os,
  ];

  if (notices !== null) {
    return (
      <div className="flex h-full flex-col bg-ink-950">
        <div className={`drag flex shrink-0 items-center gap-2 border-b border-ink-800 px-3 pb-2 ${isMac() ? 'pt-9' : 'pt-2'}`}>
          <button className="no-drag flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-300 hover:bg-ink-800" onClick={() => setNotices(null)}>
            <ArrowLeft size={13} /> Back
          </button>
          <span className="text-xs font-semibold text-ink-200">Third-party notices</span>
        </div>
        <pre className="min-h-0 flex-1 select-text overflow-auto whitespace-pre-wrap p-4 font-mono text-[10.5px] leading-relaxed text-ink-300">{notices}</pre>
      </div>
    );
  }

  return (
    <div className="drag flex h-full flex-col items-center bg-ink-950 px-8 pb-6 pt-12 text-center">
      <img src="./icon.png" alt="" className="h-24 w-24" draggable={false} />
      <h1 className="mt-3 text-xl font-semibold text-white">{info.name}</h1>
      <div className="mt-0.5 text-[13px] text-ink-400">Version {info.version}</div>
      <div className="mt-3 text-[13px] font-medium text-accent-400">{info.tagline}</div>
      <p className="mt-3 text-xs leading-relaxed text-ink-400">
        A free screen recorder and video editor for macOS and Windows. Record your screen, camera and voice, edit on a timeline, add captions and AI notes, and
        export anywhere.
      </p>

      <div className="no-drag mt-5 grid w-full grid-cols-3 gap-2">
        <LinkButton icon={<Globe size={14} />} label="GitHub" onClick={() => void window.api.openExternal(info.repo)} />
        <LinkButton icon={<Bug size={14} />} label="Report issue" onClick={() => void window.api.openExternal(info.issues)} />
        <LinkButton icon={<FileText size={14} />} label="Licenses" onClick={() => void window.api.thirdPartyNotices().then(setNotices)} />
      </div>

      <div className="no-drag mt-5 w-full select-text rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-left font-mono text-[10.5px] leading-5 text-ink-400">
        {details.map((d) => (
          <div key={d} className="truncate" title={d}>
            {d}
          </div>
        ))}
      </div>
      <button
        className="no-drag mt-1.5 flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-300"
        onClick={() => {
          void navigator.clipboard.writeText(details.join('\n'));
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Copy size={11} /> {copied ? 'Copied' : 'Copy version info'}
      </button>

      <div className="mt-auto pt-4 text-[11px] leading-5 text-ink-500">
        <div>{info.copyright}</div>
        <div>
          Free and open source under the MIT License.{' '}
          <button className="no-drag inline-flex items-center gap-0.5 text-ink-400 underline-offset-2 hover:underline" onClick={() => void window.api.openExternal(info.repo)}>
            Source <ExternalLink size={10} />
          </button>
        </div>
        <div>Includes ffmpeg (GPL v3), Electron and other open-source software.</div>
      </div>
    </div>
  );
}

function LinkButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center justify-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 py-2 text-xs text-ink-200 hover:border-ink-500">
      {icon}
      {label}
    </button>
  );
}
