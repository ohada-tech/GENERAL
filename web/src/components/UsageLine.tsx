/**
 * עלות פרויקט בשורה אחת: קרדיטים בהיגספילד ($), טוקנים של Claude Code ו-≈% מהמגבלה השבועית.
 * הנתונים מסונכרנים מהמחשב של אוהד — מוצג גם מתי עודכנו.
 */
import { fmtTokens, weeklyWindow, type PlanUsage, type ProjectUsage } from '@apos/shared';
import { fmtRelative } from '../lib/format';
import { Icon } from './Icon';

export function UsageLine({ usage, compact }: { usage?: ProjectUsage | null; compact?: boolean }) {
  if (!usage) return null;
  const t = usage.tokens;
  const title = [
    `היגספילד: ${usage.hfCredits} קרדיטים ≈ $${usage.hfUsd}`,
    `Claude Code: ${t.total.toLocaleString('he-IL')} טוקנים (קלט ${fmtTokens(t.input + t.cacheWrite)} · פלט ${fmtTokens(t.output)} · מטמון ${fmtTokens(t.cacheRead)}) ב-${usage.sessions} סשנים`,
    usage.weekPct !== null ? `≈${usage.weekPct}% מהמגבלה השבועית (${Math.round(usage.weekShare * 100)}% מהשימוש השבוע)` : `${Math.round(usage.weekShare * 100)}% מהשימוש השבוע`,
    `עודכן ${fmtRelative(usage.updatedAt)}`,
  ].join('\n');
  return (
    <div className={`usage-line ${compact ? 'small' : ''}`} title={title} onClick={(e) => e.stopPropagation()}>
      <span>
        <Icon n="image" /> {usage.hfCredits.toLocaleString('he-IL')} קרדיטים · ${usage.hfUsd.toLocaleString('he-IL')}
      </span>
      <span>
        <Icon n="brain" /> {fmtTokens(t.total)} טוקנים
      </span>
      {usage.weekPct !== null && <span>≈{usage.weekPct}% שבועי</span>}
    </div>
  );
}

/** מגבלות החשבון (5 שעות / שבועי) לראש הדשבורד */
export function PlanLine({ plan }: { plan?: PlanUsage | null }) {
  if (!plan) return null;
  const weekly = weeklyWindow(plan);
  const short = plan.windows.find((w) => /5|hour|שעות/i.test(w.label));
  return (
    <div className="usage-line small" title={plan.windows.map((w) => `${w.label}: ${w.percentUsed}%`).join('\n') + `\nנמדד ${fmtRelative(plan.at)}`}>
      <span>
        <Icon n="brain" /> Claude Code:
      </span>
      {short && <span>{short.percentUsed}% מ-5 שעות</span>}
      {weekly && <span>{weekly.percentUsed}% מהמגבלה השבועית</span>}
      <span className="muted">· {fmtRelative(plan.at)}</span>
    </div>
  );
}
