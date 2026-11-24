// Small JSON settings store in the user data folder.
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { APP_NAME, defaultSettings } from '@shared/presets';
import type { AppSettings } from '@shared/types';
import type { DeepPartial } from '@shared/api';

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export class SettingsStore {
  private file: string;
  private data: AppSettings;
  private listeners = new Set<(s: AppSettings) => void>();

  constructor() {
    this.file = join(app.getPath('userData'), 'settings.json');
    this.data = this.load();
  }

  defaults(): AppSettings {
    const videos = app.getPath('videos');
    return defaultSettings(join(videos, APP_NAME), process.platform === 'darwin');
  }

  private load(): AppSettings {
    try {
      if (existsSync(this.file)) return deepMerge(this.defaults(), JSON.parse(readFileSync(this.file, 'utf8')));
    } catch (err) {
      console.error('Could not read settings, using defaults:', err);
    }
    return this.defaults();
  }

  private save(): void {
    mkdirSync(app.getPath('userData'), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  get(): AppSettings {
    return structuredClone(this.data);
  }

  update(patch: DeepPartial<AppSettings>): AppSettings {
    this.data = deepMerge(this.data, patch);
    this.save();
    this.listeners.forEach((l) => l(this.get()));
    return this.get();
  }

  reset(): AppSettings {
    const recent = this.data.recentProjects;
    this.data = { ...this.defaults(), recentProjects: recent };
    this.save();
    this.listeners.forEach((l) => l(this.get()));
    return this.get();
  }

  onChange(l: (s: AppSettings) => void): void {
    this.listeners.add(l);
  }

  addRecent(path: string): void {
    const list = [path, ...this.data.recentProjects.filter((p) => p !== path)].slice(0, 20);
    this.update({ recentProjects: list });
  }

  removeRecent(path: string): void {
    this.update({ recentProjects: this.data.recentProjects.filter((p) => p !== path) });
  }
}
