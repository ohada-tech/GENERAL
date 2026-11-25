import { formatDuration, STAGE_BY_KEY, type DashboardData, type Project, type ProjectSummary } from '@apos/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, ErrorBox, Field, InlineError, Loading, Modal, rowLink, StatusBadge, Tag } from '../components/ui';
import { api, assetUrl, useAction, useApi } from '../lib/api';
import { daysUntil, fmtDate, fmtRelative } from '../lib/format';
import { Icon } from '../components/Icon';
import { LogoImg } from '../components/LogoImg';
import { PlanLine, UsageLine } from '../components/UsageLine';

/* מסך "היום": מה מחכה לך למעלה, ואז הפרויקטים ככרטיסים עם תמונה ופס שלבים */

type FilterKey = 'active' | 'mine' | 'client' | 'blocked' | 'done' | 'all';
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'active', label: 'בהפקה' },
  { key: 'mine', label: 'מחכים לי' },
  { key: 'client', label: 'אצל הלקוח' },
  { key: 'blocked', label: 'חסומים' },
  { key: 'done', label: 'נמסרו' },
  { key: 'all', label: 'הכול' },
];

/** הפרדה בין הפרויקטים של Genesis (GNSS) לפרויקטים של הסטודיו (OA). לפי "הלקוח שייך ל" בהגדרות הפרויקט */
type SpaceKey = 'genesis' | 'studio' | 'all';
const SPACES: Array<{ key: SpaceKey; label: string; title: string }> = [
  { key: 'genesis', label: 'GNSS', title: 'פרויקטים של Genesis' },
  { key: 'studio', label: 'OA', title: 'הפרויקטים של הסטודיו שלי (Ohad Alfi)' },
  { key: 'all', label: 'הכול', title: 'כל הפרויקטים' },
];
const SPACE_KEY = 'apos.dashboard.space';
const brandOf = (p: ProjectSummary) => (p.brand === 'studio' ? 'studio' : 'genesis');
const inSpace = (p: ProjectSummary, s: SpaceKey) => s === 'all' || brandOf(p) === s;
function savedSpace(): SpaceKey {
  try {
    const v = localStorage.getItem(SPACE_KEY);
    return v === 'genesis' || v === 'studio' || v === 'all' ? v : 'all';
  } catch {
    return 'all';
  }
}

const isDone = (p: ProjectSummary) =>
  p.state.overallStatus === 'completed' || p.state.stages.find((s) => s.key === 'delivery')?.status === 'completed';
const waitsForMe = (p: ProjectSummary) => p.state.myActions.some((a) => a.kind !== 'task');

function matches(p: ProjectSummary, f: FilterKey) {
  if (f === 'all') return true;
  if (f === 'done') return isDone(p);
  if (isDone(p)) return false;
  if (f === 'active') return true;
  if (f === 'mine') return waitsForMe(p);
  if (f === 'client') return p.state.overallStatus === 'waiting_client';
  return p.state.overallStatus === 'blocked' || p.state.blockers.length > 0;
}

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
}

