/**
 * שלב ההנפשה — הנפשה מותאמת אישית: הכל יחד, או חלוקה לשוטי פנים ולשאר השוטים.
 * לכל קבוצה בוחרים מסלול (אנלימיטד = Claude בדפדפן, 0 קרדיטים / קרדיטים = ה-CLI במחשב) ומודל הנפשה.
 * עובד בכל פרויקט היגספילד, בלי קשר למסלול שנבחר לפרויקט. קרדיטים — אישור בלחיצה שנייה עם העלות.
 */
import { VIDEO_MODELS, hfCostLabel, hfVideoCredits, isFaceShot, videoModelForShot, type Media, type Shot } from '@apos/shared';
import { useState } from 'react';
import { api, useAction } from '../lib/api';
import { Icon } from './Icon';
import { ConfirmButton, InlineError } from './ui';

type Route = 'unlimited' | 'credits';
type Group = 'all' | 'faces' | 'others';
interface GroupCfg {
  route: Route;
  /** '' = לפי ההמלצה בכל שוט */
  model: string;
}
interface Cfg {
  mode: 'all' | 'split';
  all: GroupCfg;
  faces: GroupCfg;
  others: GroupCfg;
}

const KEY = 'apos.animRunCfg';
const ROUTES = new Set<Route>(['unlimited', 'credits']);
const MODELS = new Set(VIDEO_MODELS.map((m) => m.id));

function fix(g: Partial<GroupCfg> | undefined, d: GroupCfg): GroupCfg {
  return { route: g?.route && ROUTES.has(g.route) ? g.route : d.route, model: g?.model === '' || (g?.model && MODELS.has(g.model)) ? g.model : d.model };
}

function load(defaultRoute: Route): Cfg {
  const d: Cfg = {
    mode: 'all',
    all: { route: defaultRoute, model: '' },
    faces: { route: 'credits', model: 'seedance-2' },
    others: { route: 'unlimited', model: 'kling-3.0' },
  };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Cfg> | null;
    if (!s) return d;
    return { mode: s.mode === 'split' ? 'split' : 'all', all: fix(s.all, d.all), faces: fix(s.faces, d.faces), others: fix(s.others, d.others) };
  } catch {
    return d;
  }
}

const GROUP_HE: Record<Group, string> = { all: 'כל השוטים', faces: 'שוטי פנים', others: 'שאר השוטים (בלי פנים)' };

