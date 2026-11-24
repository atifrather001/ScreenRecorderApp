import { useEffect, useState } from 'react';
import { Clapperboard, FileVideo, FolderOpen, MoreHorizontal, Plus, Upload, Video } from 'lucide-react';
import type { FFmpegInfo, ProjectSummary } from '@shared/types';
import { useApp } from '../store/app';

import { formatTime, isMac, timeAgo } from '../lib/format';
import { importMedia, newProject, openProjectDialog, openProjectPath } from '../lib/actions';

export function Home() {
  const setView = useApp((s) => s.setView);
  const project = useApp((s) => s.project);
  const settings = useApp((s) => s.settings)!;
  const [recent, setRecent] = useState<ProjectSummary[] | null>(null);
  const [ff, setFf] = useState<FFmpegInfo | null>(null);
  const [menu, setMenu] = useState<string | null>(null);

  const refresh = () => window.api.recentProjects().then(setRecent);
  useEffect(() => {
    void refresh();
    void window.api.ffmpegInfo().then(setFf);
  }, []);

  return (
    <div className="h-full overflow-auto" onClick={() => setMenu(null)}>
      <div className="drag h-10" />
      <div className="mx-auto max-w-5xl px-10 pb-16">
        <h1 className="text-2xl font-semibold text-white">Welcome back</h1>
        <p className="mt-1 text-ink-400">Record your screen, cut it into shape and share it.</p>

        {ff && ff.source === 'missing' && (
          <div className="mt-6 rounded-lg border border-amber-700/60 bg-amber-950/40 px-4 py-3 text-amber-200">
            ffmpeg was not found, so recordings can't be finalised or exported. Install it (for example{' '}
            <code className="text-amber-100">{isMac() ? 'brew install ffmpeg' : 'winget install ffmpeg'}</code>) or set its path in Settings.
          </div>
        )}

        <div className="mt-8 grid grid-cols-4 gap-4">
          <button
            onClick={() => setView('recorder')}
            className="group col-span-2 row-span-2 flex flex-col justify-between rounded-2xl bg-gradient-to-br from-rose-600 to-rose-800 p-6 text-left shadow-xl shadow-rose-950/40 transition-transform hover:scale-[1.01]"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15">
              <Video size={24} className="text-white" />
            </div>
            <div>
              <div className="text-xl font-semibold text-white">New recording</div>
              <div className="mt-1 text-sm text-rose-100/80">Screen, window or area, with microphone, system audio and camera.</div>
            </div>
          </button>
          <Tile icon={<Plus size={20} />} title="New project" text="Start with an empty timeline" onClick={() => void newProject()} />
          <Tile icon={<FolderOpen size={20} />} title="Open project" text="Continue earlier work" onClick={() => void openProjectDialog()} />
          <Tile icon={<Upload size={20} />} title="Import media" text="Edit existing videos, audio and images" onClick={() => void importMedia()} />
          {project ? (
            <Tile icon={<Clapperboard size={20} />} title="Back to editor" text={project.name} onClick={() => setView('editor')} />
          ) : (
            <Tile icon={<FileVideo size={20} />} title="Recordings folder" text={settings.recording.outputDirectory} onClick={() => void window.api.openPath(settings.recording.outputDirectory)} />
          )}
        </div>

        <h2 className="mt-12 text-sm font-semibold uppercase tracking-wide text-ink-400">Recent projects</h2>
        {recent && recent.length === 0 && <p className="mt-4 text-ink-500">Projects you record or save will show up here.</p>}
        <div className="mt-4 grid grid-cols-3 gap-5">
          {recent?.map((r) => (
            <div
              key={r.path}
              className="group relative"
              onContextMenu={async (e) => {
                e.preventDefault();
                const choice = await window.api.contextMenu([
                  { id: 'open', label: 'Open' },
                  { id: 'reveal', label: window.api.platform === 'darwin' ? 'Show in Finder' : 'Show in Folder' },
                  { type: 'separator' },
                  { id: 'remove', label: 'Remove from Recent Projects' },
                ]);
                if (choice === 'open') void openProjectPath(r.path);
                else if (choice === 'reveal') void window.api.revealInFolder(r.path);
                else if (choice === 'remove') {
                  await window.api.removeRecentProject(r.path);
                  void refresh();
                }
              }}
            >
              <button className="w-full text-left" onClick={() => void openProjectPath(r.path)}>
                <div className="checker relative aspect-video overflow-hidden rounded-xl border border-ink-800 group-hover:border-accent-600">
                  {r.thumbnail ? (
                    <img src={`${window.api.mediaUrl(r.thumbnail)}?v=${r.updatedAt}`} className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-ink-600">
                      <FileVideo size={28} />
                    </div>
                  )}
                  <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">{formatTime(r.duration)}</span>
                </div>
                <div className="mt-2 truncate font-medium text-ink-200">{r.name}</div>
                <div className="text-xs text-ink-500">{timeAgo(r.updatedAt)}</div>
              </button>
              <button
                className="absolute right-2 top-2 hidden rounded-md bg-black/60 p-1 text-white group-hover:block"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === r.path ? null : r.path);
                }}
                aria-label="Project options"
              >
                <MoreHorizontal size={16} />
              </button>
              {menu === r.path && (
                <div className="absolute right-2 top-10 z-10 w-44 rounded-lg border border-ink-700 bg-ink-850 py-1 shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <MenuItem onClick={() => void window.api.revealInFolder(r.path)}>Show in folder</MenuItem>
                  <MenuItem
                    onClick={async () => {
                      await window.api.removeRecentProject(r.path);
                      setMenu(null);
                      void refresh();
                    }}
                  >
                    Remove from list
                  </MenuItem>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Tile({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col gap-3 rounded-2xl border border-ink-800 bg-ink-900 p-4 text-left transition-colors hover:border-ink-600 hover:bg-ink-850">
      <div className="text-accent-400">{icon}</div>
      <div className="min-w-0">
        <div className="font-medium text-ink-200">{title}</div>
        <div className="truncate text-xs text-ink-500">{text}</div>
      </div>
    </button>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button className="block w-full px-3 py-1.5 text-left text-[13px] text-ink-200 hover:bg-ink-700" onClick={onClick}>
      {children}
    </button>
  );
}

