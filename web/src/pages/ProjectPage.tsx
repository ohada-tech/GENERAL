import {
  STAGE_BY_KEY,
  STAGES,
  STATUS_LABELS,
  type Approval,
  type Asset,
  type Project,
  type ProjectState,
  type StageKey,
} from '@apos/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Health } from '../App';
import { PipelineStepper } from '../components/PipelineStepper';
import { ErrorBox, Field, InlineError, Loading, ModeTag, Modal, Progress, StatusBadge } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import { fmtDate, fmtDateTime } from '../lib/format';
import { ActivityTab, JobsTab } from './ActivityTabs';
import { BriefTab } from './BriefTab';
import { ScriptTab } from './ScriptTab';
import { SettingsTab } from './SettingsTab';
import { StoryboardTab } from './StoryboardTab';

export interface ProjectDetail {
  project: Project;
  state: ProjectState;
  approvals: Approval[];
  assets: Asset[];
}

export interface TabProps {
  detail: ProjectDetail;
  reload: () => Promise<void>;
  health: Health | null;
}

const TABS: Array<{ key: string; label: string }> = [
  { key: 'overview', label: 'סקירה' },
  { key: 'brief', label: '01 אפיון' },
  { key: 'script', label: '02 תסריט' },
  { key: 'storyboard', label: '03–04 סטורי בורד ורפרנסים' },
  { key: 'activity', label: 'היסטוריה' },
  { key: 'jobs', label: 'משימות והרצות' },
  { key: 'settings', label: 'הגדרות' },
];

const STAGE_TAB: Partial<Record<StageKey, string>> = {
  brief: 'brief',
  script: 'script',
  storyboard: 'storyboard',
  references: 'storyboard',
};