export function AnimationRunPanel(props: {
  projectId: string;
  items: Array<{ shotId: string | null; media: Media | null }>;
  shots: Shot[];
  defaultRoute: Route;
  /** יש הרצה פעילה בקרדיטים / משימת אנלימיטד פעילה בשלב */
  hfActive: boolean;
  agentActive: boolean;
  busy: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [cfg, setCfg] = useState<Cfg>(() => load(props.defaultRoute));
  const act = useAction();
  const save = (next: Cfg) => {
    setCfg(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* פרטי */
    }
  };
  const setGroup = (g: Group, patch: Partial<GroupCfg>) => save({ ...cfg, [g]: { ...cfg[g], ...patch } });

  const byId = new Map(props.shots.map((s) => [s.id, s]));
  const waiting = props.items
    .filter((i) => i.shotId && (!i.media || i.media.status === 'failed' || i.media.status === 'rejected'))
    .map((i) => byId.get(i.shotId!))
    .filter((s): s is Shot => !!s);
  if (!waiting.length) return null;
  const shotsOf = (g: Group) => (g === 'all' ? waiting : waiting.filter((s) => isFaceShot(s) === (g === 'faces')));
  const groups: Group[] = cfg.mode === 'all' ? ['all'] : (['faces', 'others'] as Group[]).filter((g) => shotsOf(g).length > 0);
  const modelFor = (g: Group, s: Shot) => cfg[g].model || videoModelForShot(s.animationModel ?? '', 'kling-3.0').id;
  const creditsOf = (g: Group, scope: 'pilot' | 'all') => {
    const list = shotsOf(g);
    return (scope === 'pilot' ? list.slice(0, 1) : list).reduce((a, s) => a + hfVideoCredits(modelFor(g, s), s.durationSec || 5), 0);
  };
  const byRoute = (r: Route) => groups.filter((g) => cfg[g].route === r);
  const credit = byRoute('credits');
  const unlimited = byRoute('unlimited');
  const blocked = (credit.length > 0 && props.hfActive) || (unlimited.length > 0 && props.agentActive);
  const cost = (scope: 'pilot' | 'all') => credit.reduce((a, g) => a + creditsOf(g, scope), 0);

  /** גוף הבקשה לקבוצות שרצות באותו מסלול: קבוצה אחת — group + model; שתיהן — מודל לפנים ומודל לשאר */
  const body = (list: Group[]) =>
    list.length === 1
      ? { group: list[0], model: cfg[list[0]].model || undefined }
      : { group: 'all', faceModel: cfg.faces.model || undefined, otherModel: cfg.others.model || undefined };

  const launch = (scope: 'pilot' | 'all') =>
    act.run(async () => {
      if (credit.length) await api.post(`/api/projects/${props.projectId}/production/animation/hf-run`, { scope, custom: true, ...body(credit) });
      if (unlimited.length) await api.post(`/api/projects/${props.projectId}/agent`, { kind: 'hf_unlimited', stage: 'animation', scope, ...body(unlimited) });
      await props.onChanged();
    });

  const disabled = props.busy || act.busy || blocked || groups.length === 0;
  const label = (scope: 'pilot' | 'all') => {
    const c = cost(scope);
    const parts = [credit.length ? `~${hfCostLabel(c)}` : '', unlimited.length ? (credit.length ? 'השאר באנלימיטד' : '0 קרדיטים (אנלימיטד)') : ''].filter(Boolean);
    return parts.join(' · ');
  };
  const RunBtn = ({ scope, primary, children }: { scope: 'pilot' | 'all'; primary?: boolean; children: React.ReactNode }) =>
    credit.length ? (
      <ConfirmButton className={`btn ${primary ? 'btn-primary' : ''}`} disabled={disabled} onConfirm={() => launch(scope)} confirmLabel={`לחץ שוב להרצה · ${label(scope)}`}>
        {children}
      </ConfirmButton>
    ) : (
      <button className={`btn ${primary ? 'btn-primary' : ''}`} disabled={disabled} onClick={() => void launch(scope)}>
        {children}
      </button>
    );

  return (
    <div className="stack anim-run-panel" style={{ border: '1px solid var(--line, #ddd)', borderRadius: 10, padding: 10, gap: 8 }}>
      <div className="row gap-s wrap" style={{ alignItems: 'center' }}>
        <strong className="small">
          <Icon n="play" /> הנפשה בהתאמה אישית
        </strong>
        <span className="row gap-s">
          <button className={`btn btn-sm ${cfg.mode === 'all' ? 'btn-primary' : ''}`} onClick={() => save({ ...cfg, mode: 'all' })}>
            הכל במודל אחד
          </button>
          <button className={`btn btn-sm ${cfg.mode === 'split' ? 'btn-primary' : ''}`} onClick={() => save({ ...cfg, mode: 'split' })}>
            חלוקה: פנים / שאר
          </button>
        </span>
      </div>
      {(cfg.mode === 'all' ? (['all'] as Group[]) : (['faces', 'others'] as Group[])).map((g) => {
        const list = shotsOf(g);
        return (
          <div key={g} className="row gap-s wrap" style={{ alignItems: 'center' }} title={list.length ? `שוטים: ${list.map((s) => s.number).join(', ')}` : undefined}>
            <span className="small" style={{ minWidth: 150 }}>
              {GROUP_HE[g]} ({list.length})
            </span>
            <select aria-label={`מסלול · ${GROUP_HE[g]}`} value={cfg[g].route} disabled={!list.length} onChange={(e) => setGroup(g, { route: e.target.value as Route })}>
              <option value="unlimited">אנלימיטד (0 קרדיטים)</option>
              <option value="credits">קרדיטים</option>
            </select>
            <select aria-label={`מודל · ${GROUP_HE[g]}`} value={cfg[g].model} disabled={!list.length} onChange={(e) => setGroup(g, { model: e.target.value })}>
              <option value="">לפי ההמלצה בכל שוט</option>
              {VIDEO_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {list.length > 0 && cfg[g].route === 'credits' && <span className="small muted">~{hfCostLabel(creditsOf(g, 'all'))}</span>}
            {!list.length && <span className="small muted">אין שוטים שמחכים</span>}
          </div>
        );
      })}
      <div className="row gap-s wrap">
        <RunBtn scope="pilot">
          <Icon n="play" /> פיילוט: שוט אחד{cfg.mode === 'split' && groups.length > 1 && credit.length && unlimited.length ? ' מכל קבוצה' : ''}
        </RunBtn>
        <RunBtn scope="all" primary>
          <Icon n="play" /> הנפש ({groups.reduce((a, g) => a + shotsOf(g).length, 0)}) · {label('all')}
        </RunBtn>
      </div>
      {blocked && <div className="small muted">יש כבר הרצה פעילה במסלול שבחרת — אפשר להריץ שוב כשהיא תסתיים.</div>}
      <InlineError error={act.error} onClose={act.clearError} />
    </div>
  );
}
