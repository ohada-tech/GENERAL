import { useTheme, type ThemePref } from '../lib/theme';

const LABEL: Record<ThemePref, string> = { system: 'לפי המערכת', light: 'בהירה', dark: 'כהה' };

function Icon({ pref }: { pref: ThemePref }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (pref === 'light')
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
      </svg>
    );
  if (pref === 'dark')
    return (
      <svg {...p}>
        <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
      </svg>
    );
  return (
    <svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 000-17z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** מחליף ערכת צבעים: מערכת → בהירה → כהה */
export function ThemeToggle() {
  const { pref, cycle } = useTheme();
  return (
    <button className="btn btn-ghost icon-btn" onClick={cycle} title={`ערכת צבעים: ${LABEL[pref]} (לחץ להחלפה)`} aria-label={`ערכת צבעים: ${LABEL[pref]}`}>
      <Icon pref={pref} />
    </button>
  );
}
