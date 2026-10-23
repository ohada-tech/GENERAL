/**
 * הערות לקוח: Google Doc / Word / טקסט ← רשימת הערות לבדיקה (מה נכלל, לאיזו סצנה) ← תיקון אחד של התסריט.
 * על הגרסה שנוצרה מוצגת טבלה: כל הערה ← מה השתנה בסצנה שלה.
 */
import type { ScriptContent, ScriptVersion } from '@apos/shared';
import { useEffect, useRef, useState } from 'react';
import { api, useAction } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { InlineError, Tag } from './ui';
import { Icon } from './Icon';

type Kind = 'comment' | 'suggestion' | 'edit' | 'note';

export interface FeedbackItem {
  id: string;
  kind: Kind;
  author: string;
  quote: string;
  text: string;
  scenes: number[];
  include: boolean;
  field?: 'narration' | 'onScreenText' | 'visualAction';
  value?: string;
  /** ההחלטה של אוהד על ההערה, נכנסת לתיקון */
  myNote?: string;
}

type Verdict = 'agree' | 'partly' | 'disagree' | 'question';

export interface FeedbackReview {
  status: 'running' | 'done' | 'failed';
  at: string;
  error?: string;
  model?: string;
  timing?: { targetSec: number | null; beforeSec: number; afterSec: number };
  summary?: string;
  items?: Array<{ itemId: string; verdict: Verdict; understanding: string; reasoning: string; suggestion: string }>;
  conflicts?: string[];
  questionsForClient?: string[];
  recommendation?: string;
}

export interface FeedbackImport {
  id: string;
  baseVersionId: string;
  resultVersionId: string | null;
  source: 'gdoc' | 'docx' | 'text' | 'call';
  sourceName: string;
  detectedLabel: string | null;
  items: FeedbackItem[];
  status: 'draft' | 'applied';
  review: FeedbackReview | null;
  callId: string | null;
  createdAt: string;
}

const KIND: Record<Kind, string> = { comment: 'הערה במסמך', suggestion: 'הצעת שינוי', edit: 'עריכה ישירה', note: 'הערה' };
const SOURCE: Record<FeedbackImport['source'], string> = { gdoc: 'Google Doc', docx: 'Word', text: 'טקסט', call: 'שיחה' };
const VERDICT: Record<Verdict, [string, string]> = {
  agree: ['מסכים', 'ok'],
  partly: ['חלקית', 'warn'],
  disagree: ['לא מסכים', 'danger'],
  question: ['שאלה ללקוח', 'info'],
};

