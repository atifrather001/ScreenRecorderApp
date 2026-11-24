import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AppWindow, Camera, Crop, Mic, Monitor, RefreshCw, Volume2 } from 'lucide-react';
import type { PermissionStatus, Rect, ScreenSource } from '@shared/types';
import { useApp } from '../store/app';
import { Button, Field, Select, Toggle } from '../components/ui';
import { recorder } from '../lib/recorder-engine';
import { finishRecording } from '../lib/actions';
import { isMac } from '../lib/format';
import { cappedSize, estimateMBPerMinute } from '@shared/presets';
import { quickStart } from '../App';
import { transcriber } from '../lib/transcriber';
import { Captions } from 'lucide-react';

type Mode = 'screen' | 'area' | 'window';

export function Recorder() {
  const settings = useApp((s) => s.settings)!;
  const updateSettings = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const rec = settings.recording;

  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [mode, setMode] = useState<Mode>('screen');
  const [selected, setSelected] = useState<string | null>(null);
  const [region, setRegion] = useState<Rect | null>(null);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [perm, setPerm] = useState<PermissionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelProgress, setModelProgress] = useState<{ f: number; label: string } | null>(null);
  const [phase, setPhase] = useState(recorder.status.phase);

  useEffect(() => recorder.subscribe((s) => setPhase(s.phase)), []);

  const loadSources = useCallback(async () => {
    try {
      const list = await window.api.getSources();
      setSources(list);
      setSelected((cur) => (cur && list.some((s) => s.id === cur) ? cur : (list.find((s) => s.kind === 'screen')?.id ?? null)));
    } catch (err) {
      toast(`Could not list screens: ${(err as Error).message}`, 'error');
      setSources([]);
    }
    setPerm(await window.api.permissions());
  }, [toast]);

  const loadDevices = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    setMics(devices.filter((d) => d.kind === 'audioinput'));
    setCams(devices.filter((d) => d.kind === 'videoinput'));
  }, []);

  useEffect(() => {
    void loadSources();
    void loadDevices();
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
  }, [loadSources, loadDevices]);

  const screens = sources?.filter((s) => s.kind === 'screen') ?? [];
  const windows = sources?.filter((s) => s.kind === 'window') ?? [];
  const source = sources?.find((s) => s.id === selected) ?? null;

  const chooseMode = (m: Mode) => {
    setMode(m);
    if (m !== 'window' && source?.kind !== 'screen') setSelected(screens[0]?.id ?? null);
    if (m === 'window' && source?.kind !== 'window') setSelected(windows[0]?.id ?? null);
    if (m !== 'area') setRegion(null);
  };

  const pickRegion = async (screen?: ScreenSource) => {
    const s = screen ?? (source?.kind === 'screen' ? source : screens[0]);
    if (!s) return;
    setSelected(s.id);
    const r = await window.api.selectRegion(s.displayId);
    if (r) {
      setRegion(r);
      setMode('area');
    }
  };

  const ensurePermission = async (kind: 'microphone' | 'camera') => {
    const ok = await window.api.requestPermission(kind);
    if (!ok) toast(`${kind === 'microphone' ? 'Microphone' : 'Camera'} access is blocked. Allow it in System Settings.`, 'error', {
      label: 'Open',
      run: () => void window.api.openPermissionSettings(kind),
    });
    await loadDevices();
    setPerm(await window.api.permissions());
    return ok;
  };

  const start = async () => {
    if (!source) return toast('Choose a screen or window first.', 'error');
    if (mode === 'area' && !region) return pickRegion();
    setBusy(true);
    try {
      let captions = rec.liveCaptions && (rec.microphone || rec.systemAudio);
      if (captions) {
        try {
          await transcriber.load(settings.ai.captionModel, (f, label) => setModelProgress({ f, label }));
          // Without a GPU the larger models can't keep up in real time; use the fast model for live captions.
          // ("Transcribe again" in the editor still uses the model chosen in Settings.)
          if (transcriber.device === 'wasm' && settings.ai.captionModel !== 'onnx-community/whisper-tiny') {
            await transcriber.load('onnx-community/whisper-tiny', (f, label) => setModelProgress({ f, label }));
          }
        } catch (err) {
          captions = false;
          toast(`Live captions are off for this recording: the speech model could not load (${(err as Error).message}). You can still transcribe later in the editor.`, 'error');
        } finally {
          setModelProgress(null);
        }
      }
      await recorder.start({
        liveCaptions: !!captions,
        language: settings.ai.language,
        source,
        region: mode === 'area' ? region : null,
        systemAudio: rec.systemAudio,
        microphoneId: rec.microphone ? rec.microphoneDeviceId || 'default' : null,
        cameraId: rec.camera ? rec.cameraDeviceId || cams[0]?.deviceId || null : null,
        fps: rec.fps,
        quality: rec.quality,
        countdown: rec.countdown,
        noiseSuppression: rec.noiseSuppression,
        maxHeight: rec.maxHeight,
        nativeSize: nativeSize(source),
      });
    } catch (err) {
      const msg = (err as Error).message;
      toast(
        /Permission|NotAllowed|denied/i.test(msg) && isMac()
          ? 'Screen recording permission is needed. Allow ScreenRecorderApp (or Electron in development) in System Settings › Privacy & Security › Screen Recording, then restart the app.'
          : `Could not start recording: ${msg}`,
        'error',
        isMac() ? { label: 'Open settings', run: () => void window.api.openPermissionSettings('screen') } : undefined,
      );
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    try {
      const r = await recorder.stop();
      if (r) await finishRecording(r);
    } catch (err) {
      toast(`Recording failed: ${(err as Error).message}`, 'error');
    }
  };

  quickStart.fn = source
    ? () => {
        quickStart.pending = false;
        void start();
      }
    : null;
  useEffect(() => {
    if (quickStart.pending && source && !busy) quickStart.fn?.();
  });
  useEffect(
    () => () => {
      quickStart.fn = null;
      quickStart.pending = false;
    },
    [],
  );

  const active = phase !== 'idle';
  const list = mode === 'window' ? windows : screens;

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="drag flex h-14 shrink-0 items-end gap-2 px-6 pb-2">
          <h1 className="text-lg font-semibold text-white">New recording</h1>
          <div className="no-drag ml-auto">
            <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void loadSources()}>
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex gap-2 px-6 pt-2">
          {(
            [
              ['screen', 'Full screen', <Monitor size={16} key="m" />],
              ['area', 'Area', <Crop size={16} key="c" />],
              ['window', 'Window', <AppWindow size={16} key="w" />],
            ] as [Mode, string, React.ReactNode][]
          ).map(([m, label, icon]) => (
            <button
              key={m}
              onClick={() => (m === 'area' ? (chooseMode('area'), void pickRegion()) : chooseMode(m))}
              className={clsx(
                'flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13px] font-medium',
                mode === m ? 'border-accent-600 bg-accent-600/15 text-accent-400' : 'border-ink-800 bg-ink-900 text-ink-300 hover:border-ink-600',
              )}
            >
              {icon}
              {label}
            </button>
          ))}
          {mode === 'area' && region && source?.bounds && (
            <div className="ml-2 flex items-center gap-2 text-xs text-ink-400">
              {Math.round(region.w * source.bounds.w)} × {Math.round(region.h * source.bounds.h)} pt
              <Button size="sm" variant="ghost" onClick={() => void pickRegion()}>
                Change
              </Button>
            </div>
          )}
        </div>

        {perm && isMac() && perm.screen !== 'granted' && (
          <div className="mx-6 mt-4 flex items-center gap-3 rounded-lg border border-amber-700/60 bg-amber-950/40 px-4 py-2.5 text-amber-200">
            <span className="flex-1">
              Screen recording permission is “{perm.screen}”. macOS needs you to allow this app in Privacy & Security › Screen Recording (and restart it) before
              screens can be captured.
            </span>
            <Button size="sm" onClick={() => void window.api.openPermissionSettings('screen')}>
              Open settings
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {sources === null ? (
            <div className="text-ink-500">Looking for screens…</div>
          ) : list.length === 0 ? (
            <div className="text-ink-500">{mode === 'window' ? 'No windows found.' : 'No screens found.'}</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {list.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelected(s.id);
                    if (mode === 'area') void pickRegion(s);
                  }}
                  onDoubleClick={() => {
                    setSelected(s.id);
                    void start();
                  }}
                  className={clsx(
                    'group overflow-hidden rounded-xl border-2 bg-ink-900 text-left transition-colors',
                    selected === s.id ? 'border-accent-500' : 'border-transparent hover:border-ink-600',
                  )}
                >
                  <div className="relative aspect-video bg-black">
                    {s.thumbnail && <img src={s.thumbnail} className="h-full w-full object-contain" draggable={false} />}
                    {mode === 'area' && region && selected === s.id && (
                      <div
                        className="absolute border-2 border-dashed border-accent-400 bg-accent-500/10"
                        style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2">
                    {s.appIcon && <img src={s.appIcon} className="h-4 w-4" />}
                    <span className="truncate text-[13px] text-ink-200">{s.name}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <aside className="flex w-[340px] shrink-0 flex-col border-l border-ink-800 bg-ink-900">
        <div className="drag h-14 shrink-0" />
        <div className="min-h-0 flex-1 space-y-1 overflow-auto px-5">
          <SectionTitle>Audio</SectionTitle>
          <Field label="System audio" hint={isMac() ? 'What you hear (macOS 13 or later)' : 'What you hear on this computer'}>
            <Volume2 size={15} className="text-ink-400" />
            <Toggle checked={rec.systemAudio} onChange={(v) => void updateSettings({ recording: { systemAudio: v } })} />
          </Field>
          <Field label="Microphone">
            <Mic size={15} className="text-ink-400" />
            <Toggle
              checked={rec.microphone}
              onChange={async (v) => {
                if (v && !(await ensurePermission('microphone'))) return;
                void updateSettings({ recording: { microphone: v } });
              }}
            />
          </Field>
          {rec.microphone && (
            <div className="space-y-2 pb-2">
              <Select
                className="w-full"
                value={rec.microphoneDeviceId || 'default'}
                options={[{ value: 'default', label: 'System default' }, ...mics.filter((m) => m.deviceId !== 'default').map((m) => ({ value: m.deviceId, label: m.label || 'Microphone' }))]}
                onChange={(v) => void updateSettings({ recording: { microphoneDeviceId: v } })}
              />
              <MicMeter deviceId={rec.microphoneDeviceId} disabled={active} />
            </div>
          )}

          <SectionTitle>Camera</SectionTitle>
          <Field label="Record camera" hint="Placed as a picture-in-picture you can move later">
            <Camera size={15} className="text-ink-400" />
            <Toggle
              checked={rec.camera}
              onChange={async (v) => {
                if (v && !(await ensurePermission('camera'))) return;
                void updateSettings({ recording: { camera: v } });
              }}
            />
          </Field>
          {rec.camera && (
            <div className="space-y-2 pb-2">
              <Select
                className="w-full"
                value={rec.cameraDeviceId || cams[0]?.deviceId || ''}
                options={cams.map((c) => ({ value: c.deviceId, label: c.label || 'Camera' }))}
                onChange={(v) => void updateSettings({ recording: { cameraDeviceId: v } })}
              />
              {!active && <CameraPreview deviceId={rec.cameraDeviceId || cams[0]?.deviceId || ''} />}
            </div>
          )}

          <SectionTitle>AI</SectionTitle>
          <Field label="Live captions" hint="Transcribed on this computer. The speech model (about 150 MB) downloads the first time.">
            <Captions size={15} className="text-ink-400" />
            <Toggle checked={rec.liveCaptions} onChange={(v) => void updateSettings({ recording: { liveCaptions: v } })} />
          </Field>
          {rec.liveCaptions && !rec.microphone && !rec.systemAudio && <p className="pb-2 text-xs text-amber-400">Turn on the microphone or system audio to caption speech.</p>}

          <SectionTitle>Video</SectionTitle>
          <Field label="Frame rate">
            <Select
              value={rec.fps}
              options={[24, 30, 60].map((v) => ({ value: v as 24 | 30 | 60, label: `${v} fps` }))}
              onChange={(v) => void updateSettings({ recording: { fps: v } })}
            />
          </Field>
          <Field label="Resolution" hint="Lower resolutions make much smaller files">
            <Select
              value={rec.maxHeight}
              options={[
                { value: 0, label: 'Native' },
                { value: 2160, label: 'Up to 4K' },
                { value: 1440, label: 'Up to 1440p' },
                { value: 1080, label: 'Up to 1080p' },
              ]}
              onChange={(v) => void updateSettings({ recording: { maxHeight: v as 0 | 1080 | 1440 | 2160 } })}
            />
          </Field>
          <Field label="Quality">
            <Select
              value={rec.quality}
              options={[
                { value: 'standard', label: 'Standard' },
                { value: 'high', label: 'High' },
                { value: 'max', label: 'Maximum' },
              ]}
              onChange={(v) => void updateSettings({ recording: { quality: v } })}
            />
          </Field>
          <SizeEstimate source={source} />
          <Field label="Countdown">
            <Select
              value={rec.countdown}
              options={[0, 3, 5, 10].map((v) => ({ value: v, label: v ? `${v} seconds` : 'Off' }))}
              onChange={(v) => void updateSettings({ recording: { countdown: v } })}
            />
          </Field>
        </div>
        <div className="border-t border-ink-800 p-5">
          {active ? (
            <Button variant="danger" size="lg" className="w-full" onClick={() => void stop()}>
              {phase === 'finishing' ? 'Saving…' : 'Stop recording'}
            </Button>
          ) : (
            <Button variant="record" size="lg" className="w-full" disabled={busy || !source} onClick={() => void start()}>
              <span className="h-3 w-3 rounded-full bg-white" />
              {modelProgress ? `Speech model ${Math.round(modelProgress.f * 100)}%` : busy ? 'Starting…' : 'Start recording'}
            </Button>
          )}
          <p className="mt-2 text-center text-xs text-ink-500">
            Shortcut: {settings.hotkeys.startStop.replace('Command', '⌘').replace('Control', 'Ctrl').replace(/\+/g, ' ')}
          </p>
        </div>
      </aside>
    </div>
  );
}

function nativeSize(s: ScreenSource | null): { width: number; height: number } | null {
  if (!s?.bounds) return null;
  const k = s.scaleFactor ?? 1;
  return { width: Math.round(s.bounds.w * k), height: Math.round(s.bounds.h * k) };
}

function SizeEstimate({ source }: { source: ScreenSource | null }) {
  const rec = useApp((s) => s.settings!.recording);
  const native = nativeSize(source) ?? { width: 1920, height: 1080 };
  const size = cappedSize(native.width, native.height, rec.maxHeight);
  const mb = estimateMBPerMinute(rec.quality, size.width, size.height, rec.fps, { mic: rec.microphone, camera: rec.camera, systemAudio: rec.systemAudio });
  return (
    <p className="pb-2 text-xs text-ink-500">
      {size.width}×{size.height} · up to about {mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB per minute. Usually much less, because a still screen compresses to almost nothing.
    </p>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-500">{children}</div>;
}

function MicMeter({ deviceId, disabled }: { deviceId: string; disabled: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (disabled) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let stopped = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined } });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        const tick = () => {
          an.getFloatTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v));
          if (bar.current) bar.current.style.width = `${Math.min(100, peak * 140)}%`;
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        /* permission denied: the toggle shows the error */
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [deviceId, disabled]);
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
      <div ref={bar} className="h-full w-0 rounded-full bg-gradient-to-r from-accent-600 via-accent-400 to-amber-400 transition-[width] duration-75" />
    </div>
  );
}

function CameraPreview({ deviceId }: { deviceId: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    void navigator.mediaDevices
      .getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);
  return <video ref={video} autoPlay muted playsInline className="aspect-video w-full rounded-lg bg-black object-cover" style={{ transform: 'scaleX(-1)' }} />;
}
