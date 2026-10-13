import { useMemo, useState } from 'react';
import { ConfirmButton, Empty, ErrorBox, InlineError, Loading, Tag } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import { fmtRelative } from '../lib/format';

type Lesson = { id: string; scope: string; area: string; text: string; source: 'learned' | 'manual'; active: boolean; updatedAt: string };
type Feedback = { id: string; client: string; area: string; kind: string; text: string; distilled: boolean; createdAt: string };
type LessonsData = { lessons: Lesson[]; feedback: Feedback[]; pending: number; distillEvery: number; clients: string[] };

const AREA_HE: Record<string, string> = {
  script: 'תסריט',
  storyboard: 'סטורי בורד',
  image: 'תמונות',
  motion: 'אנימציה',
  audio: 'אודיו',
  editing: 'עריכה',
  general: 'כללי',
};
const scopeHe = (s: string) => (s === 'global' ? 'הטעם שלך (כל הפרויקטים)' : `לקוח: ${s.replace(/^client:/, '')}`);

/** מה המערכת למדה מההערות שלך ושל הלקוחות — הכללים האלה נכנסים לכל תסריט, סטורי בורד ופרומפט חדשים */
export function LessonsPage() {
  const { data, error, loading, reload } = useApi<LessonsData>('/api/lessons', { pollMs: 8000 });
  const act = useAction();
  const [text, setText] = useState('');
  const [area, setArea] = useState('general');
  const [scope, setScope] = useState('global');
  const [showFeedback, setShowFeedback] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<string, Lesson[]>();
    for (const l of data?.lessons ?? []) m.set(l.scope, [...(m.get(l.scope) ?? []), l]);
    return [...m.entries()].sort(([a], [b]) => (a === 'global' ? -1 : b === 'global' ? 1 : a.localeCompare(b)));
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const d = data!;

  const run = async (fn: () => Promise<unknown>) => {
    if (await act.run(fn)) await reload();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>מה המערכת למדה</h1>
          <p className="muted">
            כל הערה, בקשת תיקון ואישור עם הערה נשמרים. כל {d.distillEvery} הערות Claude מזקק אותם לכללים קצרים, והכללים נכנסים לכל תסריט,
            סטורי בורד ופרומפט חדשים. אפשר לכבות, לערוך או להוסיף כללים בעצמך.
          </p>
        </div>
        <div className="row gap-s">
          {d.pending > 0 && <Tag tone="warn">{d.pending} הערות חדשות ממתינות ללמידה</Tag>}
          <button className="btn btn-primary" disabled={act.busy || d.pending === 0} onClick={() => run(() => api.post('/api/lessons/distill'))}>
            {act.busy ? 'לומד…' : 'למד עכשיו'}
          </button>
        </div>
      </div>
      <InlineError error={act.error} onClose={act.clearError} />

      <section className="card stack">
        <h2>הוסף כלל משלך</h2>
        <div className="row gap-s">
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="global">כל הפרויקטים</option>
            {d.clients.map((c) => (
              <option key={c} value={`client:${c}`}>
                לקוח: {c}
              </option>
            ))}
          </select>
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            {Object.entries(AREA_HE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input className="grow" placeholder='למשל: "בלי טקסט על המסך בשנייה הראשונה"' value={text} onChange={(e) => setText(e.target.value)} />
          <button
            className="btn"
            disabled={act.busy || !text.trim()}
            onClick={() =>
              run(async () => {
                await api.post('/api/lessons', { scope, area, text });
                setText('');
                return true;
              })
            }
          >
            הוסף
          </button>
        </div>
      </section>

      {groups.length === 0 ? (
        <Empty title="עדיין אין כללים">
          <div className="muted">ברגע שתיתן הערות על תסריטים, שוטים ותמונות — המערכת תתחיל ללמוד מהן.</div>
        </Empty>
      ) : (
        groups.map(([sc, list]) => (
          <section key={sc} className="card stack">
            <h2>{scopeHe(sc)}</h2>
            <ul className="action-list">
              {list.map((l) => (
                <LessonRow key={l.id} lesson={l} busy={act.busy} run={run} />
              ))}
            </ul>
          </section>
        ))
      )}

      <section className="card stack">
        <div className="row">
          <h2 className="grow">ההערות שהמערכת למדה מהן</h2>
          <button className="btn-link small" onClick={() => setShowFeedback((x) => !x)}>
            {showFeedback ? 'הסתר' : `הצג (${d.feedback.length})`}
          </button>
        </div>
        {showFeedback && (
          <ul className="action-list">
            {d.feedback.map((f) => (
              <li key={f.id} className="row gap-s">
                <Tag tone={f.distilled ? 'ok' : 'warn'}>{f.distilled ? 'נלמד' : 'ממתין'}</Tag>
                <span className="muted small">{AREA_HE[f.area] ?? f.area}</span>
                <span className="grow">{f.text}</span>
                <span className="muted small">
                  {f.client || '—'} · {fmtRelative(f.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LessonRow({ lesson: l, busy, run }: { lesson: Lesson; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(l.text);
  return (
    <li className="row gap-s" style={{ opacity: l.active ? 1 : 0.5 }}>
      <Tag tone={l.source === 'manual' ? 'manual' : 'auto'}>{l.source === 'manual' ? 'שלך' : 'נלמד'}</Tag>
      <span className="muted small">{AREA_HE[l.area] ?? l.area}</span>
      {editing ? (
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      ) : (
        <span className="grow">{l.text}</span>
      )}
      {editing ? (
        <>
          <button
            className="btn btn-sm"
            disabled={busy || !text.trim()}
            onClick={() => run(async () => (await api.patch(`/api/lessons/${l.id}`, { text }), setEditing(false), true))}
          >
            שמור
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => (setText(l.text), setEditing(false))}>
            ביטול
          </button>
        </>
      ) : (
        <>
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>
            ערוך
          </button>
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => api.patch(`/api/lessons/${l.id}`, { active: !l.active }))}>
            {l.active ? 'כבה' : 'הפעל'}
          </button>
          <ConfirmButton onConfirm={() => run(() => api.del(`/api/lessons/${l.id}`))}>מחק</ConfirmButton>
        </>
      )}
    </li>
  );
}