/** צבע קבוע לכל פרויקט (לכרטיס בלי תמונה) — נגזר מהמזהה */
function hueOf(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function coverSrc(p: ProjectSummary) {
  if (p.cover?.mediaId) return `/api/media/${p.cover.mediaId}/file`;
  if (p.cover?.assetId) return assetUrl(p.cover.assetId);
  return null;
}

function Frame({ p, tag }: { p: ProjectSummary; tag?: string }) {
  const src = coverSrc(p);
  const h = hueOf(p.id);
  // שם הלקוח (המילה הראשונה, בלי סוגריים) — מזהה מהר יותר מראשי תיבות
  const word = (p.clientName || p.name).replace(/\(.*?\)/g, '').trim().split(/\s+/)[0]?.slice(0, 12) ?? '';
  return (
    <div className={`t-frame ${p.cover?.logo ? 't-frame-logo' : ''}`} style={{ '--h1': h, '--h2': (h + 48) % 360 } as React.CSSProperties}>
      {src && p.cover?.logo ? <LogoImg src={src} /> : src ? <img src={src} alt="" loading="lazy" /> : <span className="t-initials" dir="auto">{word}</span>}
      {tag && <span className="t-frame-tag">{tag}</span>}
    </div>
  );
}

/** "נשלח ללקוח לפני X ימים · נפתח ✓" — ואחרי 3 ימים בלי אישור: תזכורת */
function ShareLine({ share, waiting }: { share: NonNullable<ProjectSummary['lastShare']>; waiting: boolean }) {
  const days = Math.floor((Date.now() - new Date(share.sentAt).getTime()) / 86_400_000);
  const nudge = waiting && days >= 3;
  return (
    <div className={`t-share ${nudge ? 't-share-nudge' : ''}`}>
      <span>
        <Icon n="send" /> v{share.label} נשלח {days === 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`}
      </span>
      <span>{share.views > 0 ? '· נפתח ✓' : '· עוד לא נפתח'}</span>
      {nudge && <span className="t-share-hint"><Icon n="alarm" /> זמן להזכיר ללקוח</span>}
    </div>
  );
}

function Track({ p }: { p: ProjectSummary }) {
  return (
    <div className="t-track" aria-label={`שלב ${STAGE_BY_KEY[p.state.currentStage].number} מתוך 9`}>
      {p.state.stages.map((s) => (
        <i key={s.key} title={STAGE_BY_KEY[s.key].label} className={s.status === 'completed' ? 'on' : s.key === p.state.currentStage ? 'now' : ''} />
      ))}
    </div>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<DashboardData>('/api/dashboard', { pollMs: 5000 });
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('active');
  const [space, setSpaceState] = useState<SpaceKey>(savedSpace);
  const setSpace = (s: SpaceKey) => {
    setSpaceState(s);
    try {
      localStorage.setItem(SPACE_KEY, s);
    } catch {
      /* מצב פרטי — הבחירה פשוט לא נשמרת */
    }
  };

  const allProjects = data?.projects ?? [];
  const projects = useMemo(() => allProjects.filter((p) => inSpace(p, space)), [allProjects, space]);

  // לקוח בלי לוגו אבל עם אתר — השרת מנסה להביא את הלוגו מהאתר (פעם אחת לפרויקט, ברקע)
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const todo = allProjects.filter((p) => p.logoAuto && !asked.current.has(p.id));
    if (!todo.length) return;
    todo.forEach((p) => asked.current.add(p.id));
    void (async () => {
      let found = false;
      for (const p of todo) {
        const r = await api.post<{ assetId: string | null }>(`/api/projects/${p.id}/logo/auto`).catch(() => null);
        if (r?.assetId) found = true;
      }
      if (found) await reload();
    })();
  }, [allProjects, reload]);

  const myActions = useMemo(
    () =>
      projects
        .filter((p) => !isDone(p))
        .flatMap((p) =>
          p.state.myActions.filter((a) => a.kind !== 'task' || a.stage === p.state.currentStage).map((a) => ({ ...a, project: p })),
        ),
    [projects],
  );
  const stats = useMemo(
    () => ({
      active: projects.filter((p) => !isDone(p)).length,
      mine: projects.filter((p) => !isDone(p) && waitsForMe(p)).length,
      client: projects.filter((p) => !isDone(p) && p.state.overallStatus === 'waiting_client').length,
      done: projects.filter(isDone).length,
    }),
    [projects],
  );

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const filtered = projects.filter((p) => matches(p, filter));
  const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="page today">
      <header className="t-hello">
        <div>
          <div className="t-eyebrow">{today}</div>
          <h1>{greeting()}, אוהד</h1>
          <p className="t-sub">
            {myActions.length ? `${myActions.length} דברים מחכים לך` : 'אין כרגע משהו שמחכה לך'}
          </p>
          <PlanLine plan={data?.planUsage} />
        </div>
        <div className="t-hello-side">
          <dl className="t-pulse">
            <div>
              <dt>בהפקה</dt>
              <dd>{stats.active}</dd>
            </div>
            <div>
              <dt>מחכים לך</dt>
              <dd>{stats.mine}</dd>
            </div>
            <div>
              <dt>אצל הלקוח</dt>
              <dd>{stats.client}</dd>
            </div>
            <div>
              <dt>נמסרו</dt>
              <dd>{stats.done}</dd>
            </div>
            <div>
              <dt>זמן עבודה השבוע</dt>
              <dd>{formatDuration(data?.weekTrackedSec ?? 0)}</dd>
            </div>
          </dl>
          <div className="row gap-s">
            <ImportButton onDone={reload} />
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              + פרויקט חדש
            </button>
          </div>
        </div>
      </header>

      <div className="t-spaces" role="tablist" aria-label="הפרדת פרויקטים: GNSS או OA">
        {SPACES.map((s) => {
          const n = allProjects.filter((p) => inSpace(p, s.key) && !isDone(p)).length;
          return (
            <button key={s.key} role="tab" aria-selected={space === s.key} title={s.title} onClick={() => setSpace(s.key)}>
              <span dir="ltr">{s.label}</span> <span className="t-count">{n}</span>
            </button>
          );
        })}
      </div>

      <RunningNow />

      {myActions.length > 0 && (
        <section className="t-section">
          <div className="t-section-head">
            <h2>מחכה לך עכשיו</h2>
            <span className="muted small">לחיצה פותחת ישר את המקום הנכון</span>
          </div>
          <div className="t-actions">
            {myActions.slice(0, 6).map((a, i) => (
              <Link key={i} to={`/projects/${a.project.id}/${a.tab}`} className="t-act">
                <Frame p={a.project} />
                <div className="t-act-body">
                  <span className={`t-kind t-kind-${a.kind}`}>{a.kind === 'approval' ? 'אישור' : a.kind === 'fix' ? 'תיקון' : 'משימה'}</span>
                  <span className="t-act-what">{a.label}</span>
                  <span className="t-act-who">{a.project.name}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* חסמים לא מוצגים כפס הודעות בדף — התקלות מגיעות להתראות (הפעמון למעלה) */}

      <section className="t-section">
        <div className="t-section-head">
          <h2>הפרויקטים</h2>
          <div className="t-filters" role="group" aria-label="סינון פרויקטים">
            {FILTERS.map((f) => (
              <button key={f.key} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label} <span className="t-count">{projects.filter((p) => matches(p, f.key)).length}</span>
              </button>
            ))}
          </div>
        </div>

        {projects.length === 0 && allProjects.length > 0 ? (
          <Empty title={space === 'studio' ? 'אין עדיין פרויקטים של OA' : 'אין פרויקטים של GNSS'}>
            <span className="muted small">מעבירים פרויקט במתג GNSS | OA בכרטיס שלו (או בהגדרות הפרויקט: "הלקוח שייך ל")</span>
          </Empty>
        ) : projects.length === 0 ? (
          <Empty title="אין עדיין פרויקטים">
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              פתח פרויקט ראשון
            </button>
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty title="אין פרויקטים בסינון הזה" />
        ) : (
          <div className="t-grid">
            {filtered.map((p) => {
              const cur = STAGE_BY_KEY[p.state.currentStage];
              const due = daysUntil(p.dueDate);
              const done = isDone(p);
              const link = rowLink(navigate, `/projects/${p.id}`);
              return (
                <article key={p.id} {...link} className={`t-card ${link.className ?? ''} ${done ? 't-card-done' : ''}`}>
                  <Frame p={p} tag={done ? '✓ נמסר' : `${cur.number} · ${cur.label}`} />
                  <div className="t-card-body">
                    <div className="row between gap-s">
                      <span className="row gap-s">
                        <StatusBadge status={p.state.overallStatus} />
                        <SpaceChip p={p} onDone={reload} />
                      </span>
                      {p.dueDate && !done && (
                        <span className={`small ${due !== null && due < 0 ? 'danger-text' : due !== null && due <= 3 ? 'warn-text' : 'muted'}`}>
                          {due !== null && due < 0 ? `באיחור ${-due} ימים` : `יעד ${fmtDate(p.dueDate)}`}
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="t-card-title">{p.name}</div>
                      <div className="t-card-client">{p.clientName || '—'}</div>
                    </div>
                    {p.lastUpdate && (
                      <div className="t-update" title={p.lastUpdate.text}>
                        <span className="t-update-meta">
                          {p.lastUpdate.by} · {fmtRelative(p.lastUpdate.at)}
                        </span>
                        <span className="clamp-2">{p.lastUpdate.text}</span>
                      </div>
                    )}
                    {p.lastShare && !done && <ShareLine share={p.lastShare} waiting={p.state.overallStatus === 'waiting_client'} />}
                    <Track p={p} />
                    <div className="row between small">
                      <span className="t-stage">{cur.label}</span>
                      <span className="muted">{p.state.progress}%</span>
                    </div>
                    {p.state.nextAction && !done && <NextStep p={p} onDone={reload} />}
                    {p.revisions?.open && (
                      <Tag tone={p.revisions.open.number > p.revisions.included ? 'warn' : 'info'}>
                        🔁 סבב תיקונים {p.revisions.open.number} · {p.revisions.open.done}/{p.revisions.open.total}
                      </Tag>
                    )}
                    <UsageLine usage={p.usage} compact />
                    <DoneToggle p={p} done={done} onDone={reload} />
                    {(p.state.pipelineState !== 'active' || p.state.blockers.length > 0) && (
                      <div className="row gap-s small">
                        {p.state.pipelineState !== 'active' && <Tag tone="warn">{p.state.pipelineState === 'paused' ? 'מושהה' : 'עצור'}</Tag>}
                        {p.state.blockers.length > 0 && <Tag tone="danger">{p.state.blockers.length} חסמים</Tag>}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {creating && <NewProjectModal space={space} onClose={() => setCreating(false)} />}
    </div>
  );
}

/** מתג GNSS | OA בכרטיס — הצד המסומן הוא הטאב של הפרויקט; לחיצה על הצד השני מעבירה אותו (settings.brand, גם מיתוג הקבצים ללקוח) */
function SpaceChip({ p, onDone }: { p: ProjectSummary; onDone: () => Promise<void> | void }) {
  const act = useAction();
  const b = brandOf(p);
  const move = (to: 'genesis' | 'studio') => async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (to === b) return;
    await act.run(() => api.patch(`/api/projects/${p.id}`, { settings: { brand: to } }));
    await onDone();
  };
  const opts: Array<{ key: 'genesis' | 'studio'; label: string }> = [
    { key: 'genesis', label: 'GNSS' },
    { key: 'studio', label: 'OA' },
  ];
  return (
    <span className="t-space-switch" dir="ltr" role="group" aria-label="לאיזה טאב הפרויקט שייך">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`t-space-${o.key}`}
          aria-pressed={b === o.key}
          disabled={act.busy}
          onClick={move(o.key)}
          title={b === o.key ? `הפרויקט נמצא ב-${o.label}` : `העבר את הפרויקט ל-${o.label} (גם המיתוג של הקבצים ללקוח)`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** סגירה מהירה מהכרטיס: הסרטון נמסר והלקוח אישר — הפרויקט עובר ל"נמסרו". ביטול מחזיר להפקה */
function DoneToggle({ p, done, onDone }: { p: ProjectSummary; done: boolean; onDone: () => Promise<void> | void }) {
  const act = useAction();
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (done) {
      if (!window.confirm(`להחזיר את "${p.name}" להפקה?`)) return;
      await act.run(() => api.del(`/api/projects/${p.id}/delivered`));
    } else {
      if (!window.confirm(`לסמן את "${p.name}" כנסגר ואושר על ידי הלקוח?`)) return;
      await act.run(() => api.post(`/api/projects/${p.id}/delivered`, { note: 'נסגר ואושר' }));
    }
    await onDone();
  };
  // פרויקט שהושלם בתוך המערכת (שלב מסירה) — אין מה לבטל מכאן
  if (done && !p.state.deliveredAt) return null;
  return (
    <div className="row end" onClick={(e) => e.stopPropagation()}>
      <button className="btn btn-sm btn-ghost" disabled={act.busy} onClick={toggle} title={done ? 'החזרה להפקה' : 'הסרטון נמסר והלקוח אישר — הפרויקט יעבור ל"נמסרו"'}>
        {done ? '↺ החזר להפקה' : <><Icon n="checkCircle" /> נסגר ואושר</>}
      </button>
      <InlineError error={act.error} onClose={act.clearError} />
    </div>
  );
}

/** "הבא": מריץ את הצעד בעצמו כשאפשר (תסריט, סטורי בורד, פיילוט אנלימיטד), אחרת פותח את המקום הנכון */
interface RunningItem { id: string; kind: 'job' | 'agent' | 'hf'; projectId: string; projectName: string; label: string; status: 'queued' | 'running'; since: string; cancel: string | null; tab: string }

/** "מה רץ עכשיו": כל מה שהמערכת והמחשב עובדים עליו, בכל הפרויקטים, עם עצירה */
function RunningNow() {
  const { data, reload } = useApi<RunningItem[]>('/api/running', { pollMs: 8000 });
  const act = useAction();
  if (!data?.length) return null;
  const running = data.filter((r) => r.status === 'running').length;
  return (
    <section className="t-section">
      <div className="t-section-head">
        <h2>רץ עכשיו</h2>
        <span className="muted small">{running} בעבודה · {data.length - running} בתור</span>
      </div>
      <div className="stack gap-s">
        {data.map((r) => (
          <div key={r.id} className="row between gap-s wrap running-row">
            <Link to={`/projects/${r.projectId}/${r.tab}`} className="small">
              <Tag tone={r.status === 'running' ? 'info' : 'neutral'}>{r.status === 'running' ? 'עובד' : 'בתור'}</Tag> <b>{r.projectName}</b> · {r.label}
            </Link>
            <span className="row gap-s small muted">
              {fmtRelative(r.since)}
              {r.cancel && (
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={act.busy}
                  onClick={async () => {
                    await act.run(() => api.post(r.cancel!));
                    await reload();
                  }}
                >
                  עצור
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      <InlineError error={act.error} onClose={act.clearError} />
    </section>
  );
}

function NextStep({ p, onDone }: { p: ProjectSummary; onDone: () => Promise<void> | void }) {
  const act = useAction();
  const navigate = useNavigate();
  const [msg, setMsg] = useState('');
  const a = p.state.nextAction!;
  const runs = a.kind === 'task';
  return (
    <div onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
      <button
        className="t-next btn-link"
        disabled={act.busy}
        title={runs ? 'מריץ את הצעד הזה עכשיו' : 'פותח את המקום בפרויקט'}
        onClick={async () => {
          const r = await act.run(() => api.post<{ done?: string; navigate?: string }>(`/api/projects/${p.id}/next`));
          if (!r) return;
          if (r.navigate) navigate(`/projects/${p.id}/${r.navigate}`);
          else {
            setMsg(r.done ?? 'הופעל');
            await onDone();
          }
        }}
      >
        {runs ? '▶ ' : ''}הבא: <b>{a.label}</b>
      </button>
      {msg && <div className="small ok-text">✓ {msg}</div>}
      <InlineError error={act.error} onClose={act.clearError} />
    </div>
  );
}

function NewProjectModal({ space, onClose }: { space: SpaceKey; onClose: () => void }) {
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const { busy, error, run } = useAction();
  const navigate = useNavigate();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = await run(() => api.post<Project>('/api/projects', { name, clientName, ...(space !== 'all' ? { settings: { brand: space } } : {}) }));
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

/** ייבוא פרויקטים קיימים מקובץ JSON — במצב האמיתי שלהם, בלי להפעיל AI או יצירה בתשלום */
function ImportButton({ onDone }: { onDone: () => Promise<void> | void }) {
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setMsg(null);
    const r = await act.run(async () => {
      let data: unknown;
      try {
        data = JSON.parse(await f.text());
      } catch {
        throw new Error('הקובץ אינו JSON תקין');
      }
      return api.post<{ imported: number; results: Array<{ name: string; skipped?: string }> }>('/api/import', data);
    });
    if (r) {
      const skipped = r.results.filter((x) => x.skipped).map((x) => x.name);
      setMsg(`יובאו ${r.imported} פרויקטים${skipped.length ? ` · דולגו (כבר קיימים): ${skipped.join(', ')}` : ''}`);
      await onDone();
    }
  };
  return (
    <span className="row gap-s">
      <label className="btn" title="ייבוא פרויקטים קיימים מקובץ — בלי להפעיל AI ובלי עלות">
        <Icon n="upload" /> ייבוא פרויקטים
        <input type="file" accept="application/json,.json" hidden onChange={onFile} disabled={act.busy} />
      </label>
      {msg && <Tag tone="ok">{msg}</Tag>}
      <InlineError error={act.error} onClose={act.clearError} />
    </span>
  );
}
