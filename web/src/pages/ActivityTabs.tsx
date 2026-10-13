import { JOB_LABELS, type Job, type JobAttempt, type ProjectEvent } from '@apos/shared';
import { Fragment, useState } from 'react';
import { Empty, ErrorBox, InlineError, Loading, ModeTag, Tag } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import type { TabProps } from './ProjectPage';

const EVENT_GROUPS: Record<string, string> = {
  project: 'פרויקט',
  brief: 'אפיון',
  script: 'תסריט',
  storyboard: 'סטורי בורד',
  shot: 'שוט',
  reference: 'רפרנס',
  job: 'משימה',
  pipeline: 'Pipeline',
  blocker: 'חסם',
  comment: 'הערה',
  asset: 'קובץ',
};

export function ActivityTab({ detail }: TabProps) {
  const { data, error, loading, reload } = useApi<ProjectEvent[]>(`/api/projects/${detail.project.id}/events`, { pollMs: 5000 });
  const [group, setGroup] = useState('');
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const events = (data ?? []).filter((e) => !group || e.type.startsWith(`${group}.`));
  return (
    <section className="card">
      <div className="row between">
        <h2>היסטוריית פעילות</h2>
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">כל האירועים</option>
          {Object.entries(EVENT_GROUPS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {events.length === 0 ? (
        <Empty title="אין אירועים" />
      ) : (
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id} className={`tl-${e.type.split('.')[0]} ${e.type.endsWith('failed') ? 'tl-error' : ''}`}>
              <span className="tl-time">{fmtDateTime(e.createdAt)}</span>
              <span className="tl-actor">{e.actor}</span>
              <span className="tl-msg">{e.message}</span>
              <code className="tl-type">{e.type}</code>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

type JobWithLog = Job & { attemptLog: JobAttempt[] };

const JOB_STATUS: Record<string, [string, string]> = {
  queued: ['בתור', 'neutral'],
  running: ['רץ', 'info'],
  succeeded: ['הצליח', 'ok'],
  failed: ['נכשל', 'danger'],
  cancelled: ['בוטל', 'neutral'],
};

export function JobsTab({ detail, reload: reloadProject }: TabProps) {
  const { data, error, loading, reload } = useApi<JobWithLog[]>(`/api/projects/${detail.project.id}/jobs`, { pollMs: 3000 });
  const act = useAction();
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const jobs = data ?? [];

  const doAct = async (url: string) => {
    const r = await act.run(() => api.post(url));
    if (r) await Promise.all([reload(), reloadProject()]);
  };

  return (
    <section className="card">
      <h2>משימות אוטומטיות והרצות</h2>
      <p className="small muted">
        כל משימה מתועדת עם ניסיונות ושגיאות. משימות שנכשלו בשגיאה זמנית מנוסות שוב אוטומטית (עד {jobs[0]?.maxAttempts ?? 3} ניסיונות). ניסיון
        חוזר ידני יוצר משימה חדשה ושומר את הלוג של הקודמת.
      </p>
      <InlineError error={act.error} onClose={act.clearError} />
      {jobs.length === 0 ? (
        <Empty title="עדיין לא הורצו משימות" />
      ) : (
        <table className="simple-table">
          <thead>
            <tr>
              <th>משימה</th>
              <th>מצב</th>
              <th>ביצוע</th>
              <th>ניסיונות</th>
              <th>נוצרה</th>
              <th>הסתיימה</th>
              <th>שגיאה אחרונה</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const [label, tone] = JOB_STATUS[j.status];
              return (
                <Fragment key={j.id}>
                  <tr>
                    <td>
                      <button className="btn-link" onClick={() => setOpen(open === j.id ? null : j.id)}>
                        {open === j.id ? '▾' : '▸'} {JOB_LABELS[j.type] ?? j.type}
                      </button>
                    </td>
                    <td>
                      <Tag tone={tone}>{label}</Tag>
                      {j.status === 'queued' && j.attempts > 0 && <div className="small muted">ניסיון הבא: {fmtDateTime(j.runAfter)}</div>}
                    </td>
                    <td>
                      <ModeTag mode={j.mode === 'manual' ? 'manual' : 'auto'} />
                    </td>
                    <td>
                      {j.attempts}/{j.maxAttempts}
                    </td>
                    <td className="small">{fmtDateTime(j.createdAt)}</td>
                    <td className="small">{fmtDateTime(j.finishedAt)}</td>
                    <td className="small danger-text">{j.lastError}</td>
                    <td>
                      {(j.status === 'failed' || j.status === 'cancelled') && (
                        <button className="btn btn-sm" disabled={act.busy} onClick={() => doAct(`/api/jobs/${j.id}/retry`)}>
                          נסה שוב
                        </button>
                      )}
                      {(j.status === 'queued' || j.status === 'running') && (
                        <button className="btn btn-sm btn-ghost" disabled={act.busy} onClick={() => doAct(`/api/jobs/${j.id}/cancel`)}>
                          בטל
                        </button>
                      )}
                    </td>
                  </tr>
                  {open === j.id && (
                    <tr className="sub-row">
                      <td colSpan={8}>
                        <div className="small">
                          <div>
                            <strong>מפתח ייחודי:</strong> <code>{j.idempotencyKey}</code>
                          </div>
                          {j.result && (
                            <div>
                              <strong>תוצאה:</strong> <code>{JSON.stringify(j.result)}</code>
                            </div>
                          )}
                          <strong>לוג ניסיונות:</strong>
                          {j.attemptLog.length === 0 ? (
                            <div className="muted">אין ניסיונות עדיין</div>
                          ) : (
                            <ul>
                              {j.attemptLog.map((a) => (
                                <li key={a.id}>
                                  #{a.attempt} · {fmtDateTime(a.startedAt)} → {a.finishedAt ? fmtDateTime(a.finishedAt) : 'לא הסתיים'} ·{' '}
                                  {a.ok === null ? '…' : a.ok ? '✓ הצליח' : `✕ ${a.error}`}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
