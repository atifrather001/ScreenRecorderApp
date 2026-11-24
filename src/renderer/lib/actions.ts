// App-level actions shared by menus, buttons and shortcuts.
import { PROJECT_EXTENSION } from '@shared/presets';
import { addAsset, createProject, findClip, placeAsset, projectDuration, projectFromRecording } from '@shared/timeline';
import { toTranscript } from '@shared/captions';
import { transcriber } from './transcriber';
import type { MediaAsset } from '@shared/types';
import { useApp } from '../store/app';
import type { RecordingResult } from './recorder-engine';

const st = () => useApp.getState();

export async function saveProject(saveAs = false): Promise<boolean> {
  const { project, projectPath } = st();
  if (!project) return false;
  try {
    const path = await window.api.saveProject(project, saveAs ? null : projectPath);
    if (!path) return false;
    st().markSaved(path);
    st().toast('Project saved', 'success');
    return true;
  } catch (err) {
    st().toast(`Could not save: ${(err as Error).message}`, 'error');
    return false;
  }
}

/** Ask before discarding unsaved changes. Returns false if the user cancels. */
export async function confirmDiscard(): Promise<boolean> {
  const { dirty, project } = st();
  if (!dirty || !project) return true;
  const answer = window.confirm(`Save changes to “${project.name}” before closing it?\n\nOK saves, Cancel discards the changes.`);
  if (answer) return saveProject();
  return true;
}

export async function openProjectPath(path: string): Promise<void> {
  if (!(await confirmDiscard())) return;
  try {
    const { project, path: p } = await window.api.loadProject(path);
    st().openProject(project, p);
    const missing = project.assets.filter((a) => !a.path);
    if (missing.length) st().toast(`${missing.length} media file(s) are missing`, 'error');
  } catch (err) {
    st().toast(`Could not open project: ${(err as Error).message}`, 'error');
  }
}

export async function openProjectDialog(): Promise<void> {
  if (!(await confirmDiscard())) return;
  try {
    const r = await window.api.openProjectDialog();
    if (r) st().openProject(r.project, r.path);
  } catch (err) {
    st().toast(`Could not open project: ${(err as Error).message}`, 'error');
  }
}

export async function newProject(): Promise<void> {
  if (!(await confirmDiscard())) return;
  st().openProject(createProject('Untitled project'), null);
}

export async function importMedia(assets?: MediaAsset[]): Promise<void> {
  const list = assets ?? (await window.api.importMediaDialog());
  if (!list.length) return;
  if (!st().project) st().openProject(createProject(list[0].name), null);
  const first = st().project!;
  const firstTimeline = first.tracks.every((t) => t.clips.length === 0);
  st().edit((p) => {
    let next = p;
    // Use the first imported video's size for an empty project.
    const firstVideo = list.find((a) => a.hasVideo && a.width);
    if (firstTimeline && firstVideo && p.assets.length === 0) {
      next = { ...next, width: Math.round(firstVideo.width / 2) * 2, height: Math.round(firstVideo.height / 2) * 2 };
    }
    for (const a of list) next = addAsset(next, a);
    // Put imports straight on the timeline when the project is empty.
    if (firstTimeline) {
      let t = 0;
      for (const a of list) {
        const track = next.tracks.find((tr) => (a.hasVideo ? tr.kind === 'video' : tr.kind === 'audio'));
        if (!track) continue;
        const r = placeAsset(next, a.id, track.id, a.hasVideo ? t : 0);
        next = r.project;
        if (a.hasVideo) t = findClip(next, r.clipId)!.clip.start + (a.kind === 'image' ? 5 : a.duration);
      }
    }
    return next;
  });
  st().toast(`Imported ${list.length} file${list.length > 1 ? 's' : ''}`, 'success');
}

export async function finishRecording(result: RecordingResult): Promise<void> {
  const fps = st().settings?.recording.fps ?? 30;
  const project = { ...projectFromRecording(result.name, result.assets, fps), captions: result.captions };
  for (const w of result.warnings) st().toast(w, 'error');
  const path = `${result.dir}/${result.name}.${PROJECT_EXTENSION}`;
  let saved: string | null = null;
  try {
    saved = await window.api.saveProject(project, path);
  } catch (err) {
    st().toast(`Recording saved, but the project file failed: ${(err as Error).message}`, 'error');
  }
  if (st().settings?.recording.openEditorAfterRecording !== false) {
    if (!(await confirmDiscard())) return;
    st().openProject(project, saved);
    const ai = st().settings?.ai;
    if (ai?.autoNotes && ai.hasApiKey && result.captions.length) void generateNotes(true);
  } else {
    st().toast('Recording saved', 'success', { label: 'Show', run: () => void window.api.revealInFolder(result.dir) });
  }
}

/** Ask Claude for notes from the project's transcript and store them in the project. */
export async function generateNotes(auto = false): Promise<boolean> {
  const p = st().project;
  if (!p) return false;
  try {
    if (auto) st().toast('Writing AI notes…', 'info');
    const notes = await window.api.generateNotes({ title: p.name, transcript: toTranscript(p.captions ?? []), durationSec: projectDuration(p) });
    if (st().project?.id !== p.id) return false;
    st().edit((q) => ({ ...q, notes }));
    st().toast('AI notes are ready in the Notes tab', 'success');
    return true;
  } catch (err) {
    st().toast((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
    return false;
  }
}

/** Transcribe the whole timeline locally and replace the project's captions. */
export async function transcribeProject(onProgress: (f: number, label: string) => void): Promise<boolean> {
  const p = st().project;
  if (!p) return false;
  const ai = st().settings!.ai;
  try {
    onProgress(0, 'Loading speech model…');
    await transcriber.load(ai.captionModel, (f, label) => onProgress(f * 0.3, label));
    onProgress(0.3, 'Preparing audio…');
    const buf = await window.api.speechAudio(p);
    const audio = new Float32Array(buf);
    if (!audio.length) throw new Error('The timeline has no audio to transcribe.');
    const segs = await transcriber.transcribeLong(audio, ai.language, (f) => onProgress(0.3 + f * 0.7, 'Transcribing…'));
    if (st().project?.id !== p.id) return false;
    st().edit((q) => ({ ...q, captions: segs }));
    st().toast(segs.length ? `Transcribed ${segs.length} captions` : 'No speech was found', segs.length ? 'success' : 'info');
    return true;
  } catch (err) {
    st().toast(`Transcription failed: ${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'error');
    return false;
  }
}
