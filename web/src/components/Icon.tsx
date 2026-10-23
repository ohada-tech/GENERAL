/**
 * סט האייקונים של המערכת — במקום אימוג'ים של מערכת ההפעלה, כדי שהכול ייראה באותה שפה.
 * קו נקי ומעוגל (1.8) ב-currentColor, ואייקונים "מרכזיים" (holo) בגרדיאנט ההולוגרפי של המותג.
 * הגרדיאנט מוגדר פעם אחת ב-<IconDefs /> (App).
 */
import type { CSSProperties, ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  sparkle: (
    <>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
      <path d="M19 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  download: <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />,
  upload: <path d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M5 19.5h14" />,
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7" />
      <path d="M12 9.5v4l2.5 1.5M9.5 3h5M12 3v3.5M18.5 6.5l1.5-1.5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12.3l2.8 2.8 5.2-5.6" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" />,
  pause: <path d="M9 6v12M15 6v12" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  hourglass: <path d="M7 3.5h10M7 20.5h10M8 3.5c0 4.5 4 5.5 4 8.5s-4 4-4 8.5M16 3.5c0 4.5-4 5.5-4 8.5s4 4 4 8.5" />,
  clip: <path d="M20 11.5l-7.8 7.8a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  brain: (
    <>
      <path d="M9.5 4.5a3 3 0 00-3 3 3 3 0 00-2 5.2 3.2 3.2 0 002.5 5.3 2.8 2.8 0 005.5.5V6.5a2.5 2.5 0 00-3-2z" />
      <path d="M14.5 4.5a3 3 0 013 3 3 3 0 012 5.2 3.2 3.2 0 01-2.5 5.3 2.8 2.8 0 01-5.5.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 15.5H3z" />
      <path d="M12 10v4M12 17v.01" />
    </>
  ),
  clapper: (
    <>
      <rect x="3.5" y="9" width="17" height="11" rx="2" />
      <path d="M3.5 9l1-4 16 1.5-.5 2.5M8.5 5.5l1.5 3.5M13.5 6l1.5 3" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  star: <path d="M12 3.8l2.5 5.2 5.6.7-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.7z" />,
  inbox: (
    <>
      <path d="M4 13.5l2.5-8h11l2.5 8v5H4z" />
      <path d="M4 13.5h4.5l1 2h5l1-2H20" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 014.8.8c0 1.7-2.4 2-2.4 3.7M12 16.8v.01" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 5.5v-.5a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 5v8A1.5 1.5 0 006 14.5h.5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M6 11.5a6 6 0 0012 0M12 17.5v3" />
    </>
  ),
  chat: <path d="M4.5 6.5A2 2 0 016.5 4.5h11a2 2 0 012 2v8a2 2 0 01-2 2H11l-4.5 3.5v-3.5h0a2 2 0 01-2-2z" />,
  external: <path d="M13.5 4.5h6v6M19.5 4.5L11 13M17.5 14v4a1.5 1.5 0 01-1.5 1.5H6A1.5 1.5 0 014.5 18V8A1.5 1.5 0 016 6.5h4" />,
  block: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 18L18 6" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 004 0" />
    </>
  ),
  send: <path d="M20.5 3.5L10 14M20.5 3.5l-6.5 17-4-6.5-6.5-4z" />,
  note: (
    <>
      <path d="M14 3.5H7A1.5 1.5 0 005.5 5v14A1.5 1.5 0 007 20.5h10a1.5 1.5 0 001.5-1.5V8z" />
      <path d="M14 3.5V8h4.5M9 12.5h6M9 16h4" />
    </>
  ),
  trash: <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10 10.5v6M14 10.5v6" />,
  cloud: <path d="M7 18.5a4 4 0 01-.5-8 5.5 5.5 0 0110.6-1.3A4.5 4.5 0 0117.5 18.5z" />,
  phone: <path d="M5 4.5h3.5l1.5 4-2 1.5a10 10 0 005 5l1.5-2 4 1.5V18a1.5 1.5 0 01-1.5 1.5A14.5 14.5 0 013.5 6 1.5 1.5 0 015 4.5z" />,
  save: (
    <>
      <path d="M5 4.5h11l3 3V18a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 18z" />
      <path d="M8 4.5v4h7v-4M8 19.5v-5.5h8v5.5" />
    </>
  ),
  file: (
    <>
      <path d="M14 3.5H7A1.5 1.5 0 005.5 5v14A1.5 1.5 0 007 20.5h10a1.5 1.5 0 001.5-1.5V8z" />
      <path d="M14 3.5V8h4.5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  scale: <path d="M12 4v16M8 20h8M5 7.5h14M5 7.5l-2.5 6a2.8 2.8 0 005 0zM19 7.5l-2.5 6a2.8 2.8 0 005 0z" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.01" />
    </>
  ),
  alarm: (
    <>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 9.5V13l2.5 1.5M4.5 5.5l3-2.5M19.5 5.5l-3-2.5" />
    </>
  ),
  type: <path d="M5 7V5h14v2M12 5v14M9 19h6" />,
  pen: <path d="M14.5 5.5l4 4L8 20H4v-4zM12.5 7.5l4 4" />,
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.7" />
      <path d="M20.5 16l-5-5-8.5 8" />
    </>
  ),
  link: <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
};

export type IconName = keyof typeof P;

/** אייקון: n = שם, holo = בגרדיאנט המותג, size בפיקסלים (ברירת מחדל: גובה השורה) */
export function Icon({ n, holo, size, className, style, title }: { n: IconName | string; holo?: boolean; size?: number; className?: string; style?: CSSProperties; title?: string }) {
  const body = P[n];
  if (!body) return null;
  return (
    <svg
      className={`ic${holo ? ' ic-holo' : ''}${className ? ` ${className}` : ''}`}
      width={size ?? '1.15em'}
      height={size ?? '1.15em'}
      viewBox="0 0 24 24"
      fill="none"
      stroke={holo ? 'url(#ap-holo)' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {body}
    </svg>
  );
}

/** הגדרת הגרדיאנט ההולוגרפי (פעם אחת בדף) */
export function IconDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <linearGradient id="ap-holo" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          {/* הגוונים מ-CSS: בהירים בערכה הכהה, עמוקים יותר בערכה הבהירה (ניגודיות) */}
          <stop offset="0" style={{ stopColor: 'var(--ic-h1, #7ee6e6)' }} />
          <stop offset="0.45" style={{ stopColor: 'var(--ic-h2, #a9bef7)' }} />
          <stop offset="1" style={{ stopColor: 'var(--ic-h3, #c8a6ff)' }} />
        </linearGradient>
      </defs>
    </svg>
  );
}
