import {
  computeTiming,
  diffScripts,
  SCRIPT_STATUS_LABELS,
  STORY_ROLE_LABELS,
  STORY_ROLES,
  type Approval,
  type Comment,
  type ScriptContent,
  type ScriptVersion,
} from '@apos/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Field, InlineError, Loading, ModeTag, StatusBadge, Tag } from '../components/ui';
import { api, isCloud, useAction, useApi } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import type { TabProps } from './ProjectPage';

interface ScriptsData {
  versions: ScriptVersion[];
  approvals: Approval[];
  comments: Record<string, Comment[]>;
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

  const versions = data?.versions ?? [];
  const latest = versions[0] ?? null;
  const selected = versions.find((v) => v.id === selectedId) ?? latest;

  // כשנוצרת גרסה חדשה — עבור אליה אוטומטית
  const latestId = latest?.id;
  useEffect(() => {
    setSelectedId(null);
  }, [latestId]);

  const refresh = async () => {
    await Promise.all([reload(), reloadProject()]);
  };

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
        <InlineError error={gen.error} onClose={gen.clearError} />
        {running && (
          <div className="notice">
            <span className="spinner" /> {scriptStage.detail}
          </div>
        )}
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
                  <strong>v{v.version}</strong>
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
        {versions.length === 0 && (
          <button className="btn btn-sm" onClick={() => setEditing({ title: '', logline: '', scenes: [] })}>
            כתוב תסריט ידנית
          </button>
        )}
      </aside>

      <div className="script-main">
        {editing ? (
          <ScriptEditor
            projectId={project.id}
            base={selected}
            initial={editing}
            language={project.brief.language}
            target={project.brief.durationSec}
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
            />
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

function VersionView({
  version,
  isLatest,
  language,
  target,
  onEdit,
}: {
  version: ScriptVersion;
  isLatest: boolean;
  language: string;
  target: number | null;
  onEdit: () => void;
}) {
  const c = version.content;
  const timing = computeTiming(c, language, target);
  return (
    <section className="card">
      <div className="row between">
        <div>
          <h2>
            v{version.version} · {c.title || 'ללא כותרת'}{' '}
            {version.source === 'demo' ? <ModeTag mode="demo" /> : version.source === 'manual' ? <ModeTag mode="manual" /> : <ModeTag mode="auto" />}
          </h2>
          <div className="small muted">
            {version.provider ? (version.provider === "collab" ? version.model : `${version.provider} · ${version.model}`) : `נכתב ע"י ${version.createdBy}`} · {fmtDateTime(version.createdAt)}
            {!isLatest && ' · גרסה ישנה (לקריאה)'}
          </div>
        </div>
        <div className="row gap-s">
          {!isCloud() && (
            <a className="btn" href={`/api/scripts/${version.id}/docx`} download title="קובץ Word מעוצב לשליחה ללקוח — בלי הערות פנימיות">
              ⬇ הורד כ-Word
            </a>
          )}
          <button className="btn" onClick={onEdit} title="עריכה תישמר כגרסה חדשה">
            ✎ ערוך (גרסה חדשה)
          </button>
        </div>
      </div>
      {c.logline && <p className="logline">{c.logline}</p>}
      <TimingSummary content={c} language={language} target={target} />
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
              <td className="narration">{s.narration}</td>
              <td>{s.onScreenText}</td>
              <td>{s.visualAction}</td>
              <td className={timing.scenes[i]?.tooDense ? 'warn-text' : ''}>
                {s.estDurationSec}ש׳
                <div className="small muted">הקראה ~{timing.scenes[i]?.narrationSec}ש׳</div>
              </td>
              <td className="small">{s.notes}</td>
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
  onCancel,
  onSaved,
}: {
  projectId: string;
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
  const save = async () => {
    const r = await act.run(() =>
      api.post(`/api/projects/${projectId}/scripts`, { content: c, parentId: base?.id ?? null, changeNote: note }),
    );
    if (r) await onSaved();
  };
  return (
    <section className="card">
      <div className="row between">
        <h2>{base ? `עריכה על בסיס v${base.version} → גרסה חדשה` : 'תסריט חדש (ידני)'}</h2>
        <div className="row gap-s">
          <button className="btn btn-ghost" onClick={onCancel}>
            ביטול
          </button>
          <button className="btn btn-primary" onClick={save} disabled={act.busy || c.scenes.length === 0}>
            {act.busy ? 'שומר…' : 'שמור כגרסה חדשה'}
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
      <h2>אישורים — v{version.version}</h2>
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
          <option value="">השווה את v{selected.version} מול…</option>
          {versions
            .filter((v) => v.id !== selected.id)
            .map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version}
              </option>
            ))}
        </select>
      </div>
      {other && (
        <table className="diff-table">
          <thead>
            <tr>
              <th>#</th>
              <th>v{other.version}</th>
              <th>v{selected.version}</th>
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
      <h2>הערות ל-v{version.version}</h2>
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
