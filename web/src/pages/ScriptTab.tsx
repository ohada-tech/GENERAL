import {
  nextScriptNumbers,
  scriptChangeSize,
  versionLabel,
  computeTiming,
  diffScripts,
  SCRIPT_STATUS_LABELS,
  STORY_ROLE_LABELS,
  STORY_ROLES,
  type Approval,
  type Comment,
  type Job,
  type ScriptContent,
  type ScriptVersion,
} from '@apos/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClientFeedbackChanges, ClientFeedbackImport, type FeedbackImport } from '../components/ClientFeedback';
import { ConfirmButton, Empty, ErrorBox, Field, InlineError, Loading, ModeTag, StatusBadge, Tag } from '../components/ui';
import { api, isCloud, useAction, useApi } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import type { TabProps } from './ProjectPage';

interface ScriptsData {
  versions: ScriptVersion[];
  approvals: Approval[];
  comments: Record<string, Comment[]>;
  deleted?: Array<{ id: string; label: string; createdAt: string; changeNote: string }>;
}

const SOURCE_LABEL: Record<string, string> = { ai: 'AI', ai_revision: 'תיקון AI', manual: 'ידני', demo: 'DEMO' };

const statusTone = (s: string) =>
  s === 'client_approved' ? 'completed' : s === 'internal_approved' ? 'waiting_client' : s === 'changes_requested' ? 'needs_revision' : 'waiting_internal';

