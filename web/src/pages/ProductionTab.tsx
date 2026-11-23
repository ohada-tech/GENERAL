import { hfCostLabel, type CostEstimate, type Media, type MediaKind, type Shot } from '@apos/shared';
import { useState } from 'react';
import { ConfirmButton, Empty, ErrorBox, InlineError, Loading, Modal, Tag } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import type { TabProps } from './ProjectPage';
import { Icon } from '../components/Icon';
import { HfRouteToggle, hfRouteCost } from '../components/HfRoute';
import { AgentStageControls, QaBadge, useAgentTasks, type AgentTask } from '../components/AgentTasks';

type Stage = 'images' | 'animation' | 'audio' | 'editing' | 'delivery';

interface StageView {
  stage: Stage;
  gate: { startedAt: string | null; approvedAt: string | null; approvedBy: string | null } | null;
  items: Array<{ kind: MediaKind; shotId: string | null; credits: number; label: string; media: Media | null }>;
  canStart: boolean;
  blockedReason: string | null;
  pendingEstimate: CostEstimate;
  fullEstimate: CostEstimate;
  /** בהיגספילד: כמה השלב עולה בקרדיטים (באנלימיטד 0 בפועל) */
  hfCredits?: number;
  /** ההרצה האחרונה בהיגספילד בלחיצה (העובד במחשב) */
  hfRun?: { id: string; scope: 'pilot' | 'all'; status: 'queued' | 'running' | 'done' | 'failed'; total: number; done: number; credits: number; error: string } | null;
}

interface Overview {
  stages: StageView[];
  shots: Shot[];
  spentUsd: number;
  budgetUsd: number;
  kieConfigured: boolean;
  generator: 'kie' | 'higgsfield';
  hfRoute: 'unlimited' | 'credits';
  aspect: { image: string; video: string; out: { w: number; h: number } };
  autoAdvance: boolean;
}

const TITLE: Record<Stage, { n: string; title: string; what: string }> = {
  images: { n: '05', title: 'יצירת תמונות', what: 'תמונה לכל שוט מהפרומפט שבסטורי בורד (רפרנסים מאושרים משמשים כתמונות ייחוס)' },
  animation: { n: '06', title: 'הנפשה', what: 'כל תמונה מאושרת הופכת לקליפ לפי פרומפט התנועה של השוט' },
  audio: { n: '07', title: 'סאונד', what: 'קריינות מהתסריט המאושר ומוזיקת רקע' },
  editing: { n: '08', title: 'עריכה', what: 'חיבור הקליפים לפי הסדר, חיתוך לאורך השוטים, קריינות ומוזיקה מונמכת — בשרת, ללא עלות' },
  delivery: { n: '09', title: 'מסירה', what: 'הורדת הסרטון, שליחה ללקוח וסימון האישור שלו' },
};
const NEXT: Partial<Record<Stage, Stage>> = { images: 'animation', animation: 'audio', audio: 'editing', editing: 'delivery' };
const STATUS: Record<Media['status'], [string, string]> = {
  generating: ['info', 'נוצר…'],
  ready: ['warn', 'ממתין לאישור'],
  approved: ['ok', 'מאושר ✓'],
  rejected: ['neutral', 'הוחלף'],
  failed: ['danger', 'נכשל'],
};
const usd = (n: number) => `$${n.toFixed(2)}`;
const fileUrl = (m: Media) => `/api/media/${m.id}/file`;

