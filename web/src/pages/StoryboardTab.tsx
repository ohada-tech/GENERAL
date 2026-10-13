import {
  ANIMATION_MODEL_OPTIONS,
  IMAGE_MODEL_OPTIONS,
  REFERENCE_CATEGORIES,
  SHOT_APPROVAL_LABELS,
  VERIFICATION_LABELS,
  type Asset,
  type Reference,
  type Shot,
  type ShotFields,
  type Storyboard,
} from '@apos/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmButton, Empty, ErrorBox, Field, InlineError, Loading, ModeTag, Modal, StatusBadge, Tag } from '../components/ui';
import { api, assetUrl, isCloud, useAction, useApi } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import type { TabProps } from './ProjectPage';

interface StoryboardData {
  versions: Storyboard[];
  storyboard: Storyboard | null;
  shots: Shot[];
  references: Reference[];
}

const approvalTone = (a: string) => (a === 'approved' ? 'completed' : a === 'needs_revision' ? 'needs_revision' : 'waiting_internal');

export function StoryboardTab({ detail, reload: reloadProject }: TabProps) {
  const { project, state } = detail;
  const sbStage = state.stages.find((s) => s.key === 'storyboard')!;
  const refStage = state.stages.find((s) => s.key === 'references')!;
  const scriptDone = state.stages.find((s) => s.key === 'script')!.status === 'completed';
  const running = sbStage.status === 'in_progress';
  const [version, setVersion] = useState<string>('');
  const { data, error, loading, reload } = useApi<StoryboardData>(
    `/api/projects/${project.id}/storyboard${version ? `?version=${version}` : ''}`,
    { pollMs: running ? 2000 : 8000 },
  );
  const [openShot, setOpenShot] = useState<string | null>(null);
  const act = useAction();

  const refresh = async () => {
    await Promise.all([reload(), reloadProject()]);
  };
  const post = async (url: string, body?: object) => {
    const r = await act.run(() => api.post(url, body));
    if (r !== undefined) await refresh();
    return r;
  };

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const sb = data?.storyboard ?? null;
  const shots = data?.shots ?? [];
  const refs = data?.references ?? [];
  const readOnly = !sb || sb.status !== 'draft';
  const approvedCount = shots.filter((s) => s.approval === 'approved').length;

  if (!sb) {
    return (
      <div className="stack">
        {running ? (
          <div className="notice">
            <span className="spinner" /> {sbStage.detail}
          </div>
        ) : sbStage.status === 'blocked' ? (
          <div className="error-box">
            {sbStage.detail} <Link to={`/projects/${project.id}/jobs`}>פרטים וניסיון חוזר</Link>
          </div>
        ) : null}
        <Empty title={scriptDone ? 'אין עדיין סטורי בורד' : 'הסטורי בורד ממתין לאישור לקוח על התסריט'}>
          {scriptDone ? (
            <button className="btn btn-primary" onClick={() => post(`/api/projects/${project.id}/storyboard/generate`)} disabled={act.busy || running}>
              צור סטורי בורד מהתסריט המאושר
            </button>
          ) : (
            <Link to={`/projects/${project.id}/script`}>למסך התסריט</Link>
          )}
          <div className="small muted">
            {project.settings.chatgptScope === 'script_and_visual'
              ? `מצב: ${isCloud() ? 'Claude' : 'ChatGPT'} מפתח גם קונספט חזותי ופרומפטים לכל שוט.`
              : `מצב: ${isCloud() ? 'Claude' : 'ChatGPT'} לתסריט בלבד — ייווצר שלד שוטים מהסצנות למילוי ידני.`}{' '}
            <Link to={`/projects/${project.id}/settings`}>שנה בהגדרות</Link>
          </div>
        </Empty>
        <InlineError error={act.error} onClose={act.clearError} />
      </div>
    );
  }

  const shotRefs = (id: string) => refs.filter((r) => r.shotId === id);
  const current = shots.find((s) => s.id === openShot) ?? null;
  const sourceMode = sb.source === 'demo' ? 'demo' : sb.source === 'skeleton' ? 'manual' : 'auto';

  return (
    <div className="stack">
      <div className="sticky-bar">
        <div className="row gap-s wrap">
          <select value={version || String(sb.version)} onChange={(e) => setVersion(e.target.value)}>
            {data!.versions.map((v) => (
              <option key={v.id} value={v.version}>
                v{v.version} · {{ draft: 'טיוטה', approved: 'מאושר', superseded: 'הוחלף' }[v.status]}
              </option>
            ))}
          </select>
          <ModeTag mode={sourceMode} />
          <span className="small muted">
            {sb.source === 'skeleton' ? 'שלד מהתסריט' : sb.provider ? `${sb.provider} · ${sb.model}` : ''} · {fmtDateTime(sb.createdAt)}
          </span>
          <StatusBadge status={sbStage.status} />
          <Tag>
            שוטים מאושרים {approvedCount}/{shots.length}
          </Tag>
          <Tag tone={refStage.status === 'completed' ? 'ok' : 'neutral'}>רפרנסים: {refStage.detail}</Tag>
        </div>
        <div className="row gap-s">
          {sb.status === 'draft' && (
            <>
              <button className="btn" onClick={() => post(`/api/projects/${project.id}/shots`, {})} disabled={act.busy}>
                + שוט
              </button>
              <button
                className="btn btn-primary"
                onClick={() => post(`/api/projects/${project.id}/storyboard/approve`, {})}
                disabled={act.busy || shots.length === 0 || approvedCount !== shots.length}
                title={approvedCount !== shots.length ? 'יש לאשר את כל השוטים קודם' : 'אישור לפני יצירת התמונות'}
              >
                ✓ אשר סטורי בורד
              </button>
            </>
          )}
          {sb.status === 'approved' && (
            <button className="btn" onClick={() => post(`/api/projects/${project.id}/storyboard/reopen`)} disabled={act.busy}>
              פתח מחדש לעריכה
            </button>
          )}
          {sb.status !== 'superseded' && scriptDone && (
            <button
              className="btn btn-ghost"
              onClick={() => post(`/api/projects/${project.id}/storyboard/generate`)}
              disabled={act.busy || running}
              title="יוצר גרסה חדשה; הגרסה הנוכחית נשמרת בהיסטוריה"
            >
              ↻ צור גרסה חדשה
            </button>
          )}
        </div>
      </div>
      <InlineError error={act.error} onClose={act.clearError} />
      {running && (
        <div className="notice">
          <span className="spinner" /> {sbStage.detail}
        </div>
      )}
      {sb.status === 'superseded' && <div className="notice">זו גרסה קודמת — לקריאה בלבד.</div>}
      {sb.status === 'approved' && (
        <div className="notice ok">
          הסטורי בורד אושר. שלב יצירת התמונות (Higgsfield / Nano Banana) עדיין לא מחובר במערכת — השתמש בפרומפטים המוכנים (כפתור "העתק")
          ובהמשך תוכל להעלות את התמונות לכל שוט.
        </div>
      )}
      {sbStage.detail.includes('גרסת תסריט קודמת') && <div className="notice warn">{sbStage.detail}</div>}

      {shots.length === 0 ? (
        <Empty title="אין שוטים בגרסה הזו" />
      ) : (
        <div className="shot-grid">
          {shots.map((s) => {
            const r = shotRefs(s.id);
            const approvedRef = r.find((x) => x.status === 'approved' && x.imageUrl);
            const preview = s.previewAssetId ? assetUrl(s.previewAssetId) : approvedRef?.imageUrl;
            return (
              <button key={s.id} className={`shot-card ap-${s.approval}`} onClick={() => setOpenShot(s.id)}>
                <div className={`shot-thumb ar-${project.brief.aspectRatio.replace(':', 'x') || '16x9'}`}>
                  {preview ? <img src={preview} alt={`שוט ${s.number}`} loading="lazy" referrerPolicy="no-referrer" /> : <span>שוט {s.number}</span>}
                </div>
                <div className="shot-meta">
                  <div className="row between">
                    <strong>
                      #{s.number} · סצנה {s.sceneIndex + 1}
                    </strong>
                    <span className="small muted">{s.durationSec}ש׳</span>
                  </div>
                  <div className="small">{[s.shotType, s.cameraAngle].filter(Boolean).join(' · ') || <span className="muted">ללא סוג שוט</span>}</div>
                  <div className="small muted clamp-2">{s.action || s.narration}</div>
                  <div className="row between">
                    <StatusBadge status={approvalTone(s.approval)} label={SHOT_APPROVAL_LABELS[s.approval]} />
                    <span className="small muted" title="רפרנסים מאושרים / סה״כ">
                      🖼 {r.filter((x) => x.status === 'approved').length}/{r.length}
                    </span>
                  </div>
                  {!s.imagePrompt && <div className="small warn-text">חסר פרומפט תמונה</div>}
                  {s.approval === 'needs_revision' && <div className="small warn-text">↺ {s.revisionNote}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {current && (
        <ShotEditor
          key={current.id}
          projectId={project.id}
          shot={current}
          total={shots.length}
          refs={shotRefs(current.id)}
          readOnly={readOnly}
          refsLocked={sb.status === 'superseded'}
          aspectRatio={project.brief.aspectRatio}
          onClose={() => setOpenShot(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

const TEXT_FIELDS: Array<[keyof ShotFields, string, boolean?]> = [
  ['action', 'תיאור הפעולה', true],
  ['narration', 'קריינות', true],
  ['shotType', 'סוג שוט'],
  ['cameraAngle', 'זווית מצלמה'],
  ['composition', 'קומפוזיציה ומיקום הדמות', true],
  ['movement', 'תנועת גוף, ראש ומבט', true],
  ['lens', 'עדשה ועומק שדה'],
  ['lighting', 'תאורה'],
  ['colorMood', 'צבעוניות ואווירה'],
  ['character', 'דמות', true],
  ['wardrobe', 'לבוש וסטיילינג'],
  ['consistencyNotes', 'דרישות עקביות בין שוטים', true],
];

function ShotEditor({
  projectId,
  shot,
  total,
  refs,
  readOnly,
  refsLocked,
  aspectRatio,
  onClose,
  onChanged,
}: {
  projectId: string;
  shot: Shot;
  total: number;
  refs: Reference[];
  readOnly: boolean;
  refsLocked: boolean;
  aspectRatio: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [f, setF] = useState<Shot>(shot);
  const [dirty, setDirty] = useState(false);
  const [revNote, setRevNote] = useState('');
  const act = useAction();
  useEffect(() => {
    if (!dirty) setF(shot);
  }, [shot, dirty]);
  const set = <K extends keyof Shot>(k: K, v: Shot[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };

  const run = async (fn: () => Promise<unknown>) => {
    const r = await act.run(fn);
    await onChanged();
    return r;
  };
  const save = async () => {
    const { id: _i, storyboardId: _s, projectId: _p, number: _n, approval: _a, revisionNote: _r, previewAssetId: _pa, updatedAt: _u, ...fields } = f;
    const r = await act.run(() => api.patch(`/api/shots/${shot.id}`, fields));
    if (r) {
      setDirty(false);
      await onChanged();
    }
  };
  const uploadPreview = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const a = await act.run(() => api.upload<Asset>(`/api/projects/${projectId}/assets?kind=shot_image`, file));
    if (a) await run(() => api.patch(`/api/shots/${shot.id}`, { previewAssetId: a.id }));
  };

  return (
    <Modal title={`שוט ${shot.number} מתוך ${total}`} onClose={onClose} wide>
      <div className="row between wrap gap-s">
        <div className="row gap-s">
          <StatusBadge status={approvalTone(shot.approval)} label={SHOT_APPROVAL_LABELS[shot.approval]} />
          {shot.revisionNote && <span className="small warn-text">↺ {shot.revisionNote}</span>}
          {dirty && <Tag tone="warn">לא נשמר</Tag>}
        </div>
        {!readOnly && (
          <div className="row gap-s">
            <button className="btn btn-sm" onClick={() => run(() => api.post(`/api/shots/${shot.id}/move`, { direction: 'up' }))} disabled={shot.number === 1 || act.busy}>
              ↑
            </button>
            <button className="btn btn-sm" onClick={() => run(() => api.post(`/api/shots/${shot.id}/move`, { direction: 'down' }))} disabled={shot.number === total || act.busy}>
              ↓
            </button>
            <ConfirmButton
              disabled={act.busy}
              onConfirm={async () => {
                await act.run(() => api.del(`/api/shots/${shot.id}`));
                await onChanged();
                onClose();
              }}
            >
              מחק שוט
            </ConfirmButton>
            <button className="btn btn-primary" onClick={save} disabled={!dirty || act.busy}>
              שמור
            </button>
          </div>
        )}
      </div>
      <InlineError error={act.error} onClose={act.clearError} />
      {readOnly && <div className="notice">לקריאה בלבד (סטורי בורד מאושר או גרסה ישנה).</div>}

      <div className="shot-editor">
        <div className="stack">
          <div className="grid-3">
            <Field label="סצנה">
              <input type="number" min={1} value={f.sceneIndex + 1} disabled={readOnly} onChange={(e) => set('sceneIndex', Math.max(0, Number(e.target.value) - 1))} />
            </Field>
            <Field label="משך (שניות)">
              <input type="number" min={0} step={0.5} value={f.durationSec} disabled={readOnly} onChange={(e) => set('durationSec', Number(e.target.value) || 0)} />
            </Field>
            <Field label="פורמט">
              <input value={aspectRatio} disabled />
            </Field>
          </div>
          <div className="grid-2">
            {TEXT_FIELDS.map(([k, label, long]) => (
              <Field key={k} label={label}>
                {long ? (
                  <textarea rows={2} value={String(f[k] ?? '')} disabled={readOnly} onChange={(e) => set(k, e.target.value as never)} />
                ) : (
                  <input value={String(f[k] ?? '')} disabled={readOnly} onChange={(e) => set(k, e.target.value as never)} />
                )}
              </Field>
            ))}
          </div>
          <PromptField label="פרומפט ליצירת תמונה" value={f.imagePrompt} disabled={readOnly} onChange={(v) => set('imagePrompt', v)} />
          <PromptField label="פרומפט להנפשה" value={f.animationPrompt} disabled={readOnly} onChange={(v) => set('animationPrompt', v)} />
          <div className="grid-3">
            <Field label="מודל תמונה מומלץ">
              <ModelSelect options={IMAGE_MODEL_OPTIONS} value={f.imageModel} disabled={readOnly} onChange={(v) => set('imageModel', v)} />
            </Field>
            <Field label="מודל הנפשה מומלץ">
              <ModelSelect options={ANIMATION_MODEL_OPTIONS} value={f.animationModel} disabled={readOnly} onChange={(v) => set('animationModel', v)} />
            </Field>
            <Field label="נימוק לבחירת מודל ההנפשה">
              <input value={f.animationModelReason} disabled={readOnly} onChange={(e) => set('animationModelReason', e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="stack">
          <div className="preview-box">
            {shot.previewAssetId ? (
              <img src={assetUrl(shot.previewAssetId)} alt="תצוגה מקדימה" />
            ) : (
              <div className="muted small">אין תמונה לשוט. ניתן להעלות פריים שנוצר ידנית.</div>
            )}
            {!readOnly && (
              <div className="row gap-s">
                <label className="btn btn-sm">
                  העלה תמונה לשוט
                  <input type="file" accept="image/*" hidden onChange={uploadPreview} />
                </label>
                {shot.previewAssetId && (
                  <button className="btn btn-sm btn-ghost" onClick={() => run(() => api.patch(`/api/shots/${shot.id}`, { previewAssetId: null }))}>
                    הסר
                  </button>
                )}
              </div>
            )}
          </div>

          {!readOnly && (
            <div className="card inner">
              <strong>אישור השוט</strong>
              {dirty && <div className="small warn-text">שמור את השינויים לפני אישור.</div>}
              <div className="row gap-s">
                <button
                  className="btn btn-primary"
                  disabled={dirty || act.busy || shot.approval === 'approved'}
                  onClick={() => run(() => api.post(`/api/shots/${shot.id}/approve`))}
                >
                  ✓ אשר שוט
                </button>
              </div>
              <div className="approval-row">
                <input placeholder="מה לתקן" value={revNote} onChange={(e) => setRevNote(e.target.value)} />
                <button
                  className="btn"
                  disabled={act.busy || !revNote.trim()}
                  onClick={async () => {
                    await run(() => api.post(`/api/shots/${shot.id}/request-revision`, { note: revNote }));
                    setRevNote('');
                  }}
                >
                  בקש תיקון
                </button>
              </div>
            </div>
          )}

          <References shot={f} refs={refs} readOnly={refsLocked} onChanged={onChanged} />
        </div>
      </div>
    </Modal>
  );
}

function ModelSelect({ options, value, disabled, onChange }: { options: string[]; value: string; disabled?: boolean; onChange: (v: string) => void }) {
  const all = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {all.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

function PromptField({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (v: string) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Field label={label} group>
      <textarea dir="ltr" rows={4} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="mono" />
      <div className="row end">
        <button type="button" className="btn btn-sm" onClick={copy} disabled={!value}>
          {copied ? '✓ הועתק' : 'העתק'}
        </button>
      </div>
    </Field>
  );
}

/** חיפוש מבוסס קישורים: פותח חיפוש בפלטפורמה בלשונית חדשה — ללא סריקה או עקיפת התחברות. */
function searchQuery(shot: Shot) {
  return [shot.shotType, shot.cameraAngle, shot.lighting, shot.action].filter(Boolean).join(' ').slice(0, 120);
}

function References({ shot, refs, readOnly, onChanged }: { shot: Shot; refs: Reference[]; readOnly: boolean; onChanged: () => Promise<void> }) {
  const act = useAction();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState(searchQuery(shot));
  const patch = async (id: string, body: object) => {
    const r = await act.run(() => api.patch(`/api/references/${id}`, body));
    if (r) await onChanged();
  };
  const enc = encodeURIComponent(q);
  return (
    <div className="card inner">
      <div className="row between">
        <strong>רפרנסים ({refs.length})</strong>
        {!readOnly && (
          <button className="btn btn-sm" onClick={() => setAdding((a) => !a)}>
            {adding ? 'סגור' : '+ רפרנס'}
          </button>
        )}
      </div>
      <div className="small muted">חיפוש בלשונית חדשה (ידני), ואז הדבק כאן את קישור המקור:</div>
      <div className="approval-row">
        <input value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
        <a className="btn btn-sm" href={`https://www.pinterest.com/search/pins/?q=${enc}`} target="_blank" rel="noreferrer">
          Pinterest
        </a>
        <a className="btn btn-sm" href={`https://unsplash.com/s/photos/${enc}`} target="_blank" rel="noreferrer">
          Unsplash
        </a>
        <a className="btn btn-sm" href={`https://www.pexels.com/search/${enc}/`} target="_blank" rel="noreferrer">
          Pexels
        </a>
      </div>
      <InlineError error={act.error} onClose={act.clearError} />
      {adding && <AddReference shotId={shot.id} onDone={async () => { setAdding(false); await onChanged(); }} />}
      {refs.length === 0 && !adding && <div className="muted small">אין רפרנסים לשוט</div>}
      <ul className="ref-list">
        {refs.map((r) => (
          <li key={r.id} className={`ref ref-${r.status}`}>
            <a href={r.url} target="_blank" rel="noreferrer" className="ref-thumb">
              {r.imageUrl ? <img src={r.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>🔗</span>}
            </a>
            <div className="ref-body">
              <div className="row gap-s wrap">
                <Tag>{r.platform}</Tag>
                <Tag>{REFERENCE_CATEGORIES[r.category] ?? r.category}</Tag>
                <Tag tone={r.verification === 'verified_real' ? 'ok' : r.verification === 'suspected_ai' ? 'danger' : 'neutral'}>
                  {VERIFICATION_LABELS[r.verification]}
                </Tag>
                <Tag tone={r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'danger' : 'warn'}>
                  {{ candidate: 'מועמד', approved: 'מאושר', rejected: 'נפסל' }[r.status]}
                </Tag>
              </div>
              {r.description && <div className="small">{r.description}</div>}
              <div className="small muted">
                התאמה {r.matchScore ?? '—'}/10 · איכות {r.qualityScore ?? '—'}/10 {r.rightsNote && `· זכויות: ${r.rightsNote}`}
              </div>
              {!readOnly && <div className="row gap-s wrap">
                <select value={r.verification} onChange={(e) => patch(r.id, { verification: e.target.value })} disabled={act.busy}>
                  {Object.entries(VERIFICATION_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                {r.status !== 'approved' && (
                  <button className="btn btn-sm" onClick={() => patch(r.id, { status: 'approved' })} disabled={act.busy}>
                    ✓ אשר
                  </button>
                )}
                {r.status !== 'rejected' && (
                  <button className="btn btn-sm btn-ghost" onClick={() => patch(r.id, { status: 'rejected' })} disabled={act.busy}>
                    ✕ פסול
                  </button>
                )}
                <button
                  className="btn-link danger-text small"
                  onClick={async () => {
                    await act.run(() => api.del(`/api/references/${r.id}`));
                    await onChanged();
                  }}
                >
                  מחק
                </button>
              </div>}
            </div>
          </li>
        ))}
      </ul>
      <div className="small muted">
        רפרנסים משמשים להשראה והנחיה חזותית בלבד. שימוש מסחרי ישיר בתמונה מחייב בדיקת זכויות. "לא מאומת" = לא ניתן לקבוע שזה צילום אמיתי.
      </div>
    </div>
  );
}

function AddReference({ shotId, onDone }: { shotId: string; onDone: () => Promise<void> }) {
  const [r, setR] = useState({
    url: '',
    imageUrl: '',
    category: 'other',
    description: '',
    verification: 'unverified',
    matchScore: '',
    qualityScore: '',
    rightsNote: '',
  });
  const act = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await act.run(() =>
      api.post(`/api/shots/${shotId}/references`, {
        ...r,
        matchScore: r.matchScore === '' ? null : Number(r.matchScore),
        qualityScore: r.qualityScore === '' ? null : Number(r.qualityScore),
      }),
    );
    if (res) await onDone();
  };
  return (
    <form className="stack add-ref" onSubmit={submit}>
      <Field label="קישור מקור" required>
        <input dir="ltr" type="url" required value={r.url} onChange={(e) => setR({ ...r, url: e.target.value })} placeholder="https://www.pinterest.com/pin/…" />
      </Field>
      <Field label="קישור ישיר לתמונה (לתצוגה מקדימה)" hint="אופציונלי">
        <input dir="ltr" value={r.imageUrl} onChange={(e) => setR({ ...r, imageUrl: e.target.value })} />
      </Field>
      <div className="grid-2">
        <Field label="סוג רפרנס">
          <select value={r.category} onChange={(e) => setR({ ...r, category: e.target.value })}>
            {Object.entries(REFERENCE_CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="אימות מקור">
          <select value={r.verification} onChange={(e) => setR({ ...r, verification: e.target.value })}>
            {Object.entries(VERIFICATION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ציון התאמה לשוט (0–10)">
          <input type="number" min={0} max={10} value={r.matchScore} onChange={(e) => setR({ ...r, matchScore: e.target.value })} />
        </Field>
        <Field label="איכות צילום (0–10)">
          <input type="number" min={0} max={10} value={r.qualityScore} onChange={(e) => setR({ ...r, qualityScore: e.target.value })} />
        </Field>
      </div>
      <Field label="תיאור — מה לקחת מהרפרנס">
        <input value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} />
      </Field>
      <Field label="זכויות / הערות שימוש">
        <input value={r.rightsNote} onChange={(e) => setR({ ...r, rightsNote: e.target.value })} />
      </Field>
      <InlineError error={act.error} />
      <div className="row end">
        <button className="btn btn-primary" disabled={act.busy || !r.url}>
          הוסף רפרנס
        </button>
      </div>
    </form>
  );
}
