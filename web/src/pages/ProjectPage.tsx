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
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Health } from '../App';
import { ProjectHero, StageRail } from '../components/ProjectHero';
import { ProjectTimerButton } from '../components/TimerWidget';
import { ErrorBox, Field, InlineError, Loading, ModeTag, Modal, Progress, rowLink, StatusBadge } from '../components/ui';
import { api, isCloud, useAction, useApi } from '../lib/api';
import { fmtDate, fmtDateTime, fmtRelative } from '../lib/format';
import { ActivityTab, JobsTab } from './ActivityTabs';
import { BriefTab } from './BriefTab';
import { ScriptTab } from './ScriptTab';
import { SettingsTab } from './SettingsTab';
import { StoryboardTab } from './StoryboardTab';
import { TimeTab } from './TimeTab';
import { ProductionTab } from './ProductionTab';
import { Icon } from '../components/Icon';

export interface ProjectDetail {
  project: Project;
  state: ProjectState;
  approvals: Approval[];
  assets: Asset[];
  cover?: { mediaId?: string; assetId?: string } | null;
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
  { key: 'production', label: '05–09 הפקה' },
  { key: 'time', label: 'זמן עבודה' },
  { key: 'activity', label: 'היסטוריה' },
  { key: 'jobs', label: 'משימות והרצות' },
  { key: 'settings', label: 'הגדרות' },
];

const EXTRA_TABS: Array<{ key: string; label: string }> = [
  { key: 'overview', label: 'סקירה' },
  { key: 'time', label: 'זמן עבודה' },
  { key: 'activity', label: 'היסטוריה' },
  { key: 'jobs', label: 'משימות והרצות' },
  { key: 'settings', label: 'הגדרות' },
];

const STAGE_TAB: Partial<Record<StageKey, string>> = {
  brief: 'brief',
  script: 'script',
  storyboard: 'storyboard',
  references: 'storyboard',
  images: 'production',
  animation: 'production',
  audio: 'production',
  editing: 'production',
  delivery: 'production',
};