export function ProductionTab({ detail, reload }: TabProps) {
  const { project } = detail;
  const { data, error, loading, reload: reloadProd } = useApi<Overview>(`/api/projects/${project.id}/production`, { pollMs: 4000 });
  const agent = useAgentTasks(project.id);
  const act = useAction();
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reloadProd} />;
  const o = data!;
  const refresh = async () => {
    await Promise.all([reloadProd(), reload()]);
  };
  const run = async (fn: () => Promise<unknown>) => {
    await act.run(fn);
    await refresh();
  };
  const byStage = Object.fromEntries(o.stages.map((s) => [s.stage, s])) as Record<Stage, StageView>;
  const shotNo = (id: string | null) => o.shots.find((s) => s.id === id)?.number;
  const pct = o.budgetUsd > 0 ? Math.min(100, Math.round((o.spentUsd / o.budgetUsd) * 100)) : 0;

  return (
    <div className="stack">
      <section className="card prod-head">
        <div className="row between wrap gap-s">
          <div>
            <h2>הפקה אוטומטית</h2>
            <p className="small muted">
              כל שלב רץ לבד ומחכה לאישור שלך. {o.autoAdvance ? 'אישור שלב מפעיל מיד את השלב הבא — העלות מוצגת על כפתור האישור.' : 'המשך אוטומטי כבוי — כל שלב מופעל בלחיצה.'}{' '}
              פורמט: {o.aspect.image} · סרטון סופי {o.aspect.out.w}×{o.aspect.out.h}
            </p>
          </div>
          {o.generator === 'higgsfield' ? (
            // בהיגספילד אין תקרת KIE — מה שנוצל בפועל בקרדיטים (מסונכרן מהמחשב)
            <div className="budget small" title="קרדיטים בהיגספילד שנוצלו בפרויקט (מתעדכן כל 15 דקות)">
              היגספילד: {detail.usage ? `נוצלו ${hfCostLabel(detail.usage.hfCredits)}` : 'עוד לא נמדד'}
            </div>
          ) : (
            <div className="budget">
              <div className="small">
                נוצל {usd(o.spentUsd)} מתוך תקרה של {usd(o.budgetUsd)}
              </div>
              <div className="progress small-progress">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
        </div>
        {o.generator === 'higgsfield' ? (
          <div className="notice">
            תמונות וקליפים בפרויקט הזה נוצרים ב-Higgsfield: בקש מ-Claude "תריץ תמונות לפרויקט", או העלה בעצמך עם "העלה" בכל שוט. Claude מריץ לפי המסלול שבחרת:
            <HfRouteToggle project={project} onChanged={reload} />
          </div>
        ) : (
          !o.kieConfigured && <div className="notice warn">KIE לא מחובר — לחץ על "מפתחות" בסרגל העליון כדי שהמערכת תוכל ליצור תמונות, וידאו וסאונד.</div>
        )}
        <InlineError error={act.error} onClose={act.clearError} />
      </section>

      {(['images', 'animation', 'audio', 'editing', 'delivery'] as Stage[]).map((st) => (
        <StageCard
          key={st}
          view={byStage[st]}
          next={NEXT[st] ? byStage[NEXT[st]!] : undefined}
          autoAdvance={o.autoAdvance}
          aspect={o.aspect.image}
          busy={act.busy}
          shotNo={shotNo}
          shots={o.shots}
          finalMedia={byStage.editing.items[0]?.media ?? null}
          onStart={() => run(() => api.post(`/api/projects/${project.id}/production/${st}/start`))}
          onApprove={() => run(() => api.post(`/api/projects/${project.id}/production/${st}/approve`, {}))}
          onReopen={() => run(() => api.post(`/api/projects/${project.id}/production/${st}/reopen`))}
          onDoneExternally={() => run(() => api.post(`/api/projects/${project.id}/production/${st}/done-externally`, {}))}
          onItem={(path, body) => run(() => api.post(path, body))}
          onUpload={(kind, shotId, file) =>
            run(() => api.upload(`/api/projects/${project.id}/media/upload?kind=${kind}${shotId ? `&shotId=${shotId}` : ''}&source=${o.generator === 'higgsfield' ? 'higgsfield-unlimited' : 'manual'}`, file))
          }
          external={o.generator === 'higgsfield'}
          hfRoute={o.hfRoute}
          projectId={project.id}
          agentTasks={agent.data ?? []}
          onAgentChanged={async () => { await agent.reload(); await refresh(); }}
          onHfRun={(scope) => run(() => api.post(`/api/projects/${project.id}/production/${st}/hf-run`, { scope }))}
        />
      ))}
    </div>
  );
}

/** הרצה בהיגספילד בלחיצה: פיילוט (שוט אחד) ואז הכל. במסלול אנלימיטד — הסבר איך להריץ */
function HfRunControls(props: { view: StageView; route: 'unlimited' | 'credits'; busy: boolean; missing: number; approved: boolean; onRun: (scope: 'pilot' | 'all') => void }) {
  const { view: v, route } = props;
  const r = v.hfRun;
  if (r && (r.status === 'queued' || r.status === 'running'))
    return (
      <Tag tone="info">
        <Icon n="hourglass" /> {r.status === 'queued' ? 'ממתין למחשב…' : `רץ בהיגספילד… ${r.done}/${r.total}`}
      </Tag>
    );
  if (props.approved || !v.canStart || props.missing <= 0) return r?.status === 'failed' ? <Tag tone="danger">ההרצה נכשלה: {r.error.slice(0, 80)}</Tag> : null;
  if (route !== 'credits') return null; // אנלימיטד — Claude מריץ בדפדפן (AgentStageControls)
  const per = v.items.length ? (v.hfCredits ?? 0) / v.items.length : 0;
  const all = per * props.missing;
  const label = (c: number) => `~${Math.round(c * 10) / 10} קרדיטים (${(c * 0.04).toFixed(2)})`;
  const pilotDone = !!r && r.scope === 'pilot' && r.status === 'done';
  return (
    <>
      {r?.status === 'failed' && <Tag tone="danger">ההרצה הקודמת נכשלה: {r.error.slice(0, 80)}</Tag>}
      <button
        className={`btn ${pilotDone ? '' : 'btn-primary'}`}
        disabled={props.busy}
        onClick={() => window.confirm(`להריץ פיילוט בהיגספילד — שוט אחד, ${label(per)}?`) && props.onRun('pilot')}
        title="שוט אחד קודם, בודקים, ורק אז הכל"
      >
        <Icon n="play" /> פיילוט: שוט אחד · {label(per)}
      </button>
      <button
        className={`btn ${pilotDone ? 'btn-primary' : ''}`}
        disabled={props.busy}
        onClick={() => window.confirm(`להריץ בהיגספילד את כל ${props.missing} השוטים שמחכים — ${label(all)}?`) && props.onRun('all')}
      >
        <Icon n="play" /> הרץ הכל ({props.missing}) · {label(all)}
      </button>
    </>
  );
}

function StageCard(props: {
  view: StageView;
  next?: StageView;
  autoAdvance: boolean;
  aspect: string;
  busy: boolean;
  shots: Shot[];
  shotNo: (id: string | null) => number | undefined;
  finalMedia: Media | null;
  onStart: () => void;
  onApprove: () => void;
  onReopen: () => void;
  onDoneExternally: () => void;
  onItem: (path: string, body?: unknown) => void;
  onUpload: (kind: MediaKind, shotId: string | null, file: File) => void;
  external: boolean;
  hfRoute: 'unlimited' | 'credits';
  onHfRun: (scope: 'pilot' | 'all') => void;
  projectId: string;
  agentTasks: AgentTask[];
  onAgentChanged: () => Promise<void> | void;
}) {
  const { view: v, next } = props;
  const t = TITLE[v.stage];
  const approved = !!v.gate?.approvedAt;
  const medias = v.items.map((i) => i.media);
  const created = medias.filter(Boolean).length;
  const generating = medias.filter((m) => m?.status === 'generating').length;
  const failed = medias.filter((m) => m && (m.status === 'failed' || m.status === 'rejected')).length;
  const ready = medias.filter((m) => m && (m.status === 'ready' || m.status === 'approved')).length;
  const total = v.items.length;
  const allReady = total > 0 && ready === total;
  const missing = total - created + failed;

  const nextHint = !(props.autoAdvance && next && next.stage !== 'delivery' && next.fullEstimate.lines.length)
    ? ''
    : props.external && next.hfCredits
      ? ` ← ${TITLE[next.stage].title} בהיגספילד · ${hfRouteCost(props.hfRoute, next.hfCredits)}`
      : ` ← יתחיל ${TITLE[next.stage].title}${next.fullEstimate.usd > 0 ? ` (~${usd(next.fullEstimate.usd)})` : ''}`;

  return (
    <section className={`card prod-stage ${approved ? 'prod-done' : ''}`}>
      <div className="row between wrap gap-s">
        <div>
          <h2>
            <span className="muted">{t.n}</span> {t.title}{' '}
            {approved ? (
              <Tag tone="ok">אושר ✓</Tag>
            ) : generating ? (
              <Tag tone="info">נוצרים {generating}…</Tag>
            ) : allReady ? (
              <Tag tone="warn">ממתין לאישור שלך</Tag>
            ) : v.stage === 'delivery' && props.finalMedia?.status === 'approved' ? (
              <Tag tone="warn">ממתין לאישור הלקוח</Tag>
            ) : null}
          </h2>
          <p className="small muted">{t.what}</p>
          {v.blockedReason && !approved && <p className="small muted"><Icon n="hourglass" /> {v.blockedReason}</p>}
        </div>
        <div className="row gap-s wrap">
          {props.external && (v.stage === 'images' || v.stage === 'animation') && (
            <HfRunControls view={v} route={props.hfRoute} busy={props.busy} missing={missing} approved={approved} onRun={props.onHfRun} />
          )}
          {v.stage !== 'delivery' && v.canStart && !approved && missing > 0 && !generating && !(props.external && (v.stage === 'images' || v.stage === 'animation')) && (
            <button className="btn btn-primary" disabled={props.busy} onClick={props.onStart}>
              <Icon n="play" /> {created ? `צור את החסרים (${missing})` : `הפעל — ${total} פריטים`}
              {v.pendingEstimate.usd > 0 ? ` · ~${usd(v.pendingEstimate.usd)}` : ''}
            </button>
          )}
          {v.stage !== 'delivery' && allReady && !approved && (
            <button className="btn btn-primary" disabled={props.busy} onClick={props.onApprove}>
              ✓ אשר {t.title}
              {nextHint}
            </button>
          )}
          {v.stage === 'delivery' && !approved && props.finalMedia?.status === 'approved' && (
            <>
              <a className="btn" href={`${fileUrl(props.finalMedia)}?download=1`}>
                <Icon n="download" /> הורד את הסרטון
              </a>
              <button className="btn btn-primary" disabled={props.busy} onClick={props.onApprove}>
                ✓ הלקוח אישר — סגור פרויקט
              </button>
            </>
          )}
          {!approved && v.stage !== 'delivery' && !generating && (
            <ConfirmButton
              className="btn btn-sm btn-ghost"
              onConfirm={props.onDoneExternally}
              disabled={props.busy}
              confirmLabel="לסמן כבוצע? לחץ שוב"
            >
              ✓ בוצע מחוץ למערכת
            </ConfirmButton>
          )}
          {approved && v.stage !== 'delivery' && (
            <ConfirmButton className="btn btn-sm" onConfirm={props.onReopen} disabled={props.busy} confirmLabel="לפתוח? אישור השלבים הבאים יתבטל">
              פתח מחדש
            </ConfirmButton>
          )}
        </div>
      </div>

      {props.external && (v.stage === 'images' || v.stage === 'animation') && (
        <AgentStageControls
          projectId={props.projectId}
          stage={v.stage}
          tasks={props.agentTasks}
          route={props.hfRoute}
          canRun={v.canStart && !approved && missing > 0}
          hasReady={medias.some((m) => m?.status === 'ready')}
          qaFailed={medias.filter((m) => m?.status === 'ready' && (m.params as { qa?: { verdict?: string } }).qa?.verdict === 'fail').length}
          onChanged={props.onAgentChanged}
        />
      )}

      {!props.external && v.pendingEstimate.lines.length > 0 && !created && v.canStart && (
        <div className="small muted">
          עלות משוערת: {v.pendingEstimate.lines.map((l) => `${l.count}× ${l.label} (${l.credits} קרדיטים)`).join(' · ')} = ~{usd(v.pendingEstimate.usd)}
        </div>
      )}

      {v.stage === 'delivery' ? (
        props.finalMedia?.status === 'approved' || approved ? (
          <div className="small muted">{approved ? `נמסר ואושר ${fmtDateTime(v.gate!.approvedAt!)}` : 'הסרטון הערוך אושר — שלח ללקוח.'}</div>
        ) : null
      ) : created === 0 && !(v.canStart && (props.external || v.stage === 'audio')) ? (
        !v.canStart ? null : <Empty title="עדיין לא נוצר דבר בשלב הזה" />
      ) : (
        <div className={`media-grid kind-${v.items[0]?.kind}`}>
          {v.items.map((it, i) =>
            it.media ? (
              <MediaCard
                key={it.media.id}
                m={it.media}
                label={it.shotId ? `שוט ${props.shotNo(it.shotId)}` : it.label}
                aspect={props.aspect}
                locked={approved}
                busy={props.busy}
                onItem={props.onItem}
                onUpload={v.canStart && !approved ? (f) => props.onUpload(it.kind, it.shotId, f) : undefined}
              />
            ) : (
              <div key={i} className="media-card media-empty">
                <div className="small muted">{it.shotId ? `שוט ${props.shotNo(it.shotId)}` : it.label}</div>
                <div className="small">{props.external && (it.kind === 'frame' || it.kind === 'clip') ? 'ממתין ל-Higgsfield' : 'טרם נוצר'}</div>
                {v.canStart && !approved && <UploadButton kind={it.kind} onFile={(f) => props.onUpload(it.kind, it.shotId, f)} />}
              </div>
            ),
          )}
        </div>
      )}
      {failed > 0 && !generating && <div className="small muted">פריט שנכשל לא נוצר שוב אוטומטית (זה היה עולה כסף שוב) — לחץ "צור מחדש" או "צור את החסרים".</div>}
    </section>
  );
}

const ACCEPT: Record<MediaKind, string> = { frame: 'image/*', clip: 'video/*', final: 'video/*', voiceover: 'audio/*', music: 'audio/*' };

function UploadButton({ kind, onFile }: { kind: MediaKind; onFile: (f: File) => void }) {
  return (
    <label className="btn btn-sm btn-ghost" title="העלאת קובץ שנוצר מחוץ למערכת (למשל ב-Higgsfield)">
      <Icon n="upload" /> העלה
      <input
        type="file"
        hidden
        accept={ACCEPT[kind]}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

function MediaCard({
  m,
  label,
  aspect,
  locked,
  busy,
  onItem,
  onUpload,
}: {
  m: Media;
  label: string;
  aspect: string;
  locked: boolean;
  busy: boolean;
  onItem: (p: string, b?: unknown) => void;
  onUpload?: (f: File) => void;
}) {
  const [redo, setRedo] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [comparing, setComparing] = useState(false);
  // תוצר מהיגספילד: תיקון שנשלח לריצה בעצמו, וריאציות והשוואת טייקים
  const hfItem = m.provider === 'higgsfield' && (m.kind === 'frame' || m.kind === 'clip');
  const qaNote = (m.params as { qa?: { verdict?: string; note?: string } }).qa?.verdict === 'fail' ? ((m.params as { qa?: { note?: string } }).qa?.note ?? '') : '';
  const [showPrompt, setShowPrompt] = useState(false);
  const [tone, text] = STATUS[m.status];
  const ratio = aspect.replace(':', ' / ');
  const hasFile = !!m.assetId && m.status !== 'generating';
  return (
    <div className={`media-card st-${m.status}`}>
      <div className="row between gap-s">
        <strong className="small">
          {label} <span className="muted">v{m.version}</span>
        </strong>
        <Tag tone={tone}>{text}</Tag>
      </div>
      <QaBadge qa={(m.params as { qa?: { verdict: 'pass' | 'fail'; note: string } } | undefined)?.qa} />
      <div className="media-view" style={m.kind === 'frame' || m.kind === 'clip' || m.kind === 'final' ? { aspectRatio: ratio } : undefined}>
        {m.status === 'generating' ? (
          <div className="media-wait">
            <span className="spinner" /> נוצר…
          </div>
        ) : m.status === 'failed' ? (
          <div className="media-wait error-text small">{m.error}</div>
        ) : !hasFile ? (
          <div className="media-wait small muted">אין קובץ</div>
        ) : m.kind === 'frame' ? (
          <a href={fileUrl(m)} target="_blank" rel="noreferrer">
            <img src={fileUrl(m)} alt={label} loading="lazy" />
          </a>
        ) : m.kind === 'clip' || m.kind === 'final' ? (
          <video src={fileUrl(m)} controls preload="metadata" playsInline loop={m.kind === 'clip'} />
        ) : (
          <audio src={fileUrl(m)} controls preload="metadata" />
        )}
      </div>
      <div className="small muted">
        {m.model || '—'}
        {m.durationSec ? ` · ${m.durationSec.toFixed(1)} ש׳` : ''}
        {m.costCredits != null ? ` · ${m.costCredits} קרדיטים (~$${(m.costCredits * 0.005).toFixed(2)})` : ''}
        {m.provider === 'higgsfield' ? (m.params.hfCredits ? ` · ${String(m.params.hfCredits)} קרדיטים ב-Higgsfield` : ' · ללא עלות') : ''}
      </div>
      {m.note && <div className="small">הערה: {m.note}</div>}
      {m.prompt && (
        <button className="btn-link small" onClick={() => setShowPrompt(!showPrompt)}>
          {showPrompt ? 'הסתר פרומפט' : m.kind === 'voiceover' ? 'הצג טקסט' : 'הצג פרומפט'}
        </button>
      )}
      {showPrompt && <pre className="prompt-box" dir="ltr">{m.prompt}</pre>}
      {m.kind === 'final' && hasFile && (
        <a className="btn btn-sm" href={`${fileUrl(m)}?download=1`}>
          <Icon n="download" /> הורד
        </a>
      )}
      {!locked && m.status !== 'generating' && m.status !== 'rejected' && (
        <div className="row gap-s wrap">
          {m.status === 'ready' && (
            <button className="btn btn-sm" disabled={busy} onClick={() => onItem(`/api/media/${m.id}/approve`)}>
              ✓ אשר
            </button>
          )}
          {m.status === 'approved' && (
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onItem(`/api/media/${m.id}/unapprove`)}>
              בטל אישור
            </button>
          )}
          <button
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={() => {
              if (!redo && hfItem && qaNote && !feedback) setFeedback(qaNote);
              setRedo(!redo);
            }}
          >
            ↻ {hfItem ? 'תקן' : m.provider === 'manual' ? 'בקש גרסה חדשה' : 'צור מחדש'}
          </button>
          {hfItem && (
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => window.confirm('להריץ 3 טייקים נוספים לשוט הזה? הקיים נשאר, ובוחרים בהשוואה.') && onItem(`/api/media/${m.id}/variants`, { count: 3 })}>
              ✦ 3 וריאציות
            </button>
          )}
          {hfItem && m.version > 1 && (
            <button className="btn btn-sm btn-ghost" onClick={() => setComparing(true)}>
              ⇆ השווה טייקים
            </button>
          )}
          {onUpload && <UploadButton kind={m.kind} onFile={onUpload} />}
        </div>
      )}
      {!locked && m.status === 'rejected' && onUpload && <UploadButton kind={m.kind} onFile={onUpload} />}
      {redo && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            onItem(hfItem ? `/api/media/${m.id}/fix` : `/api/media/${m.id}/regenerate`, { feedback });
            setRedo(false);
            setFeedback('');
          }}
        >
          <input
            placeholder={m.kind === 'frame' ? 'מה לשנות? (למשל: הדמות מחייכת, תאורה חמה יותר)' : m.kind === 'clip' ? 'מה לשנות בתנועה?' : 'מה לשנות? (אופציונלי)'}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="small muted">
            {hfItem
              ? 'רק מה שכתבת משתנה. השוט נשלח לריצה בהיגספילד לפי המסלול שבחרת — בלי צ׳אט.'
              : m.provider === 'manual'
              ? 'ההערה נשמרת לשוט, והגרסה הבאה תיווצר ב-Higgsfield.'
              : `${m.kind === 'frame' || m.kind === 'clip' ? 'Claude ישכתב את הפרומפט לפי ההערה. ' : ''}יצירה מחדש עולה כמו היצירה המקורית.`}
          </div>
          <button className="btn btn-sm btn-primary" disabled={busy || (hfItem && !feedback.trim())}>
            {hfItem ? 'תקן ושלח להרצה' : 'צור גרסה חדשה'}
          </button>
        </form>
      )}
      {comparing && <CompareTakes media={m} aspect={aspect} onPick={(id) => { onItem(`/api/media/${id}/pick`); setComparing(false); }} onClose={() => setComparing(false)} />}
    </div>
  );
}

/** כל הטייקים של שוט זה לצד זה — בוחרים אחד, הוא מאושר והשאר נדחים */
function CompareTakes({ media, aspect, onPick, onClose }: { media: Media; aspect: string; onPick: (id: string) => void; onClose: () => void }) {
  const { data } = useApi<Media[]>(`/api/media/${media.id}/versions`);
  return (
    <Modal title="השוואת טייקים" onClose={onClose} wide>
      <div className="compare-grid">
        {(data ?? []).map((v) => (
          <div key={v.id} className={`media-card st-${v.status}`}>
            <div className="row between gap-s">
              <strong className="small">v{v.version}</strong>
              <Tag tone={STATUS[v.status][0]}>{STATUS[v.status][1]}</Tag>
            </div>
            <QaBadge qa={(v.params as { qa?: { verdict: 'pass' | 'fail'; note: string } }).qa} />
            <div className="media-view" style={{ aspectRatio: aspect.replace(':', ' / ') }}>
              {v.kind === 'frame' ? <img src={fileUrl(v)} alt={`v${v.version}`} /> : <video src={fileUrl(v)} controls preload="metadata" playsInline loop />}
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => onPick(v.id)}>
              ✓ בחר את זה
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
