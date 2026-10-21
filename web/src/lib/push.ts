/**
 * התראות Push: רישום המכשיר הזה לקבלת התראות מהשרת (גם כשהמערכת סגורה),
 * וסימון מספר על האייקון של האפליקציה בשורת המשימות.
 */
import { api } from './api';

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol === 'https:';

function keyBytes(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const deviceLabel = () => {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'מכשיר';
  return `${os} · ${/Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : 'דפדפן'}`;
};

/** רושם את המכשיר (מבקש הרשאה אם צריך). מחזיר true כשההתראות פעילות */
export async function enablePush(ask = true): Promise<boolean> {
  if (!pushSupported()) return false;
  let perm = Notification.permission;
  if (perm === 'default' && ask) perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  // בלי service worker רשום (פיתוח מקומי, גרסת claude.ai) אין Push
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) return false;
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await api.get<{ publicKey: string }>('/api/push/key');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  await api.post('/api/push/subscribe', { ...sub.toJSON(), label: deviceLabel() });
  return true;
}

/** מספר על אייקון האפליקציה בשורת המשימות (Windows / Mac / טלפון) */
export function setBadge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (!nav.setAppBadge) return;
  void (n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge?.())?.catch(() => undefined);
}
