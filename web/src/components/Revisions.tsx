/**
 * סבבי תיקונים אחרי מסירה ללקוח: פתיחת סבב מהערות הלקוח (שורה לכל הערה), סימון הערות שטופלו,
 * ומסירה של הגרסה המתוקנת שסוגרת את הסבב. מעבר לסבבים הכלולים במחיר — מסומן.
 */
import type { Project } from '@apos/shared';
import { useState } from 'react';
import { api, useAction } from '../lib/api';
import { fmtDate } from '../lib/format';
import { Icon } from './Icon';
import { InlineError, Tag } from './ui';

export interface RevisionRound {
  id: string;
  number: number;
  items: Array<{ text: string; done: boolean }>;
  source: string;
  openedAt: string;
  closedAt: string | null;
  closeNote: string;
}

export function RevisionsCard({ project, rounds, onChanged }: { project: Project; rounds: RevisionRound[]; onChanged: () => Promise<void> | void }) {
  const act = useAction();
  const [notes, setNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const open = rounds.find((r) => !r.closedAt) ?? null;
  const included = project.settings.includedRevisionRounds;
  const nextNo = rounds.length + 1;
  // אפשר לפתוח סבב רק על פרויקט שנמסר (או שכבר היו לו סבבים)
  const canOpen = !open && (!!project.deliveredAt || rounds.length > 0);
  if (!rounds.length && !project.deliveredAt) return null;

  const run = async (fn: () => Promise<unknown>) => {
    const r = await act.run(fn);
    if (r !== undefined) {
      setNotes('');
      setAdding(false);
      await onChanged();
    }
  };

  return (
    <section className="card stack revisions">
      <div className="row between wrap gap-s">
        <h2>
          <Icon n="note" /> סבבי תיקונים
        </h2>
        <Tag tone={rounds.length > included ? 'warn' : 'neutral'}>
          {rounds.length} מתוך {included} כלולים{rounds.length > included ? ` · ${rounds.length - included} מעבר` : ''}
        </Tag>
      </div>

      {open && (
        <div className="stack">
          <div className="row between wrap gap-s">
            <strong>
              סבב {open.number} · נפתח {fmtDate(open.openedAt)}
              {open.number > included && <span className="warn-text"> · מעבר לכלולים</span>}
            </strong>
            <span className="muted small">
              {open.items.filter((i) => i.done).length}/{open.items.length} טופלו
            </span>
          </div>
          <ul className="rev-items">
            {open.items.map((it, i) => (
              <li key={i}>
                <label className="row gap-s">
                  <input
                    type="checkbox"
                    checked={it.done}
                    disabled={act.busy}
                    onChange={(e) => run(() => api.post(`/api/revisions/${open.id}/items/${i}`, { done: e.target.checked }))}
                  />
                  <span className={it.done ? 'muted' : ''} style={it.done ? { textDecoration: 'line-through' } : undefined}>
                    {it.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {adding ? (
            <div className="stack">
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הערה נוספת — שורה לכל הערה" />
              <div className="row gap-s">
                <button className="btn btn-sm" disabled={act.busy || !notes.trim()} onClick={() => run(() => api.post(`/api/revisions/${open.id}/items`, { notes }))}>
                  הוסף
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setAdding(false)}>
                  ביטול
                </button>
              </div>
            </div>
          ) : (
            <div className="row gap-s wrap">
              <button className="btn btn-sm btn-ghost" onClick={() => setAdding(true)}>
                + הערה
              </button>
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy}
                onClick={() => {
                  const left = open.items.filter((i) => !i.done).length;
                  if (left && !window.confirm(`${left} הערות עוד לא סומנו. למסור את הגרסה המתוקנת בכל זאת?`)) return;
                  const note = window.prompt('מה נמסר? (לא חובה, למשל "v3 נשלח")', '') ?? '';
                  void run(() => api.post(`/api/revisions/${open.id}/close`, { note }));
                }}
              >
                <Icon n="checkCircle" /> נמסר — סגור סבב {open.number}
              </button>
            </div>
          )}
        </div>
      )}

      {canOpen && (
        <div className="stack">
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={`הערות הלקוח לסבב ${nextNo} — שורה לכל הערה`}
          />
          <div className="row gap-s wrap">
            <button className="btn btn-sm btn-primary" disabled={act.busy || !notes.trim()} onClick={() => run(() => api.post(`/api/projects/${project.id}/revisions`, { notes }))}>
              🔁 פתח סבב תיקונים {nextNo}
            </button>
            {nextNo > included && <span className="small warn-text">מעבר ל-{included} הסבבים הכלולים במחיר</span>}
          </div>
        </div>
      )}

      {rounds.filter((r) => r.closedAt).length > 0 && (
        <details>
          <summary className="small muted">סבבים שנמסרו ({rounds.filter((r) => r.closedAt).length})</summary>
          <ul className="small">
            {rounds
              .filter((r) => r.closedAt)
              .map((r) => (
                <li key={r.id}>
                  סבב {r.number}: {r.items.length} הערות · נמסר {fmtDate(r.closedAt!)}
                  {r.closeNote ? ` · ${r.closeNote}` : ''}
                </li>
              ))}
          </ul>
        </details>
      )}
      <InlineError error={act.error} onClose={act.clearError} />
    </section>
  );
}
