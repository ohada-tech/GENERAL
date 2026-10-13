import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'apos-theme';

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function resolved(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', resolved(pref) === 'light' ? '#f6f5f9' : '#0a0a0b');
}

/** ערכת צבעים: מערכת (ברירת מחדל) / בהירה / כהה. נשמר בדפדפן. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(read);
  const [, force] = useState(0);

  useEffect(() => {
    apply(pref);
    try {
      if (pref === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {
      /* מצב פרטי — פשוט לא נשמר */
    }
  }, [pref]);

  // במצב "מערכת" — מגיב לשינוי העדפת מערכת ההפעלה בזמן אמת
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq) return;
    const on = () => {
      apply(pref);
      force((n) => n + 1);
    };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [pref]);

  const cycle = useCallback(() => setPref((p) => (p === 'system' ? 'light' : p === 'light' ? 'dark' : 'system')), []);
  return { pref, resolved: resolved(pref), setPref, cycle };
}
