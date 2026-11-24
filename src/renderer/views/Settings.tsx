import { useEffect, useState } from 'react';
import type { FFmpegInfo } from '@shared/types';
import { useApp } from '../store/app';
import { Button, Field, Select, Toggle } from '../components/ui';
import { isMac } from '../lib/format';

export function Settings() {
  const settings = useApp((s) => s.settings)!;
  const update = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const [ff, setFf] = useState<FFmpegInfo | null>(null);
  const rec = settings.recording;

  useEffect(() => {
    void window.api.ffmpegInfo().then(setFf);
  }, [settings.ffmpegPath]);

  return (
    <div className="h-full overflow-auto">
      <div className="drag h-10" />
      <div className="mx-auto max-w-2xl px-8 pb-16">
        <h1 className="text-2xl font-semibold text-white">Settings</h1>

        <Section title="Recording">
          <Field label="Save recordings to" hint={rec.outputDirectory}>
            <Button size="sm" onClick={() => void window.api.openPath(rec.outputDirectory)}>
              Open
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                const d = await window.api.chooseDirectory(rec.outputDirectory);
                if (d) await update({ recording: { outputDirectory: d } });
              }}
            >
              Change…
            </Button>
          </Field>
          <Field label="Hide this window while recording">
            <Toggle checked={rec.hideMainWindow} onChange={(v) => void update({ recording: { hideMainWindow: v } })} />
          </Field>
          <Field label="Red frame around the recorded area" hint="Not visible in the recording itself">
            <Toggle checked={rec.showBorder} onChange={(v) => void update({ recording: { showBorder: v } })} />
          </Field>
          <Field label="Open the editor when a recording stops">
            <Toggle checked={rec.openEditorAfterRecording} onChange={(v) => void update({ recording: { openEditorAfterRecording: v } })} />
          </Field>
          <Field label="Microphone noise suppression">
            <Toggle checked={rec.noiseSuppression} onChange={(v) => void update({ recording: { noiseSuppression: v } })} />
          </Field>
        </Section>

        <Section title="AI captions & notes" hint="Captions are transcribed on this computer. Notes are written by Claude with your own API key.">
          <Field label="Speech model" hint="Downloaded once on first use">
            <Select
              value={settings.ai.captionModel}
              options={[
                { value: 'onnx-community/whisper-tiny', label: 'Fast (tiny, 40 MB)' },
                { value: 'onnx-community/whisper-base', label: 'Balanced (base, 150 MB)' },
                { value: 'onnx-community/whisper-small', label: 'Accurate (small, 500 MB)' },
              ]}
              onChange={(v) => void update({ ai: { captionModel: v } })}
            />
          </Field>
          <Field label="Spoken language">
            <Select
              value={settings.ai.language === 'auto' ? 'english' : settings.ai.language}
              options={[
                ...[
                  ['english', 'English'],
                  ['urdu', 'Urdu'],
                  ['hindi', 'Hindi'],
                  ['arabic', 'Arabic'],
                  ['spanish', 'Spanish'],
                  ['french', 'French'],
                  ['german', 'German'],
                  ['chinese', 'Chinese'],
                  ['japanese', 'Japanese'],
                ].map(([value, label]) => ({ value, label })),
              ]}
              onChange={(v) => void update({ ai: { language: v } })}
            />
          </Field>
          <Field label="Anthropic API key" hint={settings.ai.hasApiKey ? 'Saved and encrypted on this computer' : 'Needed for AI notes. Get one at console.anthropic.com'}>
            <ApiKeyField hasKey={settings.ai.hasApiKey} />
          </Field>
          <Field label="Write notes automatically after a captioned recording">
            <Toggle checked={settings.ai.autoNotes} disabled={!settings.ai.hasApiKey} onChange={(v) => void update({ ai: { autoNotes: v } })} />
          </Field>
        </Section>

        <Section title="Keyboard shortcuts" hint="These work everywhere, even when the app is in the background.">
          <Field label="Start / stop recording">
            <ShortcutInput value={settings.hotkeys.startStop} onChange={(v) => void update({ hotkeys: { startStop: v } })} />
          </Field>
          <Field label="Pause / resume recording">
            <ShortcutInput value={settings.hotkeys.pauseResume} onChange={(v) => void update({ hotkeys: { pauseResume: v } })} />
          </Field>
        </Section>

        <Section title="ffmpeg" hint="Used to finalise recordings and to export.">
          <Field label="In use" hint={ff ? (ff.source === 'missing' ? 'Not found' : `${ff.path}`) : '…'}>
            {ff && ff.source !== 'missing' && (
              <span className="rounded bg-ink-800 px-2 py-0.5 text-xs text-ink-300">
                {ff.source} · {ff.version}
              </span>
            )}
          </Field>
          {ff && ff.encoders.some((e) => /videotoolbox|nvenc|qsv|amf/.test(e)) && (
            <Field label="Hardware encoders" hint={ff.encoders.filter((e) => /videotoolbox|nvenc|qsv|amf/.test(e)).join(', ')}>
              <span />
            </Field>
          )}
          <Field label="Custom ffmpeg binary" hint={settings.ffmpegPath || "Automatic (the copy included with the app)"}>
            {settings.ffmpegPath && (
              <Button size="sm" variant="ghost" onClick={() => void update({ ffmpegPath: '' })}>
                Use automatic
              </Button>
            )}
            <Button
              size="sm"
              onClick={async () => {
                const d = await window.api.chooseDirectory();
                if (!d) return;
                const file = `${d}/${isMac() || window.api.platform === 'linux' ? 'ffmpeg' : 'ffmpeg.exe'}`;
                await update({ ffmpegPath: file });
                const info = await window.api.ffmpegInfo();
                if (info.source !== 'custom') toast(`No ffmpeg found in ${d}`, 'error');
              }}
            >
              Choose folder…
            </Button>
          </Field>
        </Section>

        <div className="mt-10">
          <Button
            variant="ghost"
            onClick={async () => {
              if (!window.confirm('Reset all settings to their defaults?')) return;
              useApp.setState({ settings: await window.api.resetSettings() });
              toast('Settings reset', 'success');
            }}
          >
            Reset to defaults
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-ink-200">{title}</h2>
      {hint && <p className="text-xs text-ink-500">{hint}</p>}
      <div className="mt-2 divide-y divide-ink-800 rounded-xl border border-ink-800 bg-ink-900 px-4">{children}</div>
    </section>
  );
}

