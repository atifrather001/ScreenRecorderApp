import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { ControlBar } from './overlays/ControlBar';
import { Countdown } from './overlays/Countdown';
import { RegionSelector } from './overlays/RegionSelector';
import { Border } from './overlays/Border';
import { LiveCaption } from './overlays/LiveCaption';
import { About } from './overlays/About';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-lg font-semibold text-rose-400">Something went wrong</div>
        <pre className="max-w-2xl whitespace-pre-wrap text-xs text-ink-400">{this.state.error.message}</pre>
        <button className="rounded-md bg-ink-800 px-3 py-1.5" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}

const route = window.location.hash.replace(/^#/, '') || '/';
const overlay = route.startsWith('/controlbar') ? ControlBar : route.startsWith('/countdown') ? Countdown : route.startsWith('/region') ? RegionSelector : route.startsWith('/border') ? Border : route.startsWith('/captions') ? LiveCaption : route.startsWith('/about') ? About : null;
const isTransparent = overlay && overlay !== About;
if (isTransparent) document.documentElement.classList.add('transparent-window');
const Root = overlay ?? App;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);
