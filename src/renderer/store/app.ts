import { create } from 'zustand';
import type { AppSettings, Project } from '@shared/types';
import type { DeepPartial } from '@shared/api';
import { projectDuration } from '@shared/timeline';

export type View = 'home' | 'recorder' | 'editor' | 'settings';

export type Selection =
  | { kind: 'none' }
  | { kind: 'clips'; ids: string[] }
  | { kind: 'annotation'; id: string }
  | { kind: 'zoom'; id: string };

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
  action?: { label: string; run: () => void };
}

interface AppState {
  view: View;
  previousView: View;
  settings: AppSettings | null;

  project: Project | null;
  projectPath: string | null;
  dirty: boolean;
  past: Project[];
  future: Project[];

  selection: Selection;
  playhead: number;
  playing: boolean;
  pxPerSec: number;

  toasts: Toast[];

  setView(v: View): void;
  loadSettings(): Promise<void>;
  updateSettings(patch: DeepPartial<AppSettings>): Promise<void>;

  openProject(p: Project, path: string | null): void;
  closeProject(): void;
  /** Apply an edit with undo history. Pass coalesce=true while dragging to merge steps. */
  edit(fn: (p: Project) => Project, coalesce?: boolean): void;
  commitCoalesced(): void;
  undo(): void;
  redo(): void;
  markSaved(path: string): void;

  select(s: Selection): void;
  setPlayhead(t: number): void;
  setPlaying(p: boolean): void;
  setPxPerSec(v: number): void;

  toast(text: string, kind?: Toast['kind'], action?: Toast['action']): void;
  dismissToast(id: number): void;
}

let toastId = 0;
let coalescing = false;
const HISTORY_LIMIT = 200;

export const useApp = create<AppState>((set, get) => ({
  view: 'home',
  previousView: 'home',
  settings: null,
  project: null,
  projectPath: null,
  dirty: false,
  past: [],
  future: [],
  selection: { kind: 'none' },
  playhead: 0,
  playing: false,
  pxPerSec: 60,
  toasts: [],

  setView: (view) => set((s) => ({ view, previousView: s.view === view ? s.previousView : s.view, playing: false })),

  loadSettings: async () => set({ settings: await window.api.getSettings() }),
  updateSettings: async (patch) => set({ settings: await window.api.updateSettings(patch) }),

  openProject: (project, projectPath) => {
    const d = projectDuration(project);
    set({
      project,
      projectPath,
      dirty: false,
      past: [],
      future: [],
      selection: { kind: 'none' },
      playhead: 0,
      playing: false,
      pxPerSec: d > 0 ? Math.min(200, Math.max(8, 900 / d)) : 60,
      view: 'editor',
    });
    window.api.setDocumentEdited(false);
  },

  closeProject: () => set({ project: null, projectPath: null, dirty: false, past: [], future: [], selection: { kind: 'none' } }),

  edit: (fn, coalesce = false) => {
    const { project, past } = get();
    if (!project) return;
    const next = fn(project);
    if (next === project) return;
    if (coalesce && coalescing) {
      set({ project: next, dirty: true });
    } else {
      set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [], dirty: true });
      coalescing = coalesce;
    }
    window.api.setDocumentEdited(true);
  },
  commitCoalesced: () => {
    coalescing = false;
  },

  undo: () => {
    const { past, project, future } = get();
    if (!past.length || !project) return;
    coalescing = false;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], dirty: true });
  },
  redo: () => {
    const { past, project, future } = get();
    if (!future.length || !project) return;
    coalescing = false;
    set({ project: future[0], future: future.slice(1), past: [...past, project], dirty: true });
  },
  markSaved: (path) => {
    set({ projectPath: path, dirty: false });
    window.api.setDocumentEdited(false);
  },

  select: (selection) => set({ selection }),
  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  setPxPerSec: (v) => set({ pxPerSec: Math.min(400, Math.max(2, v)) }),

  toast: (text, kind = 'info', action) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text, action }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
