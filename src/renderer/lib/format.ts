export function formatTime(sec: number, withFrames = false): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = h ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
  if (!withFrames) return base;
  return `${base}.${pad(Math.floor((s % 1) * 100))}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function timeAgo(ms: number): string {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} d ago`;
  return new Date(ms).toLocaleDateString();
}

export const isMac = () => window.api?.platform === 'darwin';
export const modKey = () => (isMac() ? '⌘' : 'Ctrl+');
