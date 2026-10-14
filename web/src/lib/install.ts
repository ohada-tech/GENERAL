/**
 * התקנה כאפליקציה (PWA): במחשב — Chrome/Edge מתקינים את המערכת כחלון נפרד עם אייקון משלה.
 * האירוע beforeinstallprompt יכול להגיע לפני ש-React עולה, לכן נתפס כאן מוקדם ונשמר.
 */
import { startAutoUpdate } from './autoUpdate';

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

export function registerInstall() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  // רק בשרת האמיתי (לא בפיתוח ולא בגרסת claude.ai)
  if ('serviceWorker' in navigator && import.meta.env.PROD && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  if (import.meta.env.PROD) startAutoUpdate();
}

export const isInstalledApp = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const canPromptInstall = () => !!deferred;

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const d = deferred;
  await d.prompt();
  const { outcome } = await d.userChoice;
  deferred = null;
  notify();
  return outcome === 'accepted';
}

export function onInstallChange(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
