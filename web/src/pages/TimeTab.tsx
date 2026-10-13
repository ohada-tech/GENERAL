import {
  formatClock,
  formatDuration,
  STAGE_BY_KEY,
  STAGES,
  type StageKey,
  type TimeEntry,
  type TimeSummary,
} from '@apos/shared';
import { useEffect, useState } from 'react';
import { ConfirmButton, Empty, ErrorBox, Field, InlineError, Loading, Tag } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import { fmtDate, fmtDateTime } from '../lib/format';
import { useTimer } from '../lib/timer';
import type { TabProps } from './ProjectPage';

interface TimeData {
  summary: TimeSummary;
  entries: TimeEntry[];
}

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function TimeTab({ detail }: TabProps) {
  const { project, state } = detail;
  const timer = useTimer();
  const { data, error, loading, reload } = useApi<TimeData>(`/api/projects/${project.id}/time`, { pollMs: 30000 });
  const [stage, setStage] = useState<StageKey>(state.currentStage);
  const [note, setNote] = useState('');

  // רענון כשהטיימר משתנה (גם מהסרגל העליון)
  useEffect(() => {
    void reload();
  }, [timer.version, reload]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const { summary, entries } = data!;
  const mineRunning = timer.running?.projectId === project.id ? timer.running : null;
  // הטיימר החי מתקדם בצד הלקוח; הסיכום מהשרת מתעדכן בעצירה
  const liveExtra = mineRunning && summary.running ? Math.max(0, timer.elapsed - summary.running.durationSec) : 0;
  const tracked = summary.trackedSec + liveExtra;
  const maxStage = Math.max(1, ...Object.values(summary.byStage).map((v) => v ?? 0));

  return (
    <div className="stack">
      <div className="kpis kpis-3">
        <div className="kpi">
          <div className="kpi-value">{formatDuration(tracked)}</div>
          <div className="kpi-label">זמן עבודה מתועד (טיימר + ידני)</div>
        </div>
        <div className="kpi">
          <div className="kpi-value muted">~{formatDuration(summary.estimatedActiveSec)}</div>
          <div className="kpi-label" title="מחושב מהפעולות שלך במערכת: פעולות במרווח של עד 20 דקות נחשבות סשן אחד. לא כולל עבודה בכלים חיצוניים.">
            הערכה אוטומטית: פעילות במערכת ⓘ
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-value">{summary.entryCount}</div>
          <div className="kpi-label">
            רישומים · {summary.firstWorkAt ? `${fmtDate(summary.firstWorkAt)} – ${fmtDate(summary.lastWorkAt)}` : 'עדיין אין'}
          </div>
        </div>
      </div>

      <section className="card">
        <h2>טיימר</h2>
        {mineRunning ? (
          <div className="row gap-s wrap">
            <span className="timer-big">{formatClock(timer.elapsed)}</span>
            <Tag>{STAGE_BY_KEY[mineRunning.stage].label}</Tag>
            <input className="grow" placeholder="על מה עבדת? (נשמר בעצירה)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              className="btn btn-primary"
              disabled={timer.busy}
              onClick={async () => {
                await timer.stop(note);
                setNote('');
              }}
            >
              ⏹ עצור ושמור
            </button>
          </div>
        ) : (
          <div className="row gap-s wrap">
            <select value={stage} onChange={(e) => setStage(e.target.value as StageKey)}>
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.number} {s.label}
                </option>
              ))}
            </select>
            <input className="grow" placeholder="הערה (אופציונלי)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              className="btn btn-primary"
              disabled={timer.busy}
              onClick={async () => {
                await timer.start(project.id, stage, note);
                setNote('');
              }}
            >
              ▶ התחל טיימר
            </button>
            {timer.running && <span className="small muted">יעצור את הטיימר של "{timer.running.projectName}"</span>}
          </div>
        )}
        <InlineError error={timer.error} />
      </section>

      <div className="dash-grid">
        <ManualEntry projectId={project.id} defaultStage={state.currentStage} onDone={reload} />
        <section className="card">
          <h2>לפי שלב</h2>
          {Object.keys(summary.byStage).length === 0 ? (
            <div className="muted small">אין עדיין זמן מתועד</div>
          ) : (
            <ul className="stage-bars">
              {STAGES.filter((s) => summary.byStage[s.key]).map((s) => (
                <li key={s.key}>
                  <span className="sb-label">
                    {s.number} {s.label}
                  </span>
                  <span className="sb-track">
                    <span className="sb-fill" style={{ width: `${((summary.byStage[s.key] ?? 0) / maxStage) * 100}%` }} />
                  </span>
                  <span className="sb-value">{formatDuration(summary.byStage[s.key] ?? 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <h2>רישומי זמן</h2>
        {entries.length === 0 ? (
          <Empty title="עדיין לא נרשם זמן עבודה">הפעל טיימר או הוסף זמן ידנית.</Empty>
        ) : (
          <table className="simple-table">
            <thead>
              <tr>
                <th>התחלה</th>
                <th>משך</th>
                <th>שלב</th>
                <th>מקור</th>
                <th>הערה</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <EntryRow key={e.id} entry={e} liveSec={!e.endedAt && mineRunning ? timer.elapsed : null} onDone={reload} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ManualEntry({ projectId, defaultStage, onDone }: { projectId: string; defaultStage: StageKey; onDone: () => Promise<void> }) {
  const [stage, setStage] = useState<StageKey>(defaultStage);
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [note, setNote] = useState('');
  const act = useAction();
  const total = (Number(hours) || 0) * 60 + (Number(minutes) || 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await act.run(() =>
      api.post(`/api/projects/${projectId}/time`, {
        stage,
        minutes: total,
        note,
        startedAt: startedAt ? new Date(startedAt).toISOString() : undefined,
      }),
    );
    if (r) {
      setHours('');
      setMinutes('');
      setNote('');
      setStartedAt('');
      await onDone();
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>הוספת זמן ידנית</h2>
      <p className="small muted">לעבודה שנעשתה מחוץ למערכת (Higgsfield, עריכה, שיחות עם הלקוח) או כשלא הופעל טיימר.</p>
      <div className="grid-3">
        <Field label="שעות">
          <input type="number" min={0} max={24} value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
        <Field label="דקות">
          <input type="number" min={0} max={59} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
        <Field label="שלב">
          <select value={stage} onChange={(e) => setStage(e.target.value as StageKey)}>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.number} {s.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid-2">
        <Field label="מתי התחלת" hint="ריק = הסתיים עכשיו">
          <input type="datetime-local" value={startedAt} max={toLocalInput(new Date())} onChange={(e) => setStartedAt(e.target.value)} />
        </Field>
        <Field label="הערה">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="על מה עבדת" />
        </Field>
      </div>
      <InlineError error={act.error} onClose={act.clearError} />
      <div className="row end">
        <button className="btn btn-primary" disabled={act.busy || total <= 0}>
          הוסף {total > 0 ? formatDuration(total * 60) : ''}
        </button>
      </div>
    </form>
  );
}

function EntryRow({ entry, liveSec, onDone }: { entry: TimeEntry; liveSec: number | null; onDone: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState(String(Math.round(entry.durationSec / 60)));
  const [note, setNote] = useState(entry.note);
  const [stage, setStage] = useState<StageKey>(entry.stage);
  const act = useAction();
  const running = !entry.endedAt;

  const save = async () => {
    const r = await act.run(() =>
      api.patch(`/api/time/${entry.id}`, { stage, note, ...(running ? {} : { minutes: Number(minutes) }) }),
    );
    if (r) {
      setEditing(false);
      await onDone();
    }
  };
  const remove = async () => {
    await act.run(() => api.del(`/api/time/${entry.id}`));
    await onDone();
  };

  if (editing) {
    return (
      <tr>
        <td className="small">{fmtDateTime(entry.startedAt)}</td>
        <td>
          {running ? (
            <span className="muted small">רץ</span>
          ) : (
            <span className="row gap-s">
              <input type="number" className="num" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} /> ד׳
            </span>
          )}
        </td>
        <td>
          <select value={stage} onChange={(e) => setStage(e.target.value as StageKey)}>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </td>
        <td />
        <td>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
          <InlineError error={act.error} />
        </td>
        <td className="row gap-s">
          <button className="btn btn-sm btn-primary" onClick={save} disabled={act.busy}>
            שמור
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>
            ביטול
          </button>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td className="small">{fmtDateTime(entry.startedAt)}</td>
      <td>
        {running ? (
          <Tag tone="info">⏱ {formatClock(liveSec ?? entry.durationSec)}</Tag>
        ) : (
          formatDuration(entry.durationSec)
        )}
      </td>
      <td>{STAGE_BY_KEY[entry.stage]?.label}</td>
      <td>
        <Tag tone={entry.source === 'timer' ? 'auto' : 'manual'}>{entry.source === 'timer' ? 'טיימר' : 'ידני'}</Tag>
      </td>
      <td className="small">{entry.note}</td>
      <td className="row gap-s">
        <button className="btn-link" onClick={() => setEditing(true)}>
          ערוך
        </button>
        {!running && (
          <ConfirmButton className="btn-link danger-text" onConfirm={remove} disabled={act.busy} confirmLabel="בטוח?">
            מחק
          </ConfirmButton>
        )}
      </td>
    </tr>
  );
}
