import { ASPECT_RATIOS, validateBrief, type Asset, type Brief } from '@apos/shared';
import { useEffect, useMemo, useState } from 'react';
import { Field, InlineError, Tag } from '../components/ui';
import { api, assetUrl, useAction } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import type { TabProps } from './ProjectPage';

const PLATFORMS = ['Instagram Reels', 'TikTok', 'YouTube', 'YouTube Shorts', 'Facebook', 'LinkedIn', 'אתר', 'טלוויזיה / מסכים'];

export function BriefTab({ detail, reload }: TabProps) {
  const { project, state } = detail;
  const [draft, setDraft] = useState<Brief>(project.brief);
  const [dirty, setDirty] = useState(false);
  const save = useAction();
  const complete = useAction();

  // סנכרון מהשרת רק כשאין עריכה מקומית
  useEffect(() => {
    if (!dirty) setDraft(project.brief);
  }, [project.brief, dirty]);

  const v = useMemo(() => validateBrief(draft), [draft]);
  const missing = new Set(v.missingRequired.map((m) => m.field));
  const set = <K extends keyof Brief>(k: K, val: Brief[K]) => {
    setDraft((d) => ({ ...d, [k]: val }));
    setDirty(true);
  };

  const doSave = async () => {
    const r = await save.run(() => api.put(`/api/projects/${project.id}/brief`, { brief: draft }));
    if (r) {
      setDirty(false);
      await reload();
    }
    return r;
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
    <div className="brief">
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
          <Field label="קהל יעד" required missing={missing.has('targetAudience')}>
            <textarea rows={2} value={draft.targetAudience} onChange={(e) => set('targetAudience', e.target.value)} />
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
            <input value={draft.language} onChange={(e) => set('language', e.target.value)} placeholder="עברית" />
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
          onUploaded={async (a) => {
            const ids = [...draft.attachmentIds, a.id];
            set('attachmentIds', ids);
            // העלאה נשמרת מיד באפיון כדי שלא תאבד ברענון
            await api.put(`/api/projects/${project.id}/brief`, { brief: { ...draft, attachmentIds: ids } });
            setDirty(false);
            await reload();
          }}
          onRemove={(id) => set('attachmentIds', draft.attachmentIds.filter((x) => x !== id))}
        />
      </section>
    </div>
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
