import {
  ASPECT_RATIOS,
  changedBriefFields,
  openDiscoveryQuestions,
  rebaseBrief,
  validateBrief,
  type Asset,
  type Brief,
  type DiscoveryQuestion,
  type Project,
} from '@apos/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AiFilledContext, aiLabels, AutoBrief } from '../components/AutoBrief';
import { ConceptPicker } from '../components/ConceptPicker';
import { Field, InlineError, Tag } from '../components/ui';
import { api, ApiError, assetUrl, useAction } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import type { TabProps } from './ProjectPage';

const PLATFORMS = ['Instagram Reels', 'TikTok', 'YouTube', 'YouTube Shorts', 'Facebook', 'LinkedIn', 'אתר', 'טלוויזיה / מסכים'];

export function BriefTab({ detail, reload }: TabProps) {
  const { project, state } = detail;
  // base = האפיון בשרת שהטופס מבוסס עליו. נשמרים רק שדות שאוהד שינה ביחס אליו,
  // כדי ששמירה מהטופס לא תמחק שדות שמילוי אוטומטי (או Claude/ChatGPT) כתבו בינתיים.
  const baseRef = useRef<Brief>(project.brief);
  const [draft, setDraft] = useState<Brief>(project.brief);
  const save = useAction();
  const complete = useAction();

  /** האפיון בשרת התעדכן: שדות שלא נערכו בטופס מקבלים את הערך החדש, שדות שנערכו נשארים. */
  const accept = (prev: Brief, server: Brief) => {
    baseRef.current = server;
    setDraft((d) => rebaseBrief(prev, d, server));
  };

  useEffect(() => {
    if (JSON.stringify(baseRef.current) === JSON.stringify(project.brief)) return;
    accept(baseRef.current, project.brief);
  }, [project.brief]);

  const dirtyFields = changedBriefFields(baseRef.current, draft);
  const dirty = dirtyFields.length > 0;
  const v = useMemo(() => validateBrief(draft), [draft]);
  const missing = new Set(v.missingRequired.map((m) => m.field));
  const set = <K extends keyof Brief>(k: K, val: Brief[K]) => setDraft((d) => ({ ...d, [k]: val }));
  const pick = (b: Brief, keys: Array<keyof Brief>) => Object.fromEntries(keys.map((k) => [k, b[k]])) as Partial<Brief>;

  const doSave = async () => {
    const sent = draft;
    const fields = changedBriefFields(baseRef.current, sent);
    if (!fields.length) return true;
    const r = await save.run(async () => {
      try {
        return await api.put<Project>(`/api/projects/${project.id}/brief`, { brief: pick(sent, fields), base: pick(baseRef.current, fields) });
      } catch (e) {
        // השדה התעדכן במערכת מאז שהטופס נטען — מושכים את הערכים החדשים, העריכה של אוהד נשארת בטופס
        if (e instanceof ApiError && e.status === 409) await reload();
        throw e;
      }
    });
    if (r) {
      accept(sent, r.brief);
      await reload();
    }
    return r;
  };

  /** שמירה מיידית של שדה אחד (בחירת כיוון, קובץ מצורף) בלי לשלוח את שאר הטופס. */
  const saveNow = async (patch: Partial<Brief>) => {
    setDraft((d) => ({ ...d, ...patch }));
    const prev = baseRef.current;
    const r = await api.put<Project>(`/api/projects/${project.id}/brief`, { brief: patch });
    accept(prev, r.brief);
    await reload();
  };

  const doComplete = async () => {
    if (dirty && !(await doSave())) return;
    const r = await complete.run(() => api.post(`/api/projects/${project.id}/brief/complete`));
    if (r) await reload();
  };

  const reopen = async () => {
    await complete.run(() => api.post(`/api/projects/${project.id}/brief/reopen`));
    await reload();
  };

  const attachments = detail.assets.filter((a) => draft.attachmentIds.includes(a.id));

  return (
    <AiFilledContext.Provider value={aiLabels(draft.aiFilled ?? [])}>
    <div className="brief">
      {!project.briefCompletedAt && <AutoBrief projectId={project.id} brief={draft} beforeRun={() => (dirty ? doSave() : Promise.resolve())} onDone={reload} />}
      <ConceptPicker
        projectId={project.id}
        brief={draft}
        reload={reload}
        beforeRun={() => (dirty ? doSave() : Promise.resolve())}
        onChange={(concept) => saveNow({ concept }) /* הבחירה נשמרת מיד באפיון */}
      />
      <div className="sticky-bar">
        <div className="row gap-s">
          {project.briefCompletedAt ? (
            <Tag tone="ok">האפיון סומן כמוכן · {fmtDateTime(project.briefCompletedAt)}</Tag>
          ) : (
            <Tag tone={v.complete ? 'ok' : 'warn'}>
              שדות חובה: {v.requiredDone}/{v.requiredTotal}
            </Tag>
          )}
          {dirty && <Tag tone="warn">שינויים שלא נשמרו</Tag>}
        </div>
        <div className="row gap-s">
          <button className="btn" onClick={doSave} disabled={!dirty || save.busy}>
            {save.busy ? 'שומר…' : 'שמור'}
          </button>
          {project.briefCompletedAt ? (
            <button className="btn btn-ghost" onClick={reopen} disabled={complete.busy}>
              פתח מחדש
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={doComplete}
              disabled={!v.complete || complete.busy}
              title={v.complete ? 'יפעיל אוטומטית את כתיבת התסריט' : 'השלם קודם את שדות החובה'}
            >
              {complete.busy ? 'מסמן…' : '✓ האפיון הושלם — הפעל כתיבת תסריט'}
            </button>
          )}
        </div>
      </div>
      <InlineError error={save.error ?? complete.error} />

      {!v.complete && (
        <div className="notice warn">
          <strong>חסר להשלמת האפיון:</strong> {v.missingRequired.map((m) => m.label).join(' · ')}
        </div>
      )}
      {v.complete && v.missingRecommended.length > 0 && (
        <div className="notice">
          <strong>מומלץ להשלים:</strong> {v.missingRecommended.map((m) => m.label).join(' · ')}
        </div>
      )}
      {project.briefCompletedAt && state.stages[1].status !== 'not_started' && (
        <div className="notice">שינוי האפיון אחרי שהושלם לא ייצור תסריט מחדש אוטומטית. ניתן להריץ שוב מלשונית התסריט.</div>
      )}

      <DiscoveryCard projectId={project.id} draft={draft} />

      <section className="card">
        <h2>הסרטון</h2>
        <div className="grid-2">
          <Field label="סוג הסרטון" required missing={missing.has('videoType')}>
            <input value={draft.videoType} onChange={(e) => set('videoType', e.target.value)} placeholder="פרסומת, הסבר מוצר, תדמית…" />
          </Field>
          <Field label="מטרת הסרטון" required missing={missing.has('goal')}>
            <input value={draft.goal} onChange={(e) => set('goal', e.target.value)} placeholder="מכירות, לידים, מודעות…" />
          </Field>
          <Field label="מוצר / שירות" required missing={missing.has('productOrService')}>
            <textarea rows={2} value={draft.productOrService} onChange={(e) => set('productOrService', e.target.value)} />
          </Field>
          <Field label="אתר הלקוח" hint="ChatGPT ו-Claude מקבלים אותו עם האפיון">
            <div className="row gap-s">
              <input className="grow" dir="ltr" type="url" inputMode="url" value={draft.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
              {/^https?:\/\/\S+\.\S+/.test(draft.website.trim()) && (
                <a className="btn btn-sm" href={draft.website.trim()} target="_blank" rel="noopener noreferrer" title="פתח את האתר בלשונית חדשה">
                  ↗
                </a>
              )}
            </div>
          </Field>
          <Field label="קהל יעד" required missing={missing.has('targetAudience')}>
            <textarea rows={2} value={draft.targetAudience} onChange={(e) => set('targetAudience', e.target.value)} />
          </Field>
          <Field label="שוק / מדינת יעד" required missing={missing.has('targetMarket')} hint="איפה הקהל — קובע שפה, תרבות, מטבע ורגולציה">
            <input value={draft.targetMarket} onChange={(e) => set('targetMarket', e.target.value)} placeholder='ישראל / ארה"ב / אירופה / עולמי' />
          </Field>
          <Field label="קריאה לפעולה (CTA)" hint="מה הצופה עושה בסוף, ולאן זה מוביל">
            <input value={draft.cta} onChange={(e) => set('cta', e.target.value)} placeholder="השאירו פרטים באתר, תאמו הדגמה…" />
          </Field>
        </div>
        <Field label="המסר המרכזי" required missing={missing.has('keyMessage')}>
          <textarea rows={2} value={draft.keyMessage} onChange={(e) => set('keyMessage', e.target.value)} />
        </Field>
      </section>

      <section className="card">
        <h2>הפצה ופורמט</h2>
        <Field label="פלטפורמות הפצה" required missing={missing.has('platforms')} group>
          <div className="chips">
            {[...new Set([...PLATFORMS, ...draft.platforms])].map((p) => (
              <button
                type="button"
                key={p}
                className={`chip ${draft.platforms.includes(p) ? 'chip-on' : ''}`}
                onClick={() =>
                  set('platforms', draft.platforms.includes(p) ? draft.platforms.filter((x) => x !== p) : [...draft.platforms, p])
                }
              >
                {p}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid-3">
          <Field label="יחס תמונה" required missing={missing.has('aspectRatio')}>
            <select value={draft.aspectRatio} onChange={(e) => set('aspectRatio', e.target.value)}>
              <option value="">בחר…</option>
              {ASPECT_RATIOS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="אורך הסרטון (שניות)" required missing={missing.has('durationSec')}>
            <input
              type="number"
              min={1}
              value={draft.durationSec ?? ''}
              onChange={(e) => set('durationSec', e.target.value ? Math.max(0, Math.round(Number(e.target.value))) : null)}
            />
          </Field>
          <Field label="תאריך יעד" required missing={missing.has('dueDate')}>
            <input type="date" value={draft.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>סגנון ומותג</h2>
        <Field label="סגנון חזותי" required missing={missing.has('visualStyle')}>
          <textarea rows={2} value={draft.visualStyle} onChange={(e) => set('visualStyle', e.target.value)} />
        </Field>
        <Field label="השראות" hint="קישורים או תיאור">
          <textarea rows={2} value={draft.inspirations} onChange={(e) => set('inspirations', e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="לוגו" hint="קישור או תיאור. ניתן גם להעלות קובץ למטה.">
            <input value={draft.brandLogo} onChange={(e) => set('brandLogo', e.target.value)} />
          </Field>
          <Field label="צבעי מותג">
            <input value={draft.brandColors} onChange={(e) => set('brandColors', e.target.value)} placeholder="#C8A6FF, #7EE6E6…" />
          </Field>
          <Field label="פונטים">
            <input value={draft.brandFonts} onChange={(e) => set('brandFonts', e.target.value)} />
          </Field>
          <Field label="תמונות מותג">
            <input value={draft.brandImages} onChange={(e) => set('brandImages', e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <h2>דמויות</h2>
          <button className="btn btn-sm" onClick={() => set('characters', [...draft.characters, { name: '', description: '' }])}>
            + דמות
          </button>
        </div>
        {draft.characters.length === 0 && <div className="muted small">לא הוגדרו דמויות</div>}
        {draft.characters.map((c, i) => (
          <div key={i} className="char-row">
            <input
              placeholder="שם / תפקיד"
              value={c.name}
              onChange={(e) => set('characters', draft.characters.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <input
              placeholder="תיאור: גיל, מראה, לבוש, אישיות"
              value={c.description}
              onChange={(e) =>
                set('characters', draft.characters.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
              }
            />
            <button className="btn-link" onClick={() => set('characters', draft.characters.filter((_, j) => j !== i))} aria-label="הסר">
              ✕
            </button>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>קריינות ושפה</h2>
        <label className="check">
          <input type="checkbox" checked={draft.voiceoverNeeded} onChange={(e) => set('voiceoverNeeded', e.target.checked)} /> נדרשת
          קריינות
        </label>
        <div className="grid-3">
          <Field label="שפה" required missing={missing.has('language')}>
            <input value={draft.language} onChange={(e) => set('language', e.target.value)} placeholder="לפי שוק היעד — עברית / English…" />
          </Field>
          <Field label="טון" required={draft.voiceoverNeeded} missing={missing.has('tone')}>
            <input value={draft.tone} onChange={(e) => set('tone', e.target.value)} placeholder="חם, אנרגטי, יוקרתי…" />
          </Field>
          <Field label="הערות לקול">
            <input value={draft.voiceNotes} onChange={(e) => set('voiceNotes', e.target.value)} placeholder="קול נשי, צעיר…" />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>תקציב, מגבלות וחומרים</h2>
        <div className="grid-2">
          <Field label="תקציב">
            <input value={draft.budget} onChange={(e) => set('budget', e.target.value)} />
          </Field>
          <Field label="מגבלות הפקה">
            <input value={draft.constraints} onChange={(e) => set('constraints', e.target.value)} />
          </Field>
        </div>
        <Field label="הערות נוספות">
          <textarea rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        <div className="row between">
          <strong>קישורים</strong>
          <button className="btn btn-sm" onClick={() => set('links', [...draft.links, { label: '', url: '' }])}>
            + קישור
          </button>
        </div>
        {draft.links.map((l, i) => (
          <div key={i} className="char-row">
            <input
              placeholder="תיאור"
              value={l.label}
              onChange={(e) => set('links', draft.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <input
              placeholder="https://"
              dir="ltr"
              value={l.url}
              onChange={(e) => set('links', draft.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
            />
            <button className="btn-link" onClick={() => set('links', draft.links.filter((_, j) => j !== i))} aria-label="הסר">
              ✕
            </button>
          </div>
        ))}

        <Attachments
          projectId={project.id}
          attachments={attachments}
          // העלאה נשמרת מיד באפיון כדי שלא תאבד ברענון
          onUploaded={(a) => saveNow({ attachmentIds: [...draft.attachmentIds, a.id] })}
          onRemove={(id) => set('attachmentIds', draft.attachmentIds.filter((x) => x !== id))}
        />
      </section>
    </div>
    </AiFilledContext.Provider>
  );
}

function Attachments({
  projectId,
  attachments,
  onUploaded,
  onRemove,
}: {
  projectId: string;
  attachments: Asset[];
  onUploaded: (a: Asset) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const up = useAction();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const a = await up.run(() => api.upload<Asset>(`/api/projects/${projectId}/assets?kind=brief`, f));
    if (a) await onUploaded(a);
  };
  return (
    <div className="attachments">
      <div className="row between">
        <strong>קבצים מצורפים</strong>
        <label className="btn btn-sm">
          {up.busy ? 'מעלה…' : '+ העלה קובץ'}
          <input type="file" hidden onChange={onFile} disabled={up.busy} />
        </label>
      </div>
      <InlineError error={up.error} onClose={up.clearError} />
      {attachments.length === 0 ? (
        <div className="muted small">אין קבצים</div>
      ) : (
        <ul className="file-list">
          {attachments.map((a) => (
            <li key={a.id}>
              <a href={assetUrl(a.id)} target="_blank" rel="noreferrer">
                {a.filename}
              </a>{' '}
              <span className="muted small">{Math.round(a.size / 1024)}KB</span>
              <button className="btn-link" onClick={() => onRemove(a.id)} title="הסר מהאפיון (הקובץ נשמר בפרויקט)">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * שאלון לבעל העסק: השאלות הסטנדרטיות שעוד לא נענו באפיון + שאלות ש-Claude מזהה כחסרות בפרויקט הזה.
 * אפשר להעתיק הכל ולשלוח ללקוח בוואטסאפ.
 */
function DiscoveryCard({ projectId, draft }: { projectId: string; draft: Brief }) {
  const open = openDiscoveryQuestions(draft);
  const ai = useAction();
  const [aiQs, setAiQs] = useState<Array<{ q: string; why: string }> | null>(null);
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(open.some((q) => q.critical));
  const groups = open.reduce<Record<string, DiscoveryQuestion[]>>((m, q) => ((m[q.group] ??= []).push(q), m), {});
  const ask = async () => {
    const r = await ai.run(() => api.post<{ questions: Array<{ q: string; why: string }> }>(`/api/projects/${projectId}/brief/questions`, { brief: draft }));
    if (r) {
      setAiQs(r.questions);
      setShow(true);
    }
  };
  const copy = async () => {
    const lines = [
      'כמה שאלות כדי שהסרטון יפגע בדיוק במטרה:',
      ...open.map((q, i) => `${i + 1}. ${q.q}`),
      ...(aiQs ?? []).filter((x) => !open.some((q) => q.q === x.q)).map((x, i) => `${open.length + i + 1}. ${x.q}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* דפדפן חסם העתקה */
    }
  };
  const critical = open.filter((q) => q.critical).length;
  return (
    <section className="card stack">
      <div className="row gap-s">
        <div className="grow">
          <h2>שאלון לבעל העסק</h2>
          <div className="muted small">
            {open.length === 0
              ? 'כל השאלות הסטנדרטיות נענו ✓'
              : `${open.length} שאלות עוד לא נענו${critical ? ` · ${critical} קריטיות` : ''} — שאל את הלקוח לפני כתיבת התסריט`}
          </div>
        </div>
        <button className="btn" onClick={ask} disabled={ai.busy} title="Claude עובר על האפיון ומציע מה עוד חייבים לשאול בפרויקט הזה">
          {ai.busy ? 'Claude בודק…' : '🔍 מה עוד לשאול?'}
        </button>
        <button className="btn btn-ghost" onClick={copy} disabled={!open.length && !aiQs?.length}>
          {copied ? 'הועתק ✓' : '📋 העתק לשליחה ללקוח'}
        </button>
        {open.length > 0 && (
          <button className="btn-link small" onClick={() => setShow((x) => !x)}>
            {show ? 'הסתר' : 'הצג'}
          </button>
        )}
      </div>
      <InlineError error={ai.error} onClose={ai.clearError} />
      {show && (
        <div className="grid-2">
          {Object.entries(groups).map(([g, qs]) => (
            <div key={g}>
              <div className="small muted">{g}</div>
              <ul className="stack" style={{ margin: 0, paddingInlineStart: 18 }}>
                {qs.map((q) => (
                  <li key={q.q} className={q.critical ? '' : 'muted'}>
                    {q.critical && <b>! </b>}
                    {q.q}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {aiQs && aiQs.length > 0 && (
        <div className="notice">
          <b>Claude ממליץ לשאול גם:</b>
          <ol style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
            {aiQs.map((x) => (
              <li key={x.q}>
                {x.q} <span className="muted small">— {x.why}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
