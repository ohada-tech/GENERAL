import { STAGE_BY_KEY, STATUS_LABELS, type DashboardData, type Project, type Status } from '@apos/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PipelineStepper } from '../components/PipelineStepper';
import { Empty, ErrorBox, Field, InlineError, Loading, Modal, Progress, StatusBadge } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import { daysUntil, fmtDate, fmtRelative } from '../lib/format';

const FILTERS: Array<{ key: 'all' | Status | 'mine'; label: string }> = [
  { key: 'all', label: 'הכל' },
  { key: 'mine', label: 'ממתין לי' },
  { key: 'blocked', label: 'חסומים' },
  { key: 'in_progress', label: 'בתהליך' },
  { key: 'completed', label: 'הושלמו' },
];

export function Dashboard() {
  const { data, error, loading, reload } = useApi<DashboardData>('/api/dashboard', { pollMs: 5000 });
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');

  const projects = data?.projects ?? [];
  const myActions = useMemo(
    () =>
      projects.flatMap((p) =>
        p.state.myActions
          .filter((a) => a.kind !== 'task' || a.stage === p.state.currentStage)
          .map((a) => ({ ...a, project: p })),
      ),
    [projects],
  );
  const blockers = useMemo(() => projects.flatMap((p) => p.state.blockers.map((b) => ({ ...b, project: p }))), [projects]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of projects) c[p.state.overallStatus] = (c[p.state.overallStatus] ?? 0) + 1;
    return c;
  }, [projects]);

  const filtered = projects.filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'mine') return p.state.myActions.some((a) => a.kind !== 'task');
    if (filter === 'in_progress') return !['blocked', 'completed', 'not_started'].includes(p.state.overallStatus);
    return p.state.overallStatus === filter;
  });

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>הפקות</h1>
          <p className="muted">מה הושלם, מה מתבצע, מה ממתין לך ומה תקוע.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + פרויקט חדש
        </button>
      </div>

      <div className="kpis">
        <Kpi label="פרויקטים" value={projects.length} />
        <Kpi label="ממתינים לאישור שלי" value={myActions.filter((a) => a.kind === 'approval').length} tone="warn" />
        <Kpi label="ממתינים ללקוח" value={counts.waiting_client ?? 0} tone="info" />
        <Kpi label="חסמים" value={blockers.length} tone={blockers.length ? 'danger' : undefined} />
        <Kpi label="הושלמו" value={counts.completed ?? 0} tone="ok" />
      </div>

      <div className="dash-grid">
        <section className="card">
          <h2>מה ממתין לי עכשיו</h2>
          {myActions.length === 0 ? (
            <div className="muted">אין פעולות פתוחות 🎉</div>
          ) : (
            <ul className="action-list">
              {myActions.slice(0, 12).map((a, i) => (
                <li key={i}>
                  <Link to={`/projects/${a.project.id}/${a.tab}`} className={`action action-${a.kind}`}>
                    <span className="action-kind">{a.kind === 'approval' ? 'אישור' : a.kind === 'fix' ? 'תיקון' : 'משימה'}</span>
                    <span className="action-label">{a.label}</span>
                    <span className="muted small">{a.project.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>חסמים ובעיות</h2>
          {blockers.length === 0 ? (
            <div className="muted">אין חסמים פתוחים</div>
          ) : (
            <ul className="action-list">
              {blockers.map((b, i) => (
                <li key={i}>
                  <Link to={`/projects/${b.project.id}`} className="action action-fix">
                    <span className="action-kind">{STAGE_BY_KEY[b.stage]?.label}</span>
                    <span className="action-label">{b.reason}</span>
                    <span className="muted small">{b.project.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f.key} className={`chip ${filter === f.key ? 'chip-on' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {projects.length === 0 ? (
        <Empty title="אין עדיין פרויקטים">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            פתח פרויקט ראשון
          </button>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty title="אין פרויקטים בסינון הזה" />
      ) : (
        <div className="table-wrap">
          <table className="projects-table">
            <thead>
              <tr>
                <th>פרויקט</th>
                <th>שלב נוכחי</th>
                <th>Pipeline</th>
                <th>התקדמות</th>
                <th>סטטוס</th>
                <th>הפעולה הבאה</th>
                <th>יעד</th>
                <th>עדכון אחרון</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const due = daysUntil(p.dueDate);
                const current = STAGE_BY_KEY[p.state.currentStage];
                return (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/projects/${p.id}`} className="proj-name">
                        {p.name}
                      </Link>
                      <div className="muted small">{p.clientName || '—'}</div>
                    </td>
                    <td>
                      {current.number} {current.label}
                    </td>
                    <td>
                      <PipelineStepper state={p.state} compact />
                    </td>
                    <td style={{ minWidth: 110 }}>
                      <Progress value={p.state.progress} />
                    </td>
                    <td>
                      <StatusBadge status={p.state.overallStatus} />
                      {p.state.pipelineState !== 'active' && (
                        <div className="small muted">{p.state.pipelineState === 'paused' ? 'מושהה' : 'עצור'}</div>
                      )}
                      {p.state.blockers.length > 0 && <div className="small danger-text">{p.state.blockers.length} חסמים</div>}
                    </td>
                    <td className="next-cell">
                      {p.state.nextAction ? (
                        <Link to={`/projects/${p.id}/${p.state.nextAction.tab}`}>{p.state.nextAction.label}</Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={due !== null && due < 0 ? 'danger-text' : due !== null && due <= 3 ? 'warn-text' : ''}>
                      {fmtDate(p.dueDate)}
                      {due !== null && <div className="small muted">{due < 0 ? `באיחור ${-due} ימים` : `עוד ${due} ימים`}</div>}
                    </td>
                    <td className="muted small">{fmtRelative(p.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="legend muted small">
        {Object.entries(STATUS_LABELS).map(([k, v]) => (
          <span key={k}>
            <StatusBadge status={k} /> {v.en}
          </span>
        ))}
      </div>

      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`}>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const { busy, error, run } = useAction();
  const navigate = useNavigate();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = await run(() => api.post<Project>('/api/projects', { name, clientName }));
    if (p) navigate(`/projects/${p.id}/brief`);
  };
  return (
    <Modal title="פרויקט חדש" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Field label="שם הפרויקט" required>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="לקוח">
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </Field>
        <InlineError error={error} />
        <div className="row end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ביטול
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'יוצר…' : 'צור והמשך לאפיון'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
