import { useMemo, useState } from 'react';
import { ConfirmButton, Empty, ErrorBox, InlineError, Loading, Tag } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import { fmtRelative } from '../lib/format';

type Lesson = { id: string; scope: string; area: string; text: string; source: 'learned' | 'manual'; active: boolean; updatedAt: string };
type Feedback = { id: string; client: string; area: string; kind: string; text: string; distilled: boolean; createdAt: string };
type FirstPass = { area: string; total: number; firstPass: number; byMonth: Array<{ month: string; total: number; firstPass: number }> };
type LessonsData = { lessons: Lesson[]; feedback: Feedback[]; pending: number; distillEvery: number; clients: string[]; firstPass: FirstPass[] };
type Skill = {
  id: string;
  name: string;
  description: string;
  digest: string;
  areas: string[];
  clients: string;
  priority: number;
  active: boolean;
  source: string;
  digestStatus: 'pending' | 'running' | 'done' | 'failed';
  digestError: string | null;
  bodyChars: number;
};

const AREA_HE: Record<string, string> = {
  script: 'תסריט',
  storyboard: 'סטורי בורד',
  image: 'תמונות',
  motion: 'אנימציה',
  audio: 'אודיו',
  editing: 'עריכה',
  general: 'כללי',
  operations: 'נהלי עבודה',
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
          <h1>המוח של המערכת</h1>
          <p className="muted">
            שני מקורות ידע נכנסים לכל תסריט וסטורי בורד: <b>ספר הידע</b> — הסקילים שלימדת את Claude, ו<b>הכללים שנלמדו</b> מההערות שלך. כל הערה שלך הופכת מיד לכלל — כדי שלא תצטרך לומר אותה פעמיים. המדד למטה מראה אם
            המערכת קולעת יותר עם הזמן.
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

      <FirstPassCard stats={d.firstPass} />
      <KnowledgeSection />

      <h2>כללים שנלמדו מההערות</h2>
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

/** כמה תוצרים אושרו כבר בפעם הראשונה — לפי תחום, והמגמה בין החודש הקודם לנוכחי */
function FirstPassCard({ stats }: { stats: FirstPass[] }) {
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  const any = stats.some((s) => s.total > 0);
  return (
    <section className="card stack">
      <h2>קליעה מהפעם הראשונה</h2>
      {!any ? (
        <div className="muted">עוד אין מספיק אישורים. אחרי שתאשר תסריטים, שוטים ותמונות יופיע כאן כמה מהם עברו בלי תיקון.</div>
      ) : (
        <div className="kpis">
          {stats
            .filter((s) => s.total > 0)
            .map((s) => {
              const m = s.byMonth;
              const now = m.at(-1);
              const prev = m.at(-2);
              const trend = now && prev ? (pct(now.firstPass, now.total) ?? 0) - (pct(prev.firstPass, prev.total) ?? 0) : null;
              return (
                <div key={s.area} className="kpi">
                  <div className="kpi-value">{pct(s.firstPass, s.total)}%</div>
                  <div className="kpi-label">
                    {AREA_HE[s.area]} · {s.firstPass}/{s.total}
                    {trend !== null && (
                      <span className={trend >= 0 ? '' : 'danger-text'}>
                        {' '}
                        · {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% מהחודש הקודם
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </section>
  );
}

const DIGEST_HE: Record<Skill['digestStatus'], { label: string; tone: string }> = {
  pending: { label: 'ממתין לעיבוד', tone: 'warn' },
  running: { label: 'Claude מעבד…', tone: 'info' },
  done: { label: 'מוכן', tone: 'ok' },
  failed: { label: 'העיבוד נכשל', tone: 'danger' },
};

/** ספר הידע: הסקילים שלימדת את Claude, מזוקקים להנחיות הפקה */
function KnowledgeSection() {
  const { data, reload } = useApi<{ skills: Skill[] }>('/api/skills', { pollMs: 6000 });
  const act = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    if (await act.run(fn)) await reload();
  };
  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    await run(async () => {
      for (const f of files) await api.post('/api/skills', { md: await f.text(), name: f.name.replace(/\.md$/i, '') });
      return true;
    });
  };
  const skills = data?.skills ?? [];
  return (
    <section className="card stack">
      <div className="row gap-s">
        <div className="grow">
          <h2>ספר הידע — הסקילים שלימדת את Claude</h2>
          <div className="muted small">
            Claude מזקק כל סקיל להנחיות הפקה (בלי הוראות הפעלה של כלים) ומסמן לאיזה תחום ולקוח הוא שייך. סקיל של לקוח נכנס רק לפרויקטים שלו.
          </div>
        </div>
        <label className="btn" title="העלה קובצי SKILL.md">
          ⬆ הוסף סקיל
          <input type="file" accept=".md,text/markdown,text/plain" multiple hidden onChange={onFiles} disabled={act.busy} />
        </label>
      </div>
      <InlineError error={act.error} onClose={act.clearError} />
      {skills.length === 0 ? (
        <div className="muted">עוד אין סקילים.</div>
      ) : (
        <ul className="action-list">
          {skills.map((s) => (
            <li key={s.id} className="stack" style={{ opacity: s.active ? 1 : 0.5 }}>
              <div className="row gap-s">
                <b>{s.name}</b>
                <Tag tone={DIGEST_HE[s.digestStatus].tone}>{DIGEST_HE[s.digestStatus].label}</Tag>
                {s.clients && <Tag tone="info">לקוח: {s.clients}</Tag>}
                <span className="muted small grow">{s.areas.map((a) => AREA_HE[a] ?? a).join(' · ')}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  {open === s.id ? 'סגור' : 'הצג'}
                </button>
                <button className="btn btn-sm btn-ghost" disabled={act.busy} onClick={() => run(() => api.patch(`/api/skills/${s.id}`, { active: !s.active }))}>
                  {s.active ? 'כבה' : 'הפעל'}
                </button>
                <ConfirmButton onConfirm={() => run(() => api.del(`/api/skills/${s.id}`))}>מחק</ConfirmButton>
              </div>
              {s.digestError && <div className="small danger-text">{s.digestError}</div>}
              {open === s.id && <SkillDigest skill={s} run={run} busy={act.busy} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SkillDigest({ skill, run, busy }: { skill: Skill; run: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const [text, setText] = useState(skill.digest);
  const [clients, setClients] = useState(skill.clients);
  return (
    <div className="stack">
      <div className="muted small">{skill.description}</div>
      <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="ההנחיות המזוקקות יופיעו כאן" />
      <div className="row gap-s">
        <input className="grow" value={clients} onChange={(e) => setClients(e.target.value)} placeholder="שייך ללקוח (ריק = לכל הלקוחות)" />
        <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api.patch(`/api/skills/${skill.id}`, { digest: text, clients }))}>
          שמור
        </button>
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => api.post(`/api/skills/${skill.id}/redigest`))}>
          עבד מחדש עם Claude
        </button>
      </div>
    </div>
  );
}
