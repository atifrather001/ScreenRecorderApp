import React, { useEffect } from 'react';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { useApp } from '../store/app';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'record';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; icon?: React.ReactNode }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' && 'h-7 px-2.5 text-xs',
        size === 'md' && 'h-8 px-3 text-[13px]',
        size === 'lg' && 'h-11 px-5 text-sm',
        variant === 'primary' && 'bg-accent-600 text-white hover:bg-accent-500',
        variant === 'secondary' && 'bg-ink-800 text-ink-200 hover:bg-ink-700 border border-ink-700',
        variant === 'ghost' && 'text-ink-300 hover:bg-ink-800 hover:text-ink-200',
        variant === 'danger' && 'bg-rose-600/90 text-white hover:bg-rose-500',
        variant === 'record' && 'bg-rose-600 text-white hover:bg-rose-500 shadow-lg shadow-rose-900/40',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      className={clsx(
        'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:pointer-events-none',
        active ? 'bg-accent-600/20 text-accent-400' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-200',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40',
        checked ? 'bg-accent-600' : 'bg-ink-700',
      )}
    >
      <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  className,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <select
      disabled={disabled}
      value={String(value)}
      onChange={(e) => {
        const opt = options.find((o) => String(o.value) === e.target.value);
        if (opt) onChange(opt.value);
      }}
      className={clsx(
        'h-8 rounded-md border border-ink-700 bg-ink-850 px-2 text-[13px] text-ink-200 outline-none focus:border-accent-500 disabled:opacity-40',
        className,
      )}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
}) {
  const [text, setText] = React.useState(String(value));
  useEffect(() => setText(String(Math.round(value * 1000) / 1000)), [value]);
  const commit = () => {
    let v = parseFloat(text);
    if (Number.isNaN(v)) return setText(String(value));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
  };
  return (
    <div className={clsx('flex h-7 items-center rounded-md border border-ink-700 bg-ink-850 focus-within:border-accent-500', className)}>
      <input
        className="w-full min-w-0 bg-transparent px-2 text-xs text-ink-200 outline-none"
        value={text}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = value + (e.key === 'ArrowUp' ? step : -step);
            onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(v * 1000) / 1000)));
          }
        }}
      />
      {suffix && <span className="pr-2 text-[11px] text-ink-500">{suffix}</span>}
    </div>
  );
}

export function Slider({ value, min, max, step = 0.01, onChange, onCommit }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: () => void }) {
  return (
    <input
      type="range"
      className="w-full"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      onPointerUp={onCommit}
      onKeyUp={onCommit}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-ink-200">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-ink-400">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, children, width = 520 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="max-h-[90vh] overflow-auto rounded-xl border border-ink-700 bg-ink-900 shadow-2xl"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-200">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-96 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-[13px] shadow-xl',
            t.kind === 'error' && 'border-rose-800 bg-rose-950 text-rose-100',
            t.kind === 'success' && 'border-accent-700 bg-ink-850 text-ink-200',
            t.kind === 'info' && 'border-ink-700 bg-ink-850 text-ink-200',
          )}
        >
          <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{t.text}</div>
          {t.action && (
            <button
              className="shrink-0 font-medium text-accent-400 hover:text-accent-400/80"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="shrink-0 text-ink-400 hover:text-ink-200" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-sans text-[11px] text-ink-300">{children}</kbd>;
}
