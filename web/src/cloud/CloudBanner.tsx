import { useEffect, useState } from 'react';
import type { CloudStore, SaveState } from './persist';

/** מצב השמירה בענן — כדי שיהיה ברור מתי הנתונים באמת נשמרו. */
export function CloudBanner({ store, reason }: { store: CloudStore | null; reason: string | null }) {
  const [s, setS] = useState<SaveState | null>(store?.state ?? null);
  useEffect(() => {
    if (!store) return;
    const off = store.onChange(setS);
    return () => {
      off();
    };
  }, [store]);

  if (!store) {
    return <div className="cloud-banner warn">{reason ?? 'הנתונים לא נשמרים בתצוגה הזו'} — מה שתעשה כאן יימחק ברענון.</div>;
  }
  if (!s) return null;
  if (s.kind === 'conflict') {
    return (
      <div className="cloud-banner danger">
        המערכת נפתחה ושמרה מחלון אחר. השמירה כאן נעצרה כדי לא לדרוס —{' '}
        <button className="btn-link" onClick={() => location.reload()}>
          רענן לטעינת הגרסה העדכנית
        </button>
      </div>
    );
  }
  if (s.kind === 'error') return <div className="cloud-banner danger">השמירה בענן נכשלה: {s.message}</div>;
  return (
    <div className="cloud-save small muted" aria-live="polite">
      {s.kind === 'saving' ? 'שומר…' : s.kind === 'dirty' ? 'שינויים ממתינים לשמירה…' : '☁ נשמר בענן'}
    </div>
  );
}
