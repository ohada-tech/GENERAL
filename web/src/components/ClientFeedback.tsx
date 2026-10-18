/**
 * הערות לקוח: Google Doc / Word / טקסט ← רשימת הערות לבדיקה (מה נכלל, לאיזו סצנה) ← תיקון אחד של התסריט.
 * על הגרסה שנוצרה מוצגת טבלה: כל הערה ← מה השתנה בסצנה שלה.
 */
import type { ScriptContent, ScriptVersion } from '@apos/shared';
import { useRef, useState } from 'react';
import { api, useAction } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { InlineError, Tag } from './ui';

type Kind = 'comment' | 'suggestion' | 'edit' | 'note';

export interface FeedbackItem {
  id: string;
  kind: Kind;
  author: string;
  quote: string;
  text: string;
  scenes: number[];
  include: boolean;
}

export interface FeedbackImport {
  id: string;
  baseVersionId: string;
  resultVersionId: string | null;
  source: 'gdoc' | 'docx' | 'text';
  sourceName: string;
  detectedLabel: string | null;
  items: FeedbackItem[];
  status: 'draft' | 'applied';
  createdAt: string;
}

const KIND: Record<Kind, string> = { comment: 'הערה במסמך', suggestion: 'הצעת שינוי', edit: 'עריכה ישירה', note: 'הערה' };
const SOURCE: Record<FeedbackImport['source'], string> = { gdoc: 'Google Doc', docx: 'Word', text: 'טקסט' };

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

  return (
    <section className="card stack">
      <div className="row between">
        <h2>📥 הערות לקוח</h2>
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
          </div>
          <textarea rows={4} placeholder="או הדבק כאן את ההערות (מוואטסאפ, מייל…) — כל שורה או תבליט = הערה" value={text} onChange={(e) => setText(e.target.value)} />
          <div>
            <button className="btn btn-ghost" disabled={act.busy || !text.trim()} onClick={() => importFrom({ text })}>
              ייבא טקסט
            </button>
          </div>
          {act.busy && (
            <div className="notice">
              <span className="spinner" /> קורא את ההערות…
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
              </li>
            ))}
          </ol>
          <div className="row gap-s wrap">
            <button className="btn" disabled={act.busy || running || !chosen.length || !base} onClick={apply} title="ChatGPT מתקן, Claude בודק — נוצרת גרסה חדשה">
              ✨ תקן את v{base?.label} לפי {chosen.length} הערות
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

const FIELDS = [
  ['narration', '🎙'],
  ['onScreenText', '🅣'],
  ['visualAction', '🎬'],
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
                            {c.icon} <span className="muted strike">{c.before || '—'}</span> ← <span className="diff-hl">{c.after || '—'}</span>
                          </div>
                        ))}
                      </div>
                    ))
                  ) : (
                    <span className="warn-text">⚠ לא השתנה דבר {it.scenes.length ? 'בסצנה הזאת' : 'בתסריט'} — כדאי לבדוק</span>
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
