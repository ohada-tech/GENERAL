/**
 * ראש עמוד הפרויקט (AP 1.0): כרטיס עם תמונת השער, השם, הסטטוס, טבעת התקדמות
 * וכפתור אחד גדול לפעולה הבאה — ומסילת שלבים אחת בצד במקום פס שלבים + באנר + לשוניות.
 */
import { STAGE_BY_KEY, STATUS_LABELS, type ProjectState, type StageKey } from '@apos/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { assetUrl } from '../lib/api';
import { StatusBadge } from './ui';

export type Cover = { mediaId?: string; assetId?: string } | null | undefined;

/** צבע קבוע לפרויקט (כמו בכרטיס בדשבורד) */
export function hueOf(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function coverSrc(cover: Cover) {
  if (cover?.mediaId) return `/api/media/${cover.mediaId}/file`;
  if (cover?.assetId) return assetUrl(cover.assetId);
  return null;
}

function Ring({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ph-ring" viewBox="0 0 64 64" role="img" aria-label={`התקדמות ${value}%`}>
      <defs>
        <linearGradient id="ph-ring-g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#7ee6e6" />
          <stop offset="100%" stopColor="#c8a6ff" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="url(#ph-ring-g)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${(c * Math.min(100, Math.max(0, value))) / 100} ${c}`}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="36.5" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor">
        {value}%
      </text>
    </svg>
  );
}

export function ProjectHero({
  id,
  name,
  client,
  cover,
  state,
  meta,
  under,
  actions,
}: {
  id: string;
  name: string;
  client: string;
  cover: Cover;
  state: ProjectState;
  meta: ReactNode;
  under?: ReactNode;
  actions: ReactNode;
}) {
  const src = coverSrc(cover);
  const h = hueOf(id);
  const next = state.nextAction;
  return (
    <section className="ph" style={{ '--h1': h, '--h2': (h + 48) % 360 } as React.CSSProperties}>
      <div className="ph-art" aria-hidden>
        {src ? <img src={src} alt="" /> : <span className="ph-word">{(client || name).replace(/\(.*?\)/g, '').trim().split(/\s+/)[0]}</span>}
      </div>
      <div className="ph-body">
        <div className="ph-main">
          <div className="ph-crumbs">
            <Link to="/">היום</Link> <span>/</span> <span>{name}</span>
          </div>
          <h1 className="ph-title">{name}</h1>
          <div className="ph-meta">
            <StatusBadge status={state.overallStatus} />
            {state.pipelineState === 'paused' && <span className="badge st-waiting_internal">מושהה</span>}
            {state.pipelineState === 'stopped' && <span className="badge st-blocked">עצור</span>}
            {meta}
          </div>
          {under}
        </div>
        <div className="ph-side">
          <Ring value={state.progress} />
          {next ? (
            <Link className={`ph-next ph-next-${next.kind}`} to={`/projects/${id}/${next.tab}`}>
              <span className="ph-next-kind">{next.kind === 'approval' ? 'מחכה לאישור שלך' : next.kind === 'fix' ? 'צריך תיקון' : 'הצעד הבא'}</span>
              <span className="ph-next-label">{next.label} ←</span>
            </Link>
          ) : (
            <div className="ph-next ph-next-done">
              <span className="ph-next-kind">אין פעולה פתוחה</span>
              <span className="ph-next-label">הכול מעודכן ✓</span>
            </div>
          )}
          <div className="ph-actions">{actions}</div>
        </div>
      </div>
    </section>
  );
}

const ICON: Record<string, string> = { completed: '✓', blocked: '!', needs_revision: '↺', in_progress: '…' };

/** מסילת השלבים: 9 שלבים עם הסטטוס שלהם + שאר מסכי הפרויקט. בטלפון — שורה נגללת */
export function StageRail({
  id,
  state,
  tab,
  stageTab,
  extra,
}: {
  id: string;
  state: ProjectState;
  tab: string;
  stageTab: Partial<Record<StageKey, string>>;
  extra: Array<{ key: string; label: string }>;
}) {
  return (
    <nav className="rail" aria-label="שלבי ההפקה">
      <div className="rail-title">שלבי ההפקה</div>
      <ol className="rail-list">
        {state.stages.map((s) => {
          const def = STAGE_BY_KEY[s.key];
          const to = stageTab[s.key] ?? 'overview';
          const here = tab === to;
          const now = s.key === state.currentStage;
          return (
            <li key={s.key}>
              <Link
                to={`/projects/${id}/${to}`}
                className={`rail-step rs-${s.status} ${now ? 'rail-now' : ''} ${here ? 'rail-here' : ''}`}
                title={`${def.label} — ${STATUS_LABELS[s.status].he}\n${s.detail}`}
                aria-current={here ? 'page' : undefined}
              >
                <span className="rail-dot">{ICON[s.status] ?? def.number}</span>
                <span className="rail-text">
                  <span className="rail-name">{def.label}</span>
                  <span className="rail-status">{s.availability === 'planned' ? 'בקרוב' : STATUS_LABELS[s.status].he}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="rail-sep" />
      <ul className="rail-extra">
        {extra.map((t) => (
          <li key={t.key}>
            <Link to={`/projects/${id}/${t.key}`} className={`rail-link ${tab === t.key ? 'rail-here' : ''}`} aria-current={tab === t.key ? 'page' : undefined}>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
