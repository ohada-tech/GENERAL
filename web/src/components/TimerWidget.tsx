import { formatClock, STAGE_BY_KEY } from '@apos/shared';
import { Link } from 'react-router-dom';
import { useTimer } from '../lib/timer';

/** טיימר פעיל בסרגל העליון — נראה מכל מסך, עם עצירה בלחיצה. */
export function TimerWidget() {
  const { running, elapsed, stop, busy, error } = useTimer();
  if (!running) return null;
  return (
    <div className="timer-widget" title={error ?? undefined}>
      <span className="timer-dot" />
      <Link to={`/projects/${running.projectId}/time`} className="timer-link">
        {running.projectName} · {STAGE_BY_KEY[running.stage]?.label}
      </Link>
      <span className="timer-clock">{formatClock(elapsed)}</span>
      <button className="btn btn-sm" onClick={() => stop()} disabled={busy}>
        ⏹ עצור
      </button>
    </div>
  );
}

/** כפתור טיימר לעמוד פרויקט: מתחיל בשלב הנוכחי, או עוצר אם רץ על הפרויקט הזה. */
export function ProjectTimerButton({ projectId }: { projectId: string }) {
  const { running, elapsed, start, stop, busy } = useTimer();
  const mine = running?.projectId === projectId;
  if (mine) {
    return (
      <button className="btn btn-timer-on" onClick={() => stop()} disabled={busy} title="עצור טיימר">
        ⏹ {formatClock(elapsed)}
      </button>
    );
  }
  return (
    <button
      className="btn"
      onClick={() => start(projectId)}
      disabled={busy}
      title={running ? `יעצור את הטיימר של "${running.projectName}"` : 'התחל למדוד זמן עבודה על השלב הנוכחי'}
    >
      ⏱ התחל טיימר
    </button>
  );
}