/** ייבוא ובדיקה של הערות לקוח — נפתח מהכפתור בראש לשונית התסריט */
export function ClientFeedbackImport({
  projectId,
  versions,
  running,
  draft,
  onClose,
  onDone,
}: {
  projectId: string;
  versions: ScriptVersion[];
  running: boolean;
  /** ייבוא שעוד לא הוחל (ממשיכים ממנו) */
  draft: FeedbackImport | null;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const act = useAction();
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [imp, setImp] = useState<FeedbackImport | null>(draft);
  const [items, setItems] = useState<FeedbackItem[]>(draft?.items ?? []);
  const [baseId, setBaseId] = useState(draft?.baseVersionId ?? versions[0]?.id ?? '');
  const file = useRef<HTMLInputElement>(null);

  const loaded = (r: FeedbackImport | undefined) => {
    if (!r) return;
    setImp(r);
    setItems(r.items);
    setBaseId(r.baseVersionId);
  };
  const importFrom = (body: { url?: string; text?: string }) => act.run(() => api.post<FeedbackImport>(`/api/projects/${projectId}/feedback/import`, body)).then(loaded);
  const upload = (f: File) => act.run(() => api.upload<FeedbackImport>(`/api/projects/${projectId}/feedback/import`, f)).then(loaded);
  // שיחה: תמלול ואז שליפת ההערות, שני שלבים כדי שהתמלול יישמר גם אם השליפה נכשלת
  const audio = useRef<HTMLInputElement>(null);
  const [callStep, setCallStep] = useState('');
  const fromCall = (f: File) =>
    act
      .run(async () => {
        setCallStep('מתמלל את השיחה (כדקה לכל 10 דקות הקלטה)…');
        const call = await api.upload<{ id: string }>(`/api/projects/${projectId}/calls`, f);
        setCallStep('ChatGPT שולף מה הלקוח ביקש והחליט…');
        return api.post<FeedbackImport>(`/api/calls/${call.id}/feedback`);
      })
      .then(loaded)
      .finally(() => setCallStep(''));

  const base = versions.find((v) => v.id === baseId);
  const chosen = items.filter((it) => it.include && it.text.trim());
  const patch = (id: string, p: Partial<FeedbackItem>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const apply = async () => {
    if (!imp) return;
    const r = await act.run(() => api.post(`/api/feedback/${imp.id}/apply`, { items, baseVersionId: baseId }));
    if (r) {
      await onDone();
      onClose();
    }
  };

  const save = () => imp && act.run(() => api.put<FeedbackImport>(`/api/feedback/${imp.id}`, { items, baseVersionId: baseId })).then((r) => r && setImp(r));
  const askChatGPT = async () => {
    if (!imp) return;
    const r = await act.run(() => api.post(`/api/feedback/${imp.id}/review`, { items, baseVersionId: baseId }));
    if (r) setImp({ ...imp, review: { status: 'running', at: new Date().toISOString() } });
  };

  // הדעה של ChatGPT רצה ברקע: בודקים כל 3 שניות, ומעדכנים רק אותה (לא את מה שאוהד כותב)
  const reviewRunning = imp?.review?.status === 'running';
  useEffect(() => {
    if (!reviewRunning || !imp) return;
    const t = setInterval(async () => {
      const r = await api.get<{ imports: FeedbackImport[] }>(`/api/projects/${projectId}/feedback`).catch(() => null);
      const now = r?.imports.find((x) => x.id === imp.id);
      if (now?.review && now.review.status !== 'running') setImp((cur) => (cur ? { ...cur, review: now.review } : cur));
    }, 3000);
    return () => clearInterval(t);
  }, [reviewRunning, imp?.id, projectId]);

  const review = imp?.review?.status === 'done' ? imp.review : null;
  const opinion = (id: string) => review?.items?.find((x) => x.itemId === id);
  const copyQuestions = async () => {
    const qs = review?.questionsForClient ?? [];
    await navigator.clipboard.writeText(qs.map((q, i) => `${i + 1}. ${q}`).join('\n'));
  };

  return (
    <section className="card stack">
      <div className="row between">
        <h2><Icon n="inbox" /> הערות לקוח</h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          סגור
        </button>
      </div>

      {!imp ? (
        <>
          <div className="small muted">
            מביאים את ההערות כמו שהן: המערכת מזהה הערות צד, הצעות במצב מעקב, עריכה ישירה בטבלת התסריט וטקסט שנכתב בחלק "הערות ואישור הלקוח".
          </div>
          <div className="row gap-s">
            <input className="grow" dir="ltr" placeholder="https://docs.google.com/document/d/…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn" disabled={act.busy || !url.trim()} onClick={() => importFrom({ url })}>
              ייבא מ-Google Doc
            </button>
          </div>
          <div className="small muted">המסמך צריך להיות משותף "לכל מי שיש לו את הקישור". אם לא — מורידים אותו כ-Word ומעלים כאן.</div>
          <div className="row gap-s">
            <button className="btn btn-ghost" disabled={act.busy} onClick={() => file.current?.click()}>
              העלה קובץ Word
            </button>
            <input
              ref={file}
              type="file"
              accept=".docx"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void upload(f);
              }}
            />
            <button className="btn btn-ghost" disabled={act.busy} onClick={() => audio.current?.click()} title="ElevenLabs מתמלל, ChatGPT שולף מה הלקוח ביקש והחליט">
              <Icon n="phone" /> העלה הקלטת שיחה
            </button>
            <input
              ref={audio}
              type="file"
              accept="audio/*,video/mp4,.m4a,.mp3,.wav,.mp4"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void fromCall(f);
              }}
            />
          </div>
          <textarea rows={4} placeholder="או הדבק כאן את ההערות (מוואטסאפ, מייל…) — כל שורה או תבליט = הערה" value={text} onChange={(e) => setText(e.target.value)} />
          <div>
            <button className="btn btn-ghost" disabled={act.busy || !text.trim()} onClick={() => importFrom({ text })}>
              ייבא טקסט
            </button>
          </div>
          {act.busy && (
            <div className="notice">
              <span className="spinner" /> {callStep || 'קורא את ההערות…'}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="row between wrap gap-s small">
            <span>
              {SOURCE[imp.source]} · <span className="muted">{imp.sourceName}</span>
            </span>
            <label className="row gap-s">
              {imp.detectedLabel ? `המסמך נכתב על v${imp.detectedLabel} · ` : ''}לתקן את:
              <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {imp.callId && <CallTranscript callId={imp.callId} />}
          {reviewRunning && (
            <div className="notice">
              <span className="spinner" /> ChatGPT עובר על ההערות… התסריט לא משתנה.
            </div>
          )}
          {imp.review?.status === 'failed' && <div className="notice warn">הדעה של ChatGPT נכשלה: {imp.review.error}</div>}
          {review && (
            <div className="feedback-review stack">
              <div className="row between wrap gap-s">
                <strong><Icon n="brain" holo /> הדעה של ChatGPT</strong>
                <span className="small muted">
                  {review.model} · {fmtDateTime(review.at)}
                </span>
              </div>
              {review.timing && (
                <div className={`small ${review.timing.targetSec && review.timing.afterSec > review.timing.targetSec ? 'warn-text' : 'muted'}`}>
                  <Icon n="timer" /> קריינות עכשיו ≈ {review.timing.beforeSec} ש׳ · עם העריכות של הלקוח ≈ {review.timing.afterSec} ש׳
                  {review.timing.targetSec ? ` · יעד ${review.timing.targetSec} ש׳` : ''}
                </div>
              )}
              {review.summary && <div>{review.summary}</div>}
              {review.recommendation && (
                <div>
                  <strong>ההמלצה: </strong>
                  {review.recommendation}
                </div>
              )}
              {!!review.conflicts?.length && (
                <div className="stack-xs">
                  <strong className="small"><Icon n="alert" /> סתירות וכפילויות</strong>
                  <ul className="small">
                    {review.conflicts.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!!review.questionsForClient?.length && (
                <div className="stack-xs">
                  <div className="row between wrap gap-s">
                    <strong className="small"><Icon n="question" /> שאלות ללקוח</strong>
                    <button className="btn btn-ghost btn-sm" onClick={copyQuestions} title="מעתיק את השאלות, מוכן להדבקה בוואטסאפ">
                      <Icon n="copy" /> העתק
                    </button>
                  </div>
                  <ol className="small">
                    {review.questionsForClient.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
          <ol className="feedback-list stack">
            {items.map((it) => (
              <li key={it.id} className={`feedback-item ${it.include ? '' : 'off'}`}>
                <div className="row between wrap gap-s">
                  <label className="row gap-s">
                    <input type="checkbox" checked={it.include} onChange={(e) => patch(it.id, { include: e.target.checked })} />
                    <Tag tone={it.kind === 'edit' ? 'warn' : 'neutral'}>{KIND[it.kind]}</Tag>
                    {it.author && <span className="small muted">{it.author}</span>}
                  </label>
                  <select
                    value={it.scenes.length === 1 ? String(it.scenes[0]) : it.scenes.length ? 'multi' : ''}
                    onChange={(e) => patch(it.id, { scenes: e.target.value === '' ? [] : [Number(e.target.value)] })}
                  >
                    <option value="">כללי (כל התסריט)</option>
                    {it.scenes.length > 1 && <option value="multi">סצנות {it.scenes.map((s) => s + 1).join(', ')}</option>}
                    {base?.content.scenes.map((s, i) => (
                      <option key={s.id} value={i}>
                        סצנה {i + 1}
                      </option>
                    ))}
                  </select>
                </div>
                {it.quote && it.kind !== 'edit' && <div className="small muted clamp-2">על: "{it.quote}"</div>}
                <textarea rows={Math.min(6, Math.max(2, Math.ceil(it.text.length / 90)))} value={it.text} onChange={(e) => patch(it.id, { text: e.target.value })} />
                {(() => {
                  const o = opinion(it.id);
                  if (!o) return null;
                  const [label, tone] = VERDICT[o.verdict] ?? ['', 'neutral'];
                  return (
                    <div className="feedback-opinion stack-xs small">
                      <div>
                        <Tag tone={tone}>ChatGPT: {label}</Tag> {o.understanding}
                      </div>
                      <div className="muted">{o.reasoning}</div>
                      {o.suggestion && (
                        <div className="row between gap-s">
                          <span>
                            <strong>הצעה: </strong>
                            {o.suggestion}
                          </span>
                          <button className="btn btn-ghost btn-sm" onClick={() => patch(it.id, { myNote: o.suggestion })} title="מעתיק את ההצעה להחלטה שלך, אפשר לערוך">
                            ↓ לקחת
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <textarea
                  rows={it.myNote ? 2 : 1}
                  className="my-note"
                  placeholder="ההחלטה שלי על ההערה (נכנסת לתיקון, וגוברת על נוסח הלקוח)"
                  value={it.myNote ?? ''}
                  onChange={(e) => patch(it.id, { myNote: e.target.value })}
                />
              </li>
            ))}
          </ol>
          <div className="row gap-s wrap">
            <button className="btn btn-ghost" disabled={act.busy || reviewRunning || !chosen.length} onClick={askChatGPT} title="ChatGPT נותן דעה על כל הערה. התסריט לא משתנה">
              <Icon n="brain" holo /> {review ? 'דעה חדשה מ-ChatGPT' : 'מה ChatGPT חושב?'}
            </button>
            <button className="btn btn-ghost" disabled={act.busy} onClick={save} title="שומר את הבחירות וההחלטות שלך, בלי לשנות את התסריט">
              <Icon n="save" /> שמור
            </button>
          </div>
          <div className="row gap-s wrap">
            <button className="btn" disabled={act.busy || running || !chosen.length || !base} onClick={apply} title="ChatGPT מתקן, Claude בודק — נוצרת גרסה חדשה">
              <Icon n="sparkle" holo /> תקן את v{base?.label} לפי {chosen.length} הערות
            </button>
            <span className="small muted">
              {chosen.length && chosen.every((it) => it.scenes.length)
                ? `רק סצנות ${[...new Set(chosen.flatMap((it) => it.scenes))].sort((a, b) => a - b).map((s) => s + 1).join(', ')} ישתנו`
                : 'יש הערה כללית — כל התסריט פתוח לתיקון'}
            </span>
          </div>
        </>
      )}
      <InlineError error={act.error} onClose={act.clearError} />
    </section>
  );
}

/** התמלול המלא של השיחה, נטען רק כשפותחים */
function CallTranscript({ callId }: { callId: string }) {
  const [text, setText] = useState<string | null>(null);
  const load = async () => {
    if (text !== null) return;
    const c = await api.get<{ transcript: string }>(`/api/calls/${callId}`).catch(() => null);
    setText(c?.transcript ?? 'התמלול לא נמצא');
  };
  return (
    <details className="small" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void load()}>
      <summary><Icon n="file" /> התמלול המלא של השיחה</summary>
      <div className="call-transcript">{text ?? 'טוען…'}</div>
    </details>
  );
}

const FIELDS = [
  ['narration', 'mic'],
  ['onScreenText', 'type'],
  ['visualAction', 'clapper'],
] as const;

function sceneChanges(before: ScriptContent['scenes'][number] | undefined, after: ScriptContent['scenes'][number] | undefined) {
  return FIELDS.filter(([f]) => (before?.[f] ?? '') !== (after?.[f] ?? '')).map(([f, icon]) => ({ icon, before: before?.[f] ?? '', after: after?.[f] ?? '' }));
}

/** על גרסה שנוצרה מהערות לקוח: כל הערה ← מה השתנה */
export function ClientFeedbackChanges({ imp, base, result }: { imp: FeedbackImport; base: ScriptVersion | undefined; result: ScriptVersion }) {
  if (!base) return null;
  const changed = result.content.scenes.flatMap((s, i) => (sceneChanges(base.content.scenes[i], s).length ? [i] : []));
  const rows = imp.items.filter((it) => it.include);
  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>הערות הלקוח ← מה שונה</h2>
        <span className="small muted">
          v{base.label} → v{result.label} · {SOURCE[imp.source]} · {fmtDateTime(imp.createdAt)}
        </span>
      </div>
      <table className="diff-table">
        <thead>
          <tr>
            <th>הערה</th>
            <th>מה שונה</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((it) => {
            const own = it.scenes.length ? it.scenes : changed;
            const diffs = own.map((i) => ({ i, d: sceneChanges(base.content.scenes[i], result.content.scenes[i]) })).filter((x) => x.d.length);
            return (
              <tr key={it.id}>
                <td className="small">
                  <Tag>{it.scenes.length ? `סצנה ${it.scenes.map((s) => s + 1).join(', ')}` : 'כללי'}</Tag> {it.text}
                </td>
                <td className="small">
                  {diffs.length ? (
                    diffs.map(({ i, d }) => (
                      <div key={i} className="stack-xs">
                        {!it.scenes.length && <strong>סצנה {i + 1}</strong>}
                        {d.map((c, k) => (
                          <div key={k}>
                            <Icon n={c.icon} /> <span className="muted strike">{c.before || '—'}</span> ← <span className="diff-hl">{c.after || '—'}</span>
                          </div>
                        ))}
                      </div>
                    ))
                  ) : (
                    <span className="warn-text"><Icon n="alert" /> לא השתנה דבר {it.scenes.length ? 'בסצנה הזאת' : 'בתסריט'} — כדאי לבדוק</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