export function ScriptTab({ detail, reload: reloadProject }: TabProps) {
  const { project, state } = detail;
  const scriptStage = state.stages.find((s) => s.key === 'script')!;
  const running = scriptStage.status === 'in_progress';
  const { data, error, loading, reload } = useApi<ScriptsData>(`/api/projects/${project.id}/scripts`, {
    pollMs: running ? 2000 : 8000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string>('');
  const [editing, setEditing] = useState<ScriptContent | null>(null);
  const gen = useAction();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // הערות לקוח שיובאו (רק בגרסת השרת)
  const feedback = useApi<{ imports: FeedbackImport[] }>(isCloud() ? null : `/api/projects/${project.id}/feedback`, { pollMs: running ? 4000 : 0 });

  const versions = data?.versions ?? [];
  const latest = versions[0] ?? null;
  const selected = versions.find((v) => v.id === selectedId) ?? latest;

  // כשנוצרת גרסה חדשה — עבור אליה אוטומטית
  const latestId = latest?.id;
  useEffect(() => {
    setSelectedId(null);
    if (!isCloud()) void feedback.reload(); // גרסה מהערות לקוח ← טבלת "מה שונה"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestId]);

  const refresh = async () => {
    await Promise.all([reload(), reloadProject(), isCloud() ? null : feedback.reload()]);
  };
  const imports = feedback.data?.imports ?? [];
  const pendingImport = imports.find((i) => i.status === 'draft') ?? null;
  const fromClient = selected ? imports.find((i) => i.resultVersionId === selected.id) : undefined;

  const generate = async () => {
    const r = await gen.run(() => api.post(`/api/projects/${project.id}/scripts/generate`));
    if (r) await refresh();
  };

  if (!project.briefCompletedAt && versions.length === 0) {
    return (
      <Empty title="התסריט ממתין להשלמת האפיון">
        <Link to={`/projects/${project.id}/brief`}>השלם את האפיון וסמן אותו כמוכן</Link> — כתיבת התסריט תופעל אוטומטית.
      </Empty>
    );
  }
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const providerMode = project.settings.textProvider === 'demo' ? 'demo' : 'auto';

  return (
    <div className="script-layout">
      <aside className="card versions">
        <div className="row between">
          <h2>גרסאות</h2>
          <button className="btn btn-sm" onClick={generate} disabled={gen.busy || running || !project.briefCompletedAt} title="יוצר גרסה חדשה מהאפיון בלי למחוק קודמות">
            {latest ? '+ טיוטה חדשה (AI)' : 'צור טיוטה (AI)'}
          </button>
        </div>
        <div className="small muted row gap-s">
          ספק: <ModeTag mode={providerMode} /> {project.settings.textProvider === 'openai' ? project.settings.textModel || 'מודל ברירת מחדל' : ''}
        </div>
        {!isCloud() && versions.length > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={() => setFeedbackOpen(true)} disabled={feedbackOpen} title="Google Doc, Word או טקסט עם הערות הלקוח ← תיקון התסריט">
            📥 הערות לקוח{pendingImport ? ' (ממתין לתיקון)' : ''}
          </button>
        )}
        <InlineError error={gen.error} onClose={gen.clearError} />
        {running && <RunningNotice projectId={project.id} detail={scriptStage.detail} onDone={refresh} />}
        {scriptStage.status === 'blocked' && (
          <div className="error-box small">
            {scriptStage.detail} <Link to={`/projects/${project.id}/jobs`}>פרטים וניסיון חוזר</Link>
          </div>
        )}
        {versions.length === 0 && !running && <div className="muted small">אין עדיין גרסאות. צור טיוטה ב-AI או כתוב ידנית.</div>}
        <ul className="version-list">
          {versions.map((v) => (
            <li key={v.id}>
              <button className={`version-item ${selected?.id === v.id ? 'on' : ''}`} onClick={() => { setSelectedId(v.id); setEditing(null); }}>
                <span className="row between">
                  <strong>
                    {v.id === latest?.id && (v.status === 'internal_approved' || v.status === 'client_approved') ? '⭐ ' : ''}v{v.label}
                  </strong>
                  <StatusBadge status={statusTone(v.status)} label={SCRIPT_STATUS_LABELS[v.status]} />
                </span>
                <span className="small muted">
                  {SOURCE_LABEL[v.source]} · {fmtDateTime(v.createdAt)}
                </span>
                {v.changeNote && (
                  <span className="small clamp-2" title={v.changeNote}>
                    {v.changeNote}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {(data?.deleted?.length ?? 0) > 0 && <DeletedVersions items={data!.deleted!} onDone={refresh} />}
        {versions.length === 0 && (
          <button className="btn btn-sm" onClick={() => setEditing({ title: '', logline: '', scenes: [] })}>
            כתוב תסריט ידנית
          </button>
        )}
      </aside>

      <div className="script-main">
        {feedbackOpen && !editing && (
          <ClientFeedbackImport
            projectId={project.id}
            versions={versions}
            running={running}
            draft={pendingImport}
            onClose={() => setFeedbackOpen(false)}
            onDone={refresh}
          />
        )}
        {editing ? (
          <ScriptEditor
            projectId={project.id}
            base={selected}
            initial={editing}
            language={project.brief.language}
            target={project.brief.durationSec}
            versions={versions}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await refresh();
            }}
          />
        ) : selected ? (
          <>
            <VersionView
              version={selected}
              isLatest={selected.id === latest?.id}
              language={project.brief.language}
              target={project.brief.durationSec}
              onEdit={() => setEditing(structuredClone(selected.content))}
              onChanged={refresh}
            />
            {fromClient && <ClientFeedbackChanges imp={fromClient} base={versions.find((v) => v.id === fromClient.baseVersionId)} result={selected} />}
            <ImproveBar projectId={project.id} version={selected} isLatest={selected.id === latest?.id} running={running} onDone={refresh} />
            {selected.id === latest?.id && (
              <ApprovalPanel version={selected} approvals={data!.approvals} running={running} onDone={refresh} clientName={project.clientName} />
            )}
            <Compare versions={versions} selected={selected} compareId={compareId} setCompareId={setCompareId} />
            <Comments projectId={project.id} version={selected} comments={data!.comments[selected.id] ?? []} onDone={reload} />
          </>
        ) : (
          !running && <Empty title="אין תסריט להצגה" />
        )}
      </div>
    </div>
  );
}

function TimingSummary({ content, language, target }: { content: ScriptContent; language: string; target: number | null }) {
  const t = computeTiming(content, language, target);
  const off = t.deviationPct !== null && Math.abs(t.deviationPct) > 15;
  return (
    <div className="row gap-s small">
      <Tag tone={off ? 'warn' : 'neutral'}>
        משך סצנות: {t.totalSec}ש׳{target ? ` / יעד ${target}ש׳` : ''}
        {t.deviationPct !== null && ` (${t.deviationPct > 0 ? '+' : ''}${t.deviationPct}%)`}
      </Tag>
      <Tag tone="neutral" title="לפי קצב דיבור משוער">
        זמן הקראה משוער: {t.narrationSec}ש׳
      </Tag>
      {t.scenes.some((s) => s.tooDense) && <Tag tone="warn">יש סצנות עם קריינות ארוכה מהמשך</Tag>}
    </div>
  );
}

/** "רץ כעת…" + ביטול המשימה (תוצאה של משימה שבוטלה באמצע לא נשמרת) */
function RunningNotice({ projectId, detail, onDone }: { projectId: string; detail: string; onDone: () => Promise<void> | void }) {
  const jobs = useApi<Job[]>(isCloud() ? null : `/api/projects/${projectId}/jobs`, { pollMs: 3000 });
  const act = useAction();
  const active = (jobs.data ?? []).find((j) => j.type.startsWith('script.') && (j.status === 'queued' || j.status === 'running'));
  const cancel = async () => {
    if (!active) return;
    const r = await act.run(() => api.post(`/api/jobs/${active.id}/cancel`));
    if (r) await Promise.all([jobs.reload(), onDone()]);
  };
  return (
    <div className="notice row between gap-s">
      <span>
        <span className="spinner" /> {detail}
      </span>
      {active && (
        <button className="btn btn-sm btn-danger-ghost" disabled={act.busy} onClick={cancel} title="עוצר את המשימה. מה שכבר נשלח ל-AI לא יישמר כגרסה.">
          ✕ בטל
        </button>
      )}
      <InlineError error={act.error} onClose={act.clearError} />
    </div>
  );
}

/** גרסאות שנמחקו — מוסתרות, ואפשר לשחזר */
function DeletedVersions({ items, onDone }: { items: NonNullable<ScriptsData['deleted']>; onDone: () => Promise<void> | void }) {
  const act = useAction();
  return (
    <details className="deleted-versions">
      <summary className="small muted">🗑 גרסאות שנמחקו ({items.length})</summary>
      <ul>
        {items.map((v) => (
          <li key={v.id} className="row between gap-s small">
            <span>
              v{v.label} <span className="muted">· {fmtDateTime(v.createdAt)}</span>
            </span>
            <button
              className="btn-link small"
              disabled={act.busy}
              onClick={async () => {
                const r = await act.run(() => api.post(`/api/scripts/${v.id}/restore`));
                if (r) await onDone();
              }}
            >
              שחזר
            </button>
          </li>
        ))}
      </ul>
      <InlineError error={act.error} onClose={act.clearError} />
    </details>
  );
}

function mostlyHebrew(c: ScriptContent) {
  const text = c.scenes.map((s) => `${s.narration} ${s.onScreenText}`).join(' ');
  const he = (text.match(/[֐-׿]/g) ?? []).length;
  const en = (text.match(/[A-Za-z]/g) ?? []).length;
  return he >= en;
}

function VersionView({
  version,
  isLatest,
  language,
  target,
  onEdit,
  onChanged,
}: {
  version: ScriptVersion;
  isLatest: boolean;
  language: string;
  target: number | null;
  onEdit: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const fin = useAction();
  const del = useAction();
  const isFinal = isLatest && (version.status === 'internal_approved' || version.status === 'client_approved');
  const chooseFinal = async () => {
    const r = await fin.run(() => api.post(`/api/scripts/${version.id}/choose-final`));
    if (r) await onChanged();
  };
  const timing = computeTiming(version.content, language, target);
  // תרגום לתצוגה בלבד: עברית ↔ אנגלית לפי השפה שבה התסריט באמת כתוב (לא לפי הבריף — שם כתוב לפעמים "עברית" לתסריט באנגלית)
  const toLang: 'he' | 'en' = mostlyHebrew(version.content) ? 'en' : 'he';
  const [translated, setTranslated] = useState<ScriptContent | null>(null);
  const tr = useAction();
  useEffect(() => setTranslated(null), [version.id]);
  const toggleTranslate = async () => {
    if (translated) return setTranslated(null);
    const r = await tr.run(() => api.post<{ content: ScriptContent }>(`/api/scripts/${version.id}/translate`, { to: toLang }));
    if (r) setTranslated(r.content);
  };
  const c = translated ?? version.content;
  const dir = translated ? (toLang === 'he' ? 'rtl' : 'ltr') : undefined;
  return (
    <section className="card">
      <div className="row between">
        <div>
          <h2>
            v{version.label} · {c.title || 'ללא כותרת'}{' '}
            {version.source === 'demo' ? <ModeTag mode="demo" /> : version.source === 'manual' ? <ModeTag mode="manual" /> : <ModeTag mode="auto" />}
          </h2>
          <div className="small muted">
            {version.provider ? (version.provider === "collab" ? version.model : `${version.provider} · ${version.model}`) : `נכתב ע"י ${version.createdBy}`} · {fmtDateTime(version.createdAt)}
            {!isLatest && ' · גרסה ישנה (לקריאה)'}
          </div>
        </div>
        <div className="row gap-s">
          {!isCloud() && (
            <button className={`btn ${translated ? 'btn-primary' : ''}`} onClick={toggleTranslate} disabled={tr.busy} title="תרגום לתצוגה בלבד — מה שנשלח ללקוח נשאר בשפת המקור">
              {tr.busy ? 'מתרגם…' : translated ? '↩ הצג מקור' : `🌐 ${toLang === 'he' ? 'תרגם לעברית' : 'Translate to English'}`}
            </button>
          )}
          {!isCloud() && (
            <a className="btn" href={`/api/scripts/${version.id}/view${translated ? `?lang=${toLang}` : ''}`} target="_blank" rel="noopener" title={translated ? 'פותח את התרגום בדפדפן — ומשם שמירה כ-PDF' : "פותח את התסריט בדפדפן, ממותג — ומשם 'שמור כ-PDF' לשליחה ללקוח"}>
              👁 פתח / PDF{translated ? ` (${toLang === 'he' ? 'עברית' : 'English'})` : ''}
            </a>
          )}
          {!isCloud() && (
            <a className="btn" href={`/api/scripts/${version.id}/docx${translated ? `?lang=${toLang}` : ''}`} download title={translated ? 'קובץ Word של התרגום' : 'קובץ Word מעוצב לשליחה ללקוח — בלי הערות פנימיות'}>
              ⬇ הורד כ-Word{translated ? ` (${toLang === 'he' ? 'עברית' : 'English'})` : ''}
            </a>
          )}
            {isFinal ? (
              <Tag tone="ok">⭐ הגרסה הסופית</Tag>
            ) : (
              <button
                className="btn"
                disabled={fin.busy}
                onClick={chooseFinal}
                title={isLatest ? 'מאשר את הגרסה הזו פנימית כגרסה הסופית' : 'יוצר עותק של הגרסה הזו כגרסה האחרונה ומאשר אותו כסופי (ההיסטוריה נשמרת)'}
              >
                ⭐ בחר כסופי
              </button>
            )}
            {version.status !== 'client_approved' && (
              <ConfirmButton
                className="btn btn-danger-ghost"
                confirmLabel="למחוק? לחץ שוב"
                disabled={del.busy}
                onConfirm={async () => {
                  const r = await del.run(() => api.del(`/api/scripts/${version.id}`));
                  if (r) await onChanged();
                }}
              >
                🗑 מחק
              </ConfirmButton>
            )}
            <button className="btn" onClick={onEdit} title="בסיום תבחר: לשמור על הגרסה הזו או כגרסה חדשה">
            ✎ ערוך
          </button>
        </div>
      </div>
      <InlineError error={tr.error} onClose={tr.clearError} />
      <InlineError error={fin.error} onClose={fin.clearError} />
      <InlineError error={del.error} onClose={del.clearError} />
      {translated && <div className="notice small">מוצג תרגום ל{toLang === 'he' ? 'עברית' : 'אנגלית'} · הכפתורים Word ו-PDF מורידים עכשיו את התרגום · "↩ הצג מקור" מחזיר למקור</div>}
      {c.logline && <p className="logline" dir={dir}>{c.logline}</p>}
      <TimingSummary content={version.content} language={language} target={target} />
      <table className="scenes-table">
        <thead>
          <tr>
            <th>#</th>
            <th>תפקיד</th>
            <th>קריינות</th>
            <th>טקסט על המסך</th>
            <th>פעולה חזותית</th>
            <th>משך</th>
            <th>הערות</th>
          </tr>
        </thead>
        <tbody>
          {c.scenes.map((s, i) => (
            <tr key={s.id}>
              <td>{i + 1}</td>
              <td>
                <Tag>{STORY_ROLE_LABELS[s.storyRole] ?? s.storyRole}</Tag>
              </td>
              <td className="narration" dir={dir}>{s.narration}</td>
              <td dir={dir}>{s.onScreenText}</td>
              <td dir={dir}>{s.visualAction}</td>
              <td className={timing.scenes[i]?.tooDense ? 'warn-text' : ''}>
                {s.estDurationSec}ש׳
                <div className="small muted">הקראה ~{timing.scenes[i]?.narrationSec}ש׳</div>
              </td>
              <td className="small" dir={dir}>{s.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ScriptEditor({
  projectId,
  base,
  initial,
  language,
  target,
  versions,
  onCancel,
  onSaved,
}: {
  projectId: string;
  versions: ScriptVersion[];
  base: ScriptVersion | null;
  initial: ScriptContent;
  language: string;
  target: number | null;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [c, setC] = useState<ScriptContent>(initial);
  const [note, setNote] = useState('');
  const act = useAction();
  const setScene = (i: number, patch: Partial<ScriptContent['scenes'][number]>) =>
    setC((x) => ({ ...x, scenes: x.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, d: number) =>
    setC((x) => {
      const s = [...x.scenes];
      const j = i + d;
      if (j < 0 || j >= s.length) return x;
      [s[i], s[j]] = [s[j], s[i]];
      return { ...x, scenes: s };
    });
  const saveNew = async () => {
    const r = await act.run(() =>
      api.post(`/api/projects/${projectId}/scripts`, { content: c, parentId: base?.id ?? null, changeNote: note }),
    );
    if (r) await onSaved();
  };
  /** שמירה על אותה גרסה (בלי ליצור גרסה חדשה) */
  const saveInPlace = async () => {
    if (!base) return;
    const r = await act.run(() => api.put(`/api/scripts/${base.id}`, { content: c, changeNote: note }));
    if (r) await onSaved();
  };
  const lockedBase = base?.status === 'client_approved';
  // תצוגה מקדימה של מספר הגרסה: שינוי קטן → v6.1, שינוי כולל בקריינות וגם בוויזואל → v7
  const next = nextScriptNumbers(versions, base, base ? scriptChangeSize(base.content, c) : 'major');
  const nextLabel = versionLabel(next.major, next.minor);
  return (
    <section className="card" data-editing="true">
      <div className="row between">
        <h2>{base ? `עריכת v${base.label}` : 'תסריט חדש (ידני)'}</h2>
        <div className="row gap-s">
          <button className="btn btn-ghost" onClick={onCancel}>
            ביטול
          </button>
          {base && (
            <button
              className="btn"
              onClick={saveInPlace}
              disabled={act.busy || c.scenes.length === 0 || lockedBase}
              title={
                lockedBase
                  ? 'הלקוח אישר את הגרסה הזו — אפשר לשמור רק כגרסה חדשה'
                  : base.status === 'internal_approved'
                    ? `מעדכן את v${base.label} עצמה. היא אושרה פנימית — אחרי השמירה תחזור לטיוטה ותצטרך לאשר שוב`
                    : `מעדכן את v${base.label} עצמה, בלי ליצור גרסה חדשה`
              }
            >
              {act.busy ? 'שומר…' : `שמור (v${base.label})`}
            </button>
          )}
          <button className="btn btn-primary" onClick={saveNew} disabled={act.busy || c.scenes.length === 0}>
            {act.busy ? 'שומר…' : `שמור כגרסה חדשה (v${nextLabel})`}
          </button>
        </div>
      </div>
      <InlineError error={act.error} onClose={act.clearError} />
      <div className="grid-2">
        <Field label="כותרת">
          <input value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} />
        </Field>
        <Field label="תיאור השינוי">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="מה שונה בגרסה הזו" />
        </Field>
      </div>
      <Field label="Logline">
        <input value={c.logline} onChange={(e) => setC({ ...c, logline: e.target.value })} />
      </Field>
      <TimingSummary content={c} language={language} target={target} />
      {c.scenes.map((s, i) => (
        <div key={s.id || i} className="scene-edit">
          <div className="row between">
            <strong>סצנה {i + 1}</strong>
            <div className="row gap-s">
              <select value={s.storyRole} onChange={(e) => setScene(i, { storyRole: e.target.value })}>
                {STORY_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {STORY_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step={0.5}
                className="num"
                value={s.estDurationSec}
                onChange={(e) => setScene(i, { estDurationSec: Number(e.target.value) || 0 })}
                title="משך בשניות"
              />
              <span className="small muted">ש׳</span>
              <button className="btn-link" onClick={() => move(i, -1)} disabled={i === 0} aria-label="למעלה">
                ↑
              </button>
              <button className="btn-link" onClick={() => move(i, 1)} disabled={i === c.scenes.length - 1} aria-label="למטה">
                ↓
              </button>
              <button className="btn-link danger-text" onClick={() => setC({ ...c, scenes: c.scenes.filter((_, j) => j !== i) })}>
                מחק
              </button>
            </div>
          </div>
          <div className="grid-2">
            <Field label="קריינות">
              <textarea rows={3} value={s.narration} onChange={(e) => setScene(i, { narration: e.target.value })} />
            </Field>
            <Field label="פעולה חזותית">
              <textarea rows={3} value={s.visualAction} onChange={(e) => setScene(i, { visualAction: e.target.value })} />
            </Field>
            <Field label="טקסט על המסך">
              <input value={s.onScreenText} onChange={(e) => setScene(i, { onScreenText: e.target.value })} />
            </Field>
            <Field label="הערות">
              <input value={s.notes} onChange={(e) => setScene(i, { notes: e.target.value })} />
            </Field>
          </div>
        </div>
      ))}
      <button
        className="btn"
        onClick={() =>
          setC({
            ...c,
            scenes: [
              ...c.scenes,
              { id: crypto.randomUUID(), storyRole: 'other', narration: '', onScreenText: '', visualAction: '', estDurationSec: 3, notes: '' },
            ],
          })
        }
      >
        + הוסף סצנה
      </button>
    </section>
  );
}

function ApprovalPanel({
  version,
  approvals,
  running,
  onDone,
  clientName,
}: {
  version: ScriptVersion;
  approvals: Approval[];
  running: boolean;
  onDone: () => Promise<void>;
  clientName: string;
}) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [clientBy, setClientBy] = useState('');
  const [changes, setChanges] = useState('');
  const [changesFrom, setChangesFrom] = useState<'internal' | 'client'>('internal');
  const lastChangeNote = approvals.find((a) => a.subjectId === version.id && a.decision === 'changes_requested')?.note ?? '';
  const [feedback, setFeedback] = useState(lastChangeNote);
  useEffect(() => setFeedback(lastChangeNote), [lastChangeNote]);
  const mine = approvals.filter((a) => a.subjectId === version.id);

  const post = async (url: string, body: object) => {
    const r = await act.run(() => api.post(url, body));
    if (r) {
      setNote('');
      setChanges('');
      await onDone();
    }
  };

  return (
    <section className="card approval">
      <h2>אישורים — v{version.label}</h2>
      <div className="gates">
        <Gate n={1} title="טיוטת AI / עריכה" done />
        <Gate n={2} title="אישור פנימי שלי" done={version.status === 'internal_approved' || version.status === 'client_approved'} />
        <Gate n={3} title="אישור לקוח" done={version.status === 'client_approved'} />
        <Gate n={4} title="מעבר לסטורי בורד" done={version.status === 'client_approved'} />
      </div>
      <InlineError error={act.error} onClose={act.clearError} />

      {(version.status === 'draft' || version.status === 'changes_requested') && (
        <div className="approval-row">
          <input placeholder="הערה לאישור (אופציונלי)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-primary" disabled={act.busy} onClick={() => post(`/api/scripts/${version.id}/approve-internal`, { note })}>
            ✓ אשר פנימית
          </button>
        </div>
      )}

      {version.status === 'internal_approved' && (
        <div className="approval-row">
          {!isCloud() && (
            <a className="btn" href={`/api/scripts/${version.id}/docx`} download>
              ⬇ Word לשליחה ללקוח
            </a>
          )}
          <span className="small">שלח את התסריט ללקוח. לאחר שאישר:</span>
          <input placeholder={`מי אישר מטעם ${clientName || 'הלקוח'}`} value={clientBy} onChange={(e) => setClientBy(e.target.value)} />
          <input placeholder="הערה / ערוץ (מייל, וואטסאפ…)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-primary"
            disabled={act.busy || !clientBy.trim()}
            onClick={() => post(`/api/scripts/${version.id}/client-approval`, { approvedBy: clientBy, note })}
          >
            ✓ סמן אישור לקוח
          </button>
        </div>
      )}

      {version.status === 'client_approved' && (
        <div className="notice ok">התסריט אושר ע"י הלקוח. יצירת הסטורי בורד מופעלת אוטומטית (אם הוגדר בפרויקט).</div>
      )}

      {version.status !== 'client_approved' && (
        <details className="approval-more">
          <summary>בקשת שינויים</summary>
          <div className="approval-row">
            <select value={changesFrom} onChange={(e) => setChangesFrom(e.target.value as 'internal' | 'client')}>
              <option value="internal">משוב פנימי</option>
              <option value="client">משוב לקוח</option>
            </select>
            <input placeholder="מה צריך לשנות" value={changes} onChange={(e) => setChanges(e.target.value)} />
            <button
              className="btn"
              disabled={act.busy || !changes.trim()}
              onClick={() => post(`/api/scripts/${version.id}/request-changes`, { from: changesFrom, note: changes, by: changesFrom === 'client' ? clientBy : undefined })}
            >
              סמן "נדרשים שינויים"
            </button>
          </div>
        </details>
      )}

      <details className="approval-more" open={version.status === 'changes_requested'}>
        <summary>יצירת גרסה מתוקנת ב-AI לפי משוב</summary>
        <textarea rows={3} placeholder="המשוב שיישלח למודל" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        <div className="row end">
          <button
            className="btn"
            disabled={act.busy || running || !feedback.trim()}
            onClick={() => post(`/api/scripts/${version.id}/revise`, { feedback })}
          >
            צור גרסה מתוקנת
          </button>
        </div>
      </details>

      {mine.length > 0 && (
        <ul className="approval-log small">
          {mine.map((a) => (
            <li key={a.id}>
              {fmtDateTime(a.createdAt)} · {a.kind === 'client' ? 'לקוח' : 'פנימי'} · {a.decision === 'approved' ? '✓ אושר' : '↺ שינויים'} · {a.by}
              {a.note && ` — ${a.note}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Gate({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <div className={`gate ${done ? 'gate-done' : ''}`}>
      <span className="gate-n">{done ? '✓' : n}</span> {title}
    </div>
  );
}

function Compare({
  versions,
  selected,
  compareId,
  setCompareId,
}: {
  versions: ScriptVersion[];
  selected: ScriptVersion;
  compareId: string;
  setCompareId: (id: string) => void;
}) {
  const other = versions.find((v) => v.id === compareId);
  const diff = useMemo(() => (other ? diffScripts(other.content, selected.content) : []), [other, selected]);
  if (versions.length < 2) return null;
  return (
    <section className="card">
      <div className="row between">
        <h2>השוואת גרסאות</h2>
        <select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
          <option value="">השווה את v{selected.label} מול…</option>
          {versions
            .filter((v) => v.id !== selected.id)
            .map((v) => (
              <option key={v.id} value={v.id}>
                v{v.label}
              </option>
            ))}
        </select>
      </div>
      {other && (
        <table className="diff-table">
          <thead>
            <tr>
              <th>#</th>
              <th>v{other.label}</th>
              <th>v{selected.label}</th>
            </tr>
          </thead>
          <tbody>
            {diff.map((d) => (
              <tr key={d.index} className={`diff-${d.status}`}>
                <td>{d.index + 1}</td>
                <td>{d.before ? <SceneCell s={d.before} fields={d.fields} /> : <span className="muted">—</span>}</td>
                <td>{d.after ? <SceneCell s={d.after} fields={d.fields} /> : <span className="muted">נמחקה</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SceneCell({ s, fields }: { s: ScriptContent['scenes'][number]; fields: string[] }) {
  const hl = (f: string) => (fields.includes(f) ? 'diff-hl' : '');
  return (
    <div className="small">
      <div className={hl('narration')}>🎙 {s.narration}</div>
      <div className={hl('visualAction')}>🎬 {s.visualAction}</div>
      {s.onScreenText && <div className={hl('onScreenText')}>🅣 {s.onScreenText}</div>}
      <div className={`muted ${hl('estDurationSec')}`}>{s.estDurationSec}ש׳</div>
    </div>
  );
}

function Comments({
  projectId,
  version,
  comments,
  onDone,
}: {
  projectId: string;
  version: ScriptVersion;
  comments: Comment[];
  onDone: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const act = useAction();
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await act.run(() =>
      api.post(`/api/projects/${projectId}/comments`, { subjectType: 'script_version', subjectId: version.id, text }),
    );
    if (r) {
      setText('');
      await onDone();
    }
  };
  return (
    <section className="card">
      <h2>הערות ל-v{version.label}</h2>
      {comments.length === 0 && <div className="muted small">אין הערות</div>}
      <ul className="comments">
        {comments.map((c) => (
          <li key={c.id}>
            <span className="small muted">
              {c.author} · {fmtDateTime(c.createdAt)}
            </span>
            <div>{c.text}</div>
          </li>
        ))}
      </ul>
      <form className="approval-row" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="הוסף הערה…" />
        <button className="btn" disabled={act.busy || !text.trim()}>
          הוסף
        </button>
      </form>
      <InlineError error={act.error} />
    </section>
  );
}

/** "שפר עם ChatGPT / Claude": מודל אחד עובר על כל התסריט כבמאי ומחזיר גרסה משופרת. הערה אופציונלית מכוונת אותו. */
function ImproveBar({
  projectId,
  version,
  isLatest,
  running,
  onDone,
}: {
  projectId: string;
  version: ScriptVersion;
  isLatest: boolean;
  running: boolean;
  onDone: () => Promise<void> | void;
}) {
  const act = useAction();
  const [note, setNote] = useState('');
  // קובץ שמצורף להנחיה (Word / טקסט) — הטקסט שלו נשלח יחד עם ההנחיה
  const [doc, setDoc] = useState<{ name: string; text: string; truncated: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useAction();
  useEffect(() => {
    setDoc(null);
  }, [version.id]);
  // ההנחיה האחרונה שנשלחה לשיפור (נשמרת בשרת עם המשימה) — כדי שלא תיעלם אחרי השליחה
  const jobs = useApi<Job[]>(isCloud() ? null : `/api/projects/${projectId}/jobs`, { pollMs: running ? 4000 : 0 });
  const last = (jobs.data ?? []).find((j) => j.type === 'script.revise' && j.payload.improveBy && String(j.payload.feedback ?? '').trim());
  const [showAll, setShowAll] = useState(false);
  const go = async (by: 'openai' | 'claude') => {
    const r = await act.run(() => api.post(`/api/scripts/${version.id}/improve`, { by, note, doc }));
    if (r) {
      setNote('');
      setDoc(null);
      await Promise.all([onDone(), jobs.reload()]);
    }
  };
  return (
    <section className="card stack">
      <div className="row gap-s improve-row">
        <textarea
          className="grow"
          rows={note.length > 90 ? 4 : 2}
          placeholder="שיפור כללי של כל התסריט — אפשר לכוון (למשל: הוק חזק יותר, ניסוח טבעי יותר)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {!isCloud() && (
          <>
            <button className="btn btn-ghost" disabled={upload.busy} onClick={() => fileRef.current?.click()} title="מצרף Word, טקסט או Markdown — הטקסט שלו נשלח עם ההנחיה">
              📎 צרף קובץ
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".docx,.txt,.md,.markdown,.csv"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const r = await upload.run(() => api.upload<{ name: string; text: string; truncated: boolean }>('/api/doc-text', f));
                if (r) setDoc(r);
              }}
            />
          </>
        )}
        <button className="btn" disabled={act.busy || running} onClick={() => go('openai')} title="ChatGPT עובר על התסריט ומשפר — נוצרת גרסה חדשה">
          ✨ שפר עם ChatGPT
        </button>
        <button className="btn btn-ghost" disabled={act.busy || running} onClick={() => go('claude')}>
          שפר עם Claude
        </button>
      </div>
      {!isLatest && <div className="small muted">משפר את v{version.label} — תיווצר ממנה גרסה חדשה (הגרסאות האחרות לא משתנות)</div>}
      {doc && (
        <div className="row gap-s small attached-doc">
          <Tag tone="info">📎 {doc.name}</Tag>
          <span className="muted">
            {doc.text.length.toLocaleString('he-IL')} תווים{doc.truncated ? ' (נחתך ל-15,000)' : ''} · יישלח עם ההנחיה
          </span>
          <button className="btn-link small" onClick={() => setDoc(null)}>
            הסר
          </button>
        </div>
      )}
      <InlineError error={upload.error} onClose={upload.clearError} />
      {last && (
        <div className="last-note small">
          <div className="row between wrap gap-s">
            <span className="muted">
              ההנחיה האחרונה · {last.payload.improveBy === 'openai' ? 'ChatGPT' : 'Claude'} · {fmtDateTime(last.createdAt)}
            </span>
            <span className="row gap-s">
              <button className="btn-link small" onClick={() => setShowAll((x) => !x)}>
                {showAll ? 'הצג פחות' : 'הצג הכול'}
              </button>
              <button className="btn btn-sm" onClick={() => setNote(String(last.payload.feedback))} title="מעתיק את ההנחיה לתיבה — אפשר לערוך ולשלוח שוב">
                ↺ השתמש שוב
              </button>
            </span>
          </div>
          <div className={showAll ? 'last-note-text' : 'last-note-text clamp-2'}>{String(last.payload.feedback)}</div>
        </div>
      )}
      <InlineError error={act.error} onClose={act.clearError} />
    </section>
  );
}
