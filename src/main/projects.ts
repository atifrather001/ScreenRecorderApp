// Project files (.srproj, JSON) and their thumbnails.
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, join, relative, resolve } from 'path';
import { projectDuration } from '@shared/timeline';
import type { Project, ProjectSummary } from '@shared/types';
import { ffmpeg } from './ffmpeg';

interface StoredProject extends Project {
  /** Asset paths relative to the project file, used to relink moved projects. */
  relativePaths?: Record<string, string>;
}

export function writeProject(project: Project, path: string): void {
  const dir = dirname(path);
  const stored: StoredProject = {
    ...project,
    relativePaths: Object.fromEntries(project.assets.map((a) => [a.id, relative(dir, a.path)])),
  };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(stored, null, 2));
  renameSync(tmp, path);
  void makeThumbnail(project, path);
}

export function readProject(path: string): Project {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as StoredProject;
  if (raw.version !== 1 || !Array.isArray(raw.tracks)) throw new Error(`${basename(path)} is not a valid project file.`);
  const dir = dirname(path);
  // Relink assets whose absolute path no longer exists (e.g. the folder was moved).
  raw.assets = raw.assets.map((a) => {
    if (existsSync(a.path)) return a;
    const rel = raw.relativePaths?.[a.id];
    const candidates = [rel ? resolve(dir, rel) : '', join(dir, basename(a.path))].filter(Boolean);
    const found = candidates.find((c) => existsSync(c));
    return found ? { ...a, path: found } : a;
  });
  delete raw.relativePaths;
  return raw;
}

function thumbPath(projectPath: string): string {
  return projectPath.replace(/\.srproj$/, '.thumb.jpg');
}

async function makeThumbnail(project: Project, projectPath: string): Promise<void> {
  const out = thumbPath(projectPath);
  const screen = project.assets.find((a) => a.role === 'screen' && existsSync(a.path)) ?? project.assets.find((a) => a.hasVideo && existsSync(a.path));
  if (!screen) return;
  if (existsSync(out) && statSync(out).mtimeMs > statSync(screen.path).mtimeMs) return;
  const t = screen.kind === 'image' ? 0 : Math.min(1, screen.duration / 2);
  await ffmpeg.run(['-y', '-hide_banner', '-v', 'error', '-ss', String(t), '-i', screen.path, '-frames:v', '1', '-vf', 'scale=480:-2', out]).catch(() => undefined);
}

export function summary(path: string): ProjectSummary | null {
  try {
    const p = readProject(path);
    const thumb = thumbPath(path);
    return {
      path,
      name: p.name,
      updatedAt: p.updatedAt,
      duration: projectDuration(p),
      thumbnail: existsSync(thumb) ? thumb : undefined,
    };
  } catch {
    return null;
  }
}
