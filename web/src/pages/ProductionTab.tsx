import type { CostEstimate, Media, MediaKind, Shot } from '@apos/shared';
import { useState } from 'react';
import { ConfirmButton, Empty, ErrorBox, InlineError, Loading, Tag } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import type { TabProps } from './ProjectPage';

type Stage = 'images' | 'animation' | 'audio' | 'editing' | 'delivery';

interface StageView {
  stage: Stage;
  gate: { startedAt: string | null; approvedAt: string | null; approvedBy: string | null } | null;
  items: Array<{ kind: MediaKind; shotId: string | null; credits: number; label: string; media: Media | null }>;
  canStart: boolean;
  blockedReason: string | null;
  pendingEstimate: CostEstimate;
  fullEstimate: CostEstimate;
}

interface Overview {
  stages: StageView[];
  shots: Shot[];
  spentUsd: number;
  budgetUsd: number;
  kieConfigured: boolean;
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
          <div className="budget">
            <div className="small">
              נוצל {usd(o.spentUsd)} מתוך תקרה של {usd(o.budgetUsd)}
            </div>
            <div className="progress small-progress">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
        {!o.kieConfigured && <div className="notice warn">KIE לא מחובר — לחץ על "מפתחות" בסרגל העליון כדי שהמערכת תוכל ליצור תמונות, וידאו וסאונד.</div>}
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
          onItem={(path, body) => run(() => api.post(path, body))}
        />
      ))}
    </div>
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
  onItem: (path: string, body?: unknown) => void;
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

  const nextHint =
    props.autoAdvance && next && next.stage !== 'delivery' && next.fullEstimate.lines.length
      ? ` ← יתחיל ${TITLE[next.stage].title}${next.fullEstimate.usd > 0 ? ` (~${usd(next.fullEstimate.usd)})` : ''}`
      : '';

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
          {v.blockedReason && !approved && <p className="small muted">⏳ {v.blockedReason}</p>}
        </div>
        <div className="row gap-s wrap">
          {v.stage !== 'delivery' && v.canStart && !approved && missing > 0 && !generating && (
            <button className="btn btn-primary" disabled={props.busy} onClick={props.onStart}>
              ▶ {created ? `צור את החסרים (${missing})` : `הפעל — ${total} פריטים`}
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
                ⬇ הורד את הסרטון
              </a>
              <button className="btn btn-primary" disabled={props.busy} onClick={props.onApprove}>
                ✓ הלקוח אישר — סגור פרויקט
              </button>
            </>
          )}
          {approved && v.stage !== 'delivery' && (
            <ConfirmButton className="btn btn-sm" onConfirm={props.onReopen} disabled={props.busy} confirmLabel="לפתוח? אישור השלבים הבאים יתבטל">
              פתח מחדש
            </ConfirmButton>
          )}
        </div>
      </div>

      {v.pendingEstimate.lines.length > 0 && !created && v.canStart && (
        <div className="small muted">
          עלות משוערת: {v.pendingEstimate.lines.map((l) => `${l.count}× ${l.label} (${l.credits} קרדיטים)`).join(' · ')} = ~{usd(v.pendingEstimate.usd)}
        </div>
      )}

      {v.stage === 'delivery' ? (
        props.finalMedia?.status === 'approved' || approved ? (
          <div className="small muted">{approved ? `נמסר ואושר ${fmtDateTime(v.gate!.approvedAt!)}` : 'הסרטון הערוך אושר — שלח ללקוח.'}</div>
        ) : null
      ) : created === 0 ? (
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
              />
            ) : (
              <div key={i} className="media-card media-empty">
                <div className="small muted">{it.shotId ? `שוט ${props.shotNo(it.shotId)}` : it.label}</div>
                <div className="small">טרם נוצר</div>
              </div>
            ),
          )}
        </div>
      )}
      {failed > 0 && !generating && <div className="small muted">פריט שנכשל לא נוצר שוב אוטומטית (זה היה עולה כסף שוב) — לחץ "צור מחדש" או "צור את החסרים".</div>}
    </section>
  );
}

function MediaCard({ m, label, aspect, locked, busy, onItem }: { m: Media; label: string; aspect: string; locked: boolean; busy: boolean; onItem: (p: string, b?: unknown) => void }) {
  const [redo, setRedo] = useState(false);
  const [feedback, setFeedback] = useState('');
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
          ⬇ הורד
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
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setRedo(!redo)}>
            ↻ צור מחדש
          </button>
        </div>
      )}
      {redo && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            onItem(`/api/media/${m.id}/regenerate`, { feedback });
            setRedo(false);
            setFeedback('');
          }}
        >
          <input
            placeholder={m.kind === 'frame' ? 'מה לשנות? (למשל: הדמות מחייכת, תאורה חמה יותר)' : m.kind === 'clip' ? 'מה לשנות בתנועה?' : 'מה לשנות? (אופציונלי)'}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="small muted">{m.kind === 'frame' || m.kind === 'clip' ? 'Claude ישכתב את הפרומפט לפי ההערה. ' : ''}יצירה מחדש עולה כמו היצירה המקורית.</div>
          <button className="btn btn-sm btn-primary" disabled={busy}>
            צור גרסה חדשה
          </button>
        </form>
      )}
    </div>
  );
}