export function ProjectPage({ health }: { health: Health | null }) {
  const { id, tab = 'overview' } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<ProjectDetail>(`/api/projects/${id}`, { pollMs: 3000 });
  const pipeline = useAction();
  const [confirmStop, setConfirmStop] = useState(false);
  const head = useRef<HTMLDivElement>(null);
  const sticky = useStickyBar(head, !!data);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const { project, state } = data;

  const setPipeline = async (action: 'pause' | 'resume' | 'stop') => {
    await pipeline.run(() => api.post(`/api/projects/${project.id}/pipeline`, { action }));
    setConfirmStop(false);
    void reload();
  };

  // "נמסר ללקוח": גם כשההפקה נעשתה מחוץ למערכת. ביטול — אם סומן בטעות
  const setDelivered = async (on: boolean) => {
    if (on) {
      const note = window.prompt('נמסר ללקוח והסרטון אושר. הערה קצרה (לא חובה):', '');
      if (note === null) return;
      await pipeline.run(() => api.post(`/api/projects/${project.id}/delivered`, { note }));
    } else {
      if (!window.confirm('לבטל את הסימון "נמסר ללקוח"?')) return;
      await pipeline.run(() => api.del(`/api/projects/${project.id}/delivered`));
    }
    void reload();
  };

  const props: TabProps = { detail: data, reload, health };

  return (
    <div className="page">
      {/* פס דביק: מופיע כשגוללים מעבר לכותרת — שם, סטטוס, טיימר, השהה/עצור וקיצורים לכל הלשוניות */}
      <div className={`proj-sticky ${sticky.on ? 'on' : ''}`} style={{ top: sticky.top }} aria-hidden={!sticky.on} inert={!sticky.on}>
        <div className="proj-sticky-row">
          <span className="proj-sticky-name">{project.name}</span>
          <StatusBadge status={state.overallStatus} />
          <span className="proj-sticky-progress" title={`${state.progress}%`}>
            <Progress value={state.progress} />
          </span>
          <span className="grow" />
          <ProjectTimerButton projectId={project.id} />
          {state.pipelineState === 'active' ? (
            <>
              <button className="btn btn-sm" disabled={pipeline.busy} onClick={() => setPipeline('pause')}>
                <Icon n="pause" /> השהה
              </button>
              <button className="btn btn-sm btn-danger-ghost" disabled={pipeline.busy} onClick={() => setConfirmStop(true)}>
                <Icon n="stop" /> עצור
              </button>
            </>
          ) : (
            <button className="btn btn-sm btn-primary" disabled={pipeline.busy} onClick={() => setPipeline('resume')}>
              <Icon n="play" /> הפעל מחדש
            </button>
          )}
        </div>
        <nav className="tabs proj-sticky-tabs">
          {TABS.map((t) => (
            <Link key={t.key} to={`/projects/${project.id}/${t.key}`} className={`tab ${tab === t.key ? 'tab-on' : ''}`}>
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      <div ref={head}>
        <ProjectHero
          id={project.id}
          name={project.name}
          client={project.clientName}
          cover={data.cover}
          state={state}
          meta={
            <span className="ph-facts">
              <span>{project.clientName || 'ללא לקוח'}</span>
              {project.brief.dueDate && <span>יעד {fmtDate(project.brief.dueDate)}</span>}
              <span>עודכן {fmtRelative(project.updatedAt)}</span>
              {project.deliveredAt && <span className="delivered-tag" title={project.deliveredNote || undefined}><Icon n="checkCircle" /> נמסר ללקוח · {fmtDate(project.deliveredAt)}</span>}
            </span>
          }
          under={!isCloud() ? <ProgressLine projectId={project.id} /> : undefined}
          actions={
            <>
              {project.deliveredAt ? (
                <button className="btn btn-sm btn-ghost" disabled={pipeline.busy} onClick={() => setDelivered(false)} title="מחזיר את הפרויקט לשלב שבו הוא היה">
                  ↺ בטל "נמסר"
                </button>
              ) : (
                <button className="btn btn-sm" disabled={pipeline.busy} onClick={() => setDelivered(true)} title="הסרטון נשלח והלקוח אישר — גם אם ההפקה נעשתה מחוץ למערכת. הפרויקט יעבור ל'נמסרו'">
                  <Icon n="checkCircle" /> סמן כנמסר
                </button>
              )}
              <ProjectTimerButton projectId={project.id} />
              {state.pipelineState === 'active' ? (
                <>
                  <button className="btn btn-sm" disabled={pipeline.busy} onClick={() => setPipeline('pause')} title="משימות לא ירוצו עד להפעלה מחדש">
                    <Icon n="pause" /> השהה
                  </button>
                  <button className="btn btn-sm btn-danger-ghost" disabled={pipeline.busy} onClick={() => setConfirmStop(true)}>
                    <Icon n="stop" /> עצור
                  </button>
                </>
              ) : (
                <button className="btn btn-sm btn-primary" disabled={pipeline.busy} onClick={() => setPipeline('resume')}>
                  <Icon n="play" /> הפעל מחדש
                </button>
              )}
            </>
          }
        />
      </div>
      <InlineError error={pipeline.error} onClose={pipeline.clearError} />

      <div className="proj-layout">
        <StageRail id={project.id} state={state} tab={tab} stageTab={STAGE_TAB} extra={EXTRA_TABS} />
        <div className="proj-content">
      <div className="tab-body">
        {tab === 'overview' && <OverviewTab {...props} />}
        {tab === 'brief' && <BriefTab {...props} />}
        {tab === 'script' && <ScriptTab {...props} />}
        {tab === 'storyboard' && <StoryboardTab {...props} />}
        {tab === 'production' && <ProductionTab {...props} />}
        {tab === 'time' && <TimeTab {...props} />}
        {tab === 'activity' && <ActivityTab {...props} />}
        {tab === 'jobs' && <JobsTab {...props} />}
        {tab === 'settings' && <SettingsTab {...props} />}
      </div>
        </div>
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
  const navigate = useNavigate();

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
              const link = rowLink(navigate, tab ? `/projects/${project.id}/${tab}` : null);
              return (
                <tr key={s.key} {...link} className={`${link.className ?? ''} ${s.key === state.currentStage ? 'row-current' : ''}`}>
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

/** הפס הדביק מופיע ברגע שכותרת הפרויקט נעלמת מתחת לסרגל העליון (שגובהו משתנה בין מחשב לטלפון) */
function useStickyBar(head: React.RefObject<HTMLDivElement | null>, ready: boolean) {
  const [top, setTop] = useState(60);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('.topbar');
    if (!bar) return;
    const measure = () => {
      setTop(bar.offsetHeight);
      document.documentElement.style.setProperty('--topbar-h', `${bar.offsetHeight}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  // חישוב ישיר בכל גלילה (לא IntersectionObserver — הוא מתעכב אחרי מעבר למצב עריכה ועלול לפספס)
  useEffect(() => {
    if (!ready) return;
    const check = () => {
      const el = head.current;
      if (el) setOn(el.getBoundingClientRect().bottom < top);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [head, ready, top]);
  // רכיבים דביקים אחרים (כותרת הגרסה, כפתורי השמירה, רשימת הגרסאות) יורדים מתחת לפס כשהוא מוצג.
  // הגובה נמדד כל הזמן: הפס יכול לגדול אחרי שהופיע (פונטים, שם ארוך שנשבר, טיימר שהתחיל)
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.proj-sticky');
    const set = () => document.documentElement.style.setProperty('--sticky-bar-h', `${on && el ? el.offsetHeight : 0}px`);
    set();
    const ro = el ? new ResizeObserver(set) : null;
    if (el) ro!.observe(el);
    window.addEventListener('resize', set);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', set);
      document.documentElement.style.removeProperty('--sticky-bar-h');
    };
  }, [on, ready]);
  return { on, top };
}

/** העדכון האחרון על הפרויקט + כתיבת עדכון חדש (גם סשנים של Claude שולחים לכאן) */
function ProgressLine({ projectId }: { projectId: string }) {
  const last = useApi<{ last: { text: string; by: string; at: string } | null }>(`/api/projects/${projectId}/progress`, { pollMs: 15000 });
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const save = async () => {
    const r = await act.run(() => api.post(`/api/projects/${projectId}/progress`, { text }));
    if (r) {
      setText('');
      setOpen(false);
      await last.reload();
    }
  };
  const u = last.data?.last;
  return (
    <div className="progress-line">
      {u ? (
        <span className="small">
          <span className="muted"><Icon n="note" /> {u.by} · {fmtRelative(u.at)}:</span> {u.text}
        </span>
      ) : (
        <span className="small muted">אין עדיין עדכוני התקדמות</span>
      )}
      {open ? (
        <span className="row gap-s progress-line-form">
          <input className="grow" autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && void save()} placeholder="מה התקדם? (למשל: נשלח תסריט למיכאל)" />
          <button className="btn btn-sm btn-primary" disabled={act.busy || !text.trim()} onClick={save}>
            שמור
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
            ביטול
          </button>
        </span>
      ) : (
        <button className="btn-link small" onClick={() => setOpen(true)}>
          + עדכון
        </button>
      )}
      <InlineError error={act.error} onClose={act.clearError} />
    </div>
  );
}
