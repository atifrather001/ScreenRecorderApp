import { useEffect } from 'react';
import { clsx } from 'clsx';
import { Clapperboard, Home as HomeIcon, Settings as SettingsIcon, Video } from 'lucide-react';
import { useApp, View } from './store/app';
import { Toasts } from './components/ui';
import { Home } from './views/Home';
import { Recorder } from './views/Recorder';
import { Settings } from './views/Settings';
import { Editor } from './views/editor/Editor';
import { recorder } from './lib/recorder-engine';
import { finishRecording, importMedia, newProject, openProjectDialog, openProjectPath, saveProject } from './lib/actions';
import { isMac } from './lib/format';
import { splitAt, deleteClips, deleteAnnotations, deleteZooms } from '@shared/timeline';

/** Set by the Recorder view so global shortcuts can start a recording with the current choices. */
export const quickStart: { fn: (() => void) | null; pending: boolean } = { fn: null, pending: false };

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function deleteSelection(ripple = false): void {
  const { selection, edit, select } = useApp.getState();
  if (selection.kind === 'clips') edit((p) => deleteClips(p, selection.ids, ripple));
  else if (selection.kind === 'annotation') edit((p) => deleteAnnotations(p, [selection.id]));
  else if (selection.kind === 'zoom') edit((p) => deleteZooms(p, [selection.id]));
  else return;
  select({ kind: 'none' });
}

export function App() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const project = useApp((s) => s.project);
  const loadSettings = useApp((s) => s.loadSettings);
  const settings = useApp((s) => s.settings);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Menu actions from the main process
  useEffect(
    () =>
      window.api.onMenu((action) => {
        const s = useApp.getState();
        switch (action) {
          case 'new-recording':
            if (!recorder.active) s.setView('recorder');
            break;
          case 'new-project':
            void newProject();
            break;
          case 'open-project':
            void openProjectDialog();
            break;
          case 'import-media':
            void importMedia();
            break;
          case 'save':
            void saveProject();
            break;
          case 'save-as':
            void saveProject(true);
            break;
          case 'export':
            if (s.project) {
              s.setView('editor');
              window.dispatchEvent(new CustomEvent('open-export'));
            }
            break;
          case 'undo':
            if (isTyping()) document.execCommand('undo');
            else s.undo();
            break;
          case 'redo':
            if (isTyping()) document.execCommand('redo');
            else s.redo();
            break;
          case 'split':
            if (s.project && s.view === 'editor') s.edit((p) => splitAt(p, s.playhead, s.selection.kind === 'clips' ? s.selection.ids : undefined));
            break;
          case 'delete':
            deleteSelection();
            break;
          case 'settings':
            s.setView('settings');
            break;
          case 'home':
            s.setView('home');
            break;
        }
      }),
    [],
  );

  // Global shortcut / control bar commands
  useEffect(() => {
    recorder.setFinishedHandler((p) => {
      p.then((r) => r && finishRecording(r)).catch((err) => useApp.getState().toast(`Recording failed: ${(err as Error).message}`, 'error'));
    });
    return window.api.onRecorderCommand((cmd) => {
      const st = recorder.status.phase;
      if (cmd === 'pause') recorder.pause();
      else if (cmd === 'resume') recorder.resume();
      else if (cmd === 'cancel') void recorder.cancel();
      else if (cmd === 'stop' || (cmd === 'toggle' && (st === 'recording' || st === 'paused' || st === 'countdown'))) void recorder.stopAndNotify();
      else if (cmd === 'toggle' && st === 'idle') {
        useApp.getState().setView('recorder');
        // The recorder starts as soon as its list of screens has loaded.
        quickStart.pending = true;
        if (quickStart.fn) setTimeout(() => quickStart.fn?.(), 0);
      }
    });
  }, []);

  useEffect(() => window.api.onOpenProjectPath((p) => void openProjectPath(p)), []);

  // Warn before closing with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useApp.getState().dirty || recorder.active) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  if (!settings) return <div className="h-full bg-ink-950" />;

  const nav: { id: View; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { id: 'home', label: 'Home', icon: <HomeIcon size={18} /> },
    { id: 'recorder', label: 'Record', icon: <Video size={18} /> },
    { id: 'editor', label: 'Edit', icon: <Clapperboard size={18} />, disabled: !project },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon size={18} /> },
  ];

  return (
    <div className="flex h-full">
      <aside className={clsx('drag flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-ink-800 bg-ink-900 pb-3', isMac() ? 'pt-11' : 'pt-3')}>
        {nav.map((n) => (
          <button
            key={n.id}
            disabled={n.disabled}
            onClick={() => setView(n.id)}
            className={clsx(
              'no-drag flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-[10.5px] font-medium transition-colors disabled:opacity-30',
              view === n.id ? 'bg-ink-800 text-accent-400' : 'text-ink-400 hover:bg-ink-850 hover:text-ink-200',
            )}
          >
            {n.icon}
            {n.label}
          </button>
        ))}
      </aside>
      <main className="relative min-w-0 flex-1">
        {view === 'home' && <Home />}
        {view === 'recorder' && <Recorder />}
        {view === 'editor' && project && <Editor />}
        {view === 'settings' && <Settings />}
      </main>
      <Toasts />
    </div>
  );
}

export { isTyping };
