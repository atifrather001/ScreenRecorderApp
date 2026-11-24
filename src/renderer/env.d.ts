/// <reference types="vite/client" />
import type { DesktopAPI } from '@shared/api';

declare global {
  interface Window {
    api: DesktopAPI;
  }
}
export {};
