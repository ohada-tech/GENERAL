import { formatDuration, STAGE_BY_KEY, type DashboardData, type Project, type ProjectSummary } from '@apos/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, ErrorBox, Field, InlineError, Loading, Modal, rowLink, StatusBadge, Tag } from '../components/ui';
import { api, assetUrl, useAction, useApi } from '../lib/api';
import { daysUntil, fmtDate } from '../lib/format';

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
    <div className="t-frame" style={{ '--h1': h, '--h2': (h + 48) % 360 } as React.CSSProperties}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span className="t-initials" dir="auto">{word}</span>}
      {tag && <span className="t-frame-tag">{tag}</span>}
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

  const projects = data?.projects ?? [];
  const myActions = useMemo(
    () =>
      projects
        .filter((p) => !isDone(p))
        .flatMap((p) =>
          p.state.myActions.filter((a) => a.kind !== 'task' || a.stage === p.state.currentStage).map((a) => ({ ...a, project: p })),
        ),
    [projects],
  );
  const blockers = useMemo(() => projects.flatMap((p) => p.state.blockers.map((b) => ({ ...b, project: p }))), [projects]);
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
            {blockers.length ? ` · ${blockers.length} חסמים` : ''}
          </p>
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

      {blockers.length > 0 && (
        <section className="t-blockers">
          {blockers.map((b, i) => (
            <Link key={i} to={`/projects/${b.project.id}`} className="t-blocker">
              <span className="t-kind t-kind-fix">חסם · {STAGE_BY_KEY[b.stage]?.label}</span>
              <span className="grow">{b.reason}</span>
              <span className="muted small">{b.project.name}</span>
            </Link>
          ))}
        </section>
      )}

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

        {projects.length === 0 ? (
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
                      <StatusBadge status={p.state.overallStatus} />
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
                    <Track p={p} />
                    <div className="row between small">
                      <span className="t-stage">{cur.label}</span>
                      <span className="muted">{p.state.progress}%</span>
                    </div>
                    {p.state.nextAction && !done && (
                      <Link className="t-next" to={`/projects/${p.id}/${p.state.nextAction.tab}`}>
                        הבא: <b>{p.state.nextAction.label}</b>
                      </Link>
                    )}
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

      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
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
        ⬆ ייבוא פרויקטים
        <input type="file" accept="application/json,.json" hidden onChange={onFile} disabled={act.busy} />
      </label>
      {msg && <Tag tone="ok">{msg}</Tag>}
      <InlineError error={act.error} onClose={act.clearError} />
    </span>
  );
}
