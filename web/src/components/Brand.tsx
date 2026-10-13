import { useId } from 'react';

/**
 * סימן המותג — טבעת, משולש "Play" ו-"i" (AI), בגרדיאנט holo.
 * הועתק מהגדרת ה-symbol#mark באתר הסטודיו. useId מבטיח מזהה גרדיאנט ייחודי לכל מופע.
 */
export function BrandMark({ size = 34, className = 'brand-mark' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const g = `holo-${id}`;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={g} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" style={{ stopColor: 'var(--mark-a, #7EE6E6)' }} />
          <stop offset="45%" style={{ stopColor: 'var(--mark-b, #A9BEF7)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--mark-c, #C8A6FF)' }} />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="47" fill="none" stroke={`url(#${g})`} strokeWidth="1.6" opacity=".55" />
      <circle cx="50" cy="50" r="26" fill="none" stroke={`url(#${g})`} strokeWidth="7" />
      <path d="M44 41 L63 50 L44 59 Z" fill={`url(#${g})`} />
      <path d="M76 33 v34" stroke={`url(#${g})`} strokeWidth="7" strokeLinecap="round" />
      <circle cx="76" cy="22" r="3.8" fill={`url(#${g})`} />
    </svg>
  );
}

/** לוקאפ מלא: סימן + "Ohad Alfi" בכתב יד + שורת תיאור. */
export function BrandLockup() {
  return (
    <>
      <BrandMark />
      <span className="brand-words">
        <b className="brand-script holo">Ohad Alfi</b>
        <span className="brand-line">AI Production AP</span>
      </span>
    </>
  );
}
