/**
 * משימות ל-Claude מכפתור (בלי צ'אט): הרצה בהיגספילד באנלימיטד ובדיקת איכות.
 * Claude Code רץ במחשב של אוהד (עם Chrome והסקילים) ומחזיר תוצאה לכאן.
 */
import { useApi, api, useAction } from '../lib/api';
import { fmtRelative } from '../lib/format';
import { Icon } from './Icon';
import { InlineError, Tag } from './ui';

export interface AgentTask {
  id: string;
  kind: 'hf_unlimited' | 'qa';
  stage: 'images' | 'animation';
  scope: 'pilot' | 'all';
  title: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  result: string;
  log: string;
  requestedAt: string;
  finishedAt: string | null;
}

const STATUS: Record<AgentTask['status'], [string, string]> = {
  queued: ['info', 'ממתין למחשב…'],
  running: ['info', 'Claude עובד…'],
  done: ['ok', 'הסתיים'],
  failed: ['danger', 'נכשל'],
  cancelled: ['neutral', 'בוטל'],
};

export function useAgentTasks(projectId: string) {
  return useApi<AgentTask[]>(`/api/projects/${projectId}/agent`, { pollMs: 6000 });
}

/** כפתורים + התוצאה האחרונה לשלב תמונות / הנפשה */
export function AgentStageControls(props: {
  projectId: string;
  stage: 'images' | 'animation';
  tasks: AgentTask[];
  route: 'unlimited' | 'credits';
  canRun: boolean;
  hasReady: boolean;
  /** כמה טייקים נפסלו בבדיקת האיכות ועוד לא תוקנו */
  qaFailed?: number;
  /** בהנפשה: כפתורי ההרצה נמצאים בפאנל ההנפשה המותאמת */
  hideRun?: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const act = useAction();
  const mine = props.tasks.filter((t) => t.stage === props.stage);
  const active = mine.find((t) => t.status === 'queued' || t.status === 'running');
  const last = mine[0];
  // אנלימיטד ובדיקת איכות לא עולים כסף — רץ מיד בלחיצה, בלי חלון אישור
  const send = async (kind: 'hf_unlimited' | 'qa', scope: 'pilot' | 'all', _what?: string) => {
    await act.run(() => api.post(`/api/projects/${props.projectId}/agent`, { kind, stage: props.stage, scope }));
    await props.onChanged();
  };
  const what = props.stage === 'images' ? 'תמונות' : 'קליפים';
  return (
    <div className="stack agent-controls">
      <div className="row gap-s wrap">
        {props.route === 'unlimited' && props.canRun && !active && !props.hideRun && (
          <>
            <button className="btn btn-primary" disabled={act.busy} onClick={() => send('hf_unlimited', 'pilot', `Claude ייצר בהיגספילד באנלימיטד (0 קרדיטים) — שוט אחד לפיילוט. להתחיל?`)}>
              <Icon n="play" /> פיילוט באנלימיטד: שוט אחד
            </button>
            <button className="btn" disabled={act.busy} onClick={() => send('hf_unlimited', 'all', `Claude ייצר בהיגספילד באנלימיטד (0 קרדיטים) את כל ה${what} שמחכים. להתחיל?`)}>
              <Icon n="play" /> הכל באנלימיטד
            </button>
          </>
        )}
        {!!props.qaFailed && !active && (
          <button
            className="btn btn-primary"
            disabled={act.busy}
            onClick={async () => {
              await act.run(() => api.post(`/api/projects/${props.projectId}/production/${props.stage}/fix-qa`));
              await props.onChanged();
            }}
          >
            ↻ תקן את כל מה שנפסל ({props.qaFailed})
          </button>
        )}
        {props.hasReady && !active && (
          <button className="btn" disabled={act.busy} onClick={() => send('qa', 'all', `Claude יבדוק את כל ה${what} שמחכים לאישור (אנטומיה, פנים, מוצר, עקביות) ויסמן עובר / נפסל. להתחיל?`)}>
            <Icon n="eye" /> בדיקת איכות (Claude)
          </button>
        )}
      </div>
      {last && (
        <div className={`agent-task st-${last.status}`}>
          <div className="row between gap-s wrap">
            <span className="small">
              <Icon n="sparkle" /> {last.title}
            </span>
            <span className="row gap-s">
              <Tag tone={STATUS[last.status][0] as never}>{STATUS[last.status][1]}</Tag>
              <span className="small muted">{fmtRelative(last.finishedAt ?? last.requestedAt)}</span>
              {(last.status === 'queued' || last.status === 'running') && (
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={act.busy}
                  onClick={async () => {
                    await act.run(() => api.post(`/api/agent/${last.id}/cancel`));
                    await props.onChanged();
                  }}
                >
                  עצור
                </button>
              )}
            </span>
          </div>
          {last.result && <div className="small agent-result">{last.result}</div>}
        </div>
      )}
      <InlineError error={act.error} onClose={act.clearError} />
    </div>
  );
}

/** תג בדיקת האיכות של Claude על פריט */
export function QaBadge({ qa }: { qa?: { verdict: 'pass' | 'fail'; note: string } }) {
  if (!qa) return null;
  return (
    <div className={`small qa-badge ${qa.verdict === 'pass' ? 'ok-text' : 'danger-text'}`} title="בדיקת איכות של Claude">
      {qa.verdict === 'pass' ? '✓ QA עבר' : '✗ QA נפסל'}
      {qa.note ? ` · ${qa.note}` : ''}
    </div>
  );
}
