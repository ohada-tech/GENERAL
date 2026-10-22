import { useCallback, useEffect, useState } from 'react';

/** auto = לפי השעה: כהה מ-20:00 עד 07:00, בהיר ביום (ברירת המחדל, לבקשת אוהד) */
export type ThemePref = 'auto' | 'system' | 'light' | 'dark';
// מפתח חדש: מי שבחר פעם "בהירה" מתחיל עכשיו באוטומטי לפי השעה
const KEY = 'apos-theme-v2';
export const DARK_FROM = 20;
export const LIGHT_FROM = 7;

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export const darkByHour = (d = new Date()) => d.getHours() >= DARK_FROM || d.getHours() < LIGHT_FROM;

function resolved(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'auto') return darkByHour() ? 'dark' : 'light';
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', resolved(pref));
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', resolved(pref) === 'light' ? '#f6f5f9' : '#0a0a0b');
}

/** ערכת צבעים: אוטומטי לפי השעה (ברירת מחדל) / מערכת / בהירה / כהה. נשמר בדפדפן. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(read);
  const [, force] = useState(0);

  useEffect(() => {
    apply(pref);
    try {
      if (pref === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {
      /* מצב פרטי — פשוט לא נשמר */
    }
  }, [pref]);

  // אוטומטי: בודק כל דקה, כדי להחשיך ב-20:00 ולהאיר ב-07:00 גם כשהמערכת פתוחה כל הזמן
  useEffect(() => {
    if (pref !== 'auto') return;
    const t = setInterval(() => {
      apply('auto');
      force((n) => n + 1);
    }, 60_000);
    return () => clearInterval(t);
  }, [pref]);

  // במצב "מערכת" — מגיב לשינוי העדפת מערכת ההפעלה בזמן אמת
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq || pref !== 'system') return;
    const on = () => {
      apply(pref);
      force((n) => n + 1);
    };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [pref]);

  const cycle = useCallback(
    () => setPref((p) => (p === 'auto' ? 'light' : p === 'light' ? 'dark' : p === 'dark' ? 'system' : 'auto')),
    [],
  );
  return { pref, resolved: resolved(pref), setPref, cycle };
}
