/**
 * מסלול היגספילד לפרויקט: אנלימיטד (A — חינם, בדפדפן, איטי) או קרדיטים (B — מהיר, דרך ה-CLI).
 * Claude מריץ לפי הבחירה שנשמרת בפרויקט (settings.hfRoute).
 */
import { hfCostLabel, type Project } from '@apos/shared';
import { api, useAction } from '../lib/api';

export function HfRouteToggle({ project, onChanged }: { project: Project; onChanged: () => Promise<void> | void }) {
  const act = useAction();
  const route = project.settings.hfRoute;
  const set = async (hfRoute: 'unlimited' | 'credits') => {
    if (hfRoute === route) return;
    await act.run(() => api.patch(`/api/projects/${project.id}`, { settings: { hfRoute } }));
    await onChanged();
  };
  return (
    <div className="seg" role="group" aria-label="מסלול היגספילד" title="איך Claude מייצר בהיגספילד בפרויקט הזה">
      <button className={route === 'unlimited' ? 'on' : ''} aria-pressed={route === 'unlimited'} disabled={act.busy} onClick={() => set('unlimited')}>
        אנלימיטד
      </button>
      <button className={route === 'credits' ? 'on' : ''} aria-pressed={route === 'credits'} disabled={act.busy} onClick={() => set('credits')}>
        קרדיטים
      </button>
    </div>
  );
}

/** "אנלימיטד, 0 קרדיטים (בקרדיטים: ~54 קרדיטים ($2.16))" / "~54 קרדיטים ($2.16)" */
export function hfRouteCost(route: 'unlimited' | 'credits', credits: number) {
  return route === 'credits' ? `~${hfCostLabel(credits)}` : `אנלימיטד, 0 קרדיטים (בקרדיטים: ~${hfCostLabel(credits)})`;
}