export function ProjectPage({ health }: { health: Health | null }) {
  const { id, tab = 'overview' } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<ProjectDetail>(`/api/projects/${id}`, { pollMs: 3000 });
  const pipeline = useAction();
  const [confirmStop, setConfirmStop] = useState(false);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const { project, state } = data;

  const setPipeline = async (action: 'pause' | 'resume' | 'stop') => {
    await pipeline.run(() => api.post(`/api/projects/${project.id}/pipeline`, { action }));
    setConfirmStop(false);
    void reload();
  };

  const props: TabProps = { detail: data, reload, health };

  return (
    <div className="page">
      <div className="crumbs">
        <Link to="/">הפקות</Link> / <span>{project.name}</span>
      </div>
      <div className="page-head">
        <div>
          <h1>
            {project.name} <StatusBadge status={state.overallStatus} />
            {state.pipelineState === 'paused' && <span className="badge st-waiting_internal">מושהה</span>}
            {state.pipelineState === 'stopped' && <span className="badge st-blocked">עצור</span>}
          </h1>
          <p className="muted">
            {project.clientName || 'ללא לקוח'} · יעד: {fmtDate(project.brief.dueDate)} · עדכון אחרון:{' '}
            {fmtDateTime(project.updatedAt)}
          </p>
        </div>
        <div className="row gap-s">
          <div style={{ width: 160 }}>
            <Progress value={state.progress} />
          </div>
          {state.pipelineState === 'active' ? (
            <>
              <button className="btn" disabled={pipeline.busy} onClick={() => setPipeline('pause')} title="משימות לא ירוצו עד להפעלה מחדש">
                ⏸ השהה
              </button>
              <button className="btn btn-danger-ghost" disabled={pipeline.busy} onClick={() => setConfirmStop(true)}>
                ⏹ עצור
              </button>
            </>
          ) : (
            <button className="btn btn-primary" disabled={pipeline.busy} onClick={() => setPipeline('resume')}>
              ▶ הפעל מחדש
            </button>
          )}
        </div>
      </div>
      <InlineError error={pipeline.error} onClose={pipeline.clearError} />

      <PipelineStepper
        state={state}
        onSelect={(k) => navigate(`/projects/${project.id}/${STAGE_TAB[k] ?? 'overview'}`)}
      />

      {state.nextAction && (
        <Link to={`/projects/${project.id}/${state.nextAction.tab}`} className={`next-banner action-${state.nextAction.kind}`}>
          <span className="next-label">הפעולה הבאה:</span> {state.nextAction.label} ←
        </Link>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <Link key={t.key} to={`/projects/${project.id}/${t.key}`} className={`tab ${tab === t.key ? 'tab-on' : ''}`}>
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="tab-body">
        {tab === 'overview' && <OverviewTab {...props} />}
        {tab === 'brief' && <BriefTab {...props} />}
        {tab === 'script' && <ScriptTab {...props} />}
        {tab === 'storyboard' && <StoryboardTab {...props} />}
        {tab === 'activity' && <ActivityTab {...props} />}
        {tab === 'jobs' && <JobsTab {...props} />}
        {tab === 'settings' && <SettingsTab {...props} />}
      </div>

      {confirmStop && (
        <Modal title="לעצור את ה-Pipeline?" onClose={() => setConfirmStop(false)}>
          <p>משימות בתור או בריצה יבוטלו, ולא יופעלו משימות אוטומטיות עד להפעלה מחדש. תוצרים קיימים לא יימחקו.</p>
          <div className="row end">
            <button className="btn btn-ghost" onClick={() => setConfirmStop(false)}>
              ביטול
            </button>
            <button className="btn btn-danger" onClick={() => setPipeline('stop')} disabled={pipeline.busy}>
              עצור Pipeline
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function OverviewTab({ detail, reload }: TabProps) {
  const { project, state, approvals } = detail;
  const [blocking, setBlocking] = useState(false);
  const act = useAction();

  const resolve = async (bid: string) => {
    await act.run(() => api.post(`/api/blockers/${bid}/resolve`));
    void reload();
  };

  return (
    <div className="overview">
      <section className="card">
        <h2>שלבי ההפקה</h2>
        <table className="stage-table">
          <tbody>
            {state.stages.map((s) => {
              const def = STAGE_BY_KEY[s.key];
              const tab = STAGE_TAB[s.key];
              return (
                <tr key={s.key} className={s.key === state.currentStage ? 'row-current' : ''}>
                  <td className="muted">{def.number}</td>
                  <td>
                    {tab ? <Link to={`/projects/${project.id}/${tab}`}>{def.label}</Link> : def.label}
                    <div className="small muted">{def.labelEn}</div>
                  </td>
                  <td>
                    {s.availability === 'planned' ? <ModeTag mode="planned" /> : <StatusBadge status={s.status} />}
                  </td>
                  <td className="small">{s.detail}</td>
                  <td className="small">
                    {s.milestones.map((m, i) => (
                      <div key={i} className={m.done ? 'ms-done' : 'ms-open'}>
                        {m.done ? '✓' : '○'} {m.label}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="dash-grid">
        <section className="card">
          <h2>ממתין לי</h2>
          {state.myActions.length === 0 ? (
            <div className="muted">אין פעולות פתוחות</div>
          ) : (
            <ul className="action-list">
              {state.myActions.map((a, i) => (
                <li key={i}>
                  <Link to={`/projects/${project.id}/${a.tab}`} className={`action action-${a.kind}`}>
                    <span className="action-kind">{a.kind === 'approval' ? 'אישור' : a.kind === 'fix' ? 'תיקון' : 'משימה'}</span>
                    <span className="action-label">{a.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="row between">
            <h2>חסמים</h2>
            <button className="btn btn-sm" onClick={() => setBlocking(true)}>
              + סמן חסם
            </button>
          </div>
          <InlineError error={act.error} onClose={act.clearError} />
          {state.blockers.length === 0 ? (
            <div className="muted">אין חסמים</div>
          ) : (
            <ul className="action-list">
              {state.blockers.map((b, i) => (
                <li key={i} className="action action-fix">
                  <span className="action-kind">{STAGE_BY_KEY[b.stage].label}</span>
                  <span className="action-label">{b.reason}</span>
                  {b.id ? (
                    <button className="btn btn-sm" onClick={() => resolve(b.id!)} disabled={act.busy}>
                      הוסר
                    </button>
                  ) : b.source === 'job' ? (
                    <Link to={`/projects/${project.id}/jobs`} className="small">
                      למשימות
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <h2>יומן אישורים</h2>
        {approvals.length === 0 ? (
          <div className="muted">עדיין לא נרשמו אישורים</div>
        ) : (
          <table className="simple-table">
            <thead>
              <tr>
                <th>מתי</th>
                <th>מה</th>
                <th>סוג</th>
                <th>החלטה</th>
                <th>מי</th>
                <th>הערה</th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDateTime(a.createdAt)}</td>
                  <td>{{ script_version: 'תסריט', storyboard: 'סטורי בורד', shot: 'שוט' }[a.subjectType] ?? a.subjectType}</td>
                  <td>{{ internal: 'פנימי', client: 'לקוח', qc: 'בקרת איכות' }[a.kind]}</td>
                  <td>{a.decision === 'approved' ? '✓ אושר' : '↺ נדרשים שינויים'}</td>
                  <td>{a.by}</td>
                  <td className="small">{a.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card muted small">
        <strong>מקרא מצבי עבודה: </strong>
        <ModeTag mode="auto" /> מבוצע ע"י אינטגרציה אמיתית · <ModeTag mode="manual" /> מבוצע ידנית ·{' '}
        <ModeTag mode="demo" /> תוכן הדגמה · <ModeTag mode="planned" /> שלב שטרם נבנה. סטטוסים:{' '}
        {STAGES.length} שלבים, {Object.keys(STATUS_LABELS).length} מצבים.
      </section>

      {blocking && <BlockerModal projectId={project.id} onClose={() => setBlocking(false)} onDone={reload} />}
    </div>
  );
}

function BlockerModal({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [stage, setStage] = useState<StageKey>('brief');
  const [reason, setReason] = useState('');
  const act = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await act.run(() => api.post(`/api/projects/${projectId}/blockers`, { stage, reason }));
    if (r) {
      await onDone();
      onClose();
    }
  };
  return (
    <Modal title="סימון חסם" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Field label="שלב">
          <select value={stage} onChange={(e) => setStage(e.target.value as StageKey)}>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.number} {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="סיבה" required>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: ממתינים ללוגו מהלקוח" />
        </Field>
        <InlineError error={act.error} />
        <div className="row end">
          <button className="btn btn-primary" disabled={act.busy || !reason.trim()}>
            שמור חסם
          </button>
        </div>
      </form>
    </Modal>
  );
}