const KEY_NAMES: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc' };

/** Records a key combination as an Electron accelerator string. */
function ShortcutInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [listening, setListening] = useState(false);
  const pretty = value
    .replace('Command', '⌘')
    .replace('Control', 'Ctrl')
    .replace('Shift', '⇧')
    .replace('Alt', isMac() ? '⌥' : 'Alt')
    .replace(/\+/g, ' ');
  return (
    <button
      className={`h-8 min-w-[140px] rounded-md border px-3 text-[13px] ${listening ? 'border-accent-500 text-accent-400' : 'border-ink-700 bg-ink-850 text-ink-200'}`}
      onClick={() => setListening(true)}
      onBlur={() => setListening(false)}
      onKeyDown={(e) => {
        if (!listening) return;
        e.preventDefault();
        if (e.key === 'Escape') return setListening(false);
        if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return;
        const parts: string[] = [];
        if (e.metaKey) parts.push(isMac() ? 'Command' : 'Super');
        if (e.ctrlKey) parts.push('Control');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (!parts.length) return;
        const key = KEY_NAMES[e.key] ?? (e.code.startsWith('Digit') ? e.code.slice(5) : e.code.startsWith('Key') ? e.code.slice(3) : e.key.toUpperCase());
        onChange([...parts, key].join('+'));
        setListening(false);
      }}
    >
      {listening ? 'Press keys…' : pretty}
    </button>
  );
}

function ApiKeyField({ hasKey }: { hasKey: boolean }) {
  const [value, setValue] = useState('');
  const toast = useApp((s) => s.toast);
  const save = async (key: string | null) => {
    useApp.setState({ settings: await window.api.setApiKey(key) });
    setValue('');
    toast(key ? 'API key saved' : 'API key removed', 'success');
  };
  if (hasKey) {
    return (
      <Button size="sm" variant="ghost" onClick={() => void save(null)}>
        Remove key
      </Button>
    );
  }
  return (
    <>
      <input
        type="password"
        placeholder="sk-ant-…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 w-48 rounded-md border border-ink-700 bg-ink-850 px-2 text-xs text-ink-200 outline-none focus:border-accent-500"
      />
      <Button size="sm" disabled={!value.trim().startsWith('sk-')} onClick={() => void save(value.trim())}>
        Save
      </Button>
    </>
  );
}
