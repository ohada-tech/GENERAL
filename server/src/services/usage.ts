/**
 * עלות לכל פרויקט — קרדיטים בהיגספילד, טוקנים של Claude Code וחלק מהמגבלה השבועית.
 * המחשב של אוהד שולח סיכום מלא (usage-sync.cjs) — כל סנכרון מחליף את הקודם.
 */
import {
  HF_CREDIT_USD,
  planUsageSchema,
  tokensTotal,
  usageSyncSchema,
  weeklyWindow,
  type PlanUsage,
  type ProjectUsage,
} from '@apos/shared';
import type { Ctx } from '../context.js';
import { GateError } from '../context.js';
import { tx } from '../db/db.js';

const meta = (ctx: Ctx, key: string) => (ctx.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
const setMeta = (ctx: Ctx, key: string, value: string) =>
  ctx.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

export function syncUsage(ctx: Ctx, body: unknown) {
  const r = usageSyncSchema.safeParse(body);
  if (!r.success) throw new GateError('נתוני שימוש לא תקינים', 400);
  const now = ctx.now().toISOString();
  const known = new Set((ctx.db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>).map((p) => p.id));
  let saved = 0;
  tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM project_usage').run();
    const ins = ctx.db.prepare(
      `INSERT INTO project_usage (project_id, hf_credits, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, week_weight, sessions, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of r.data.projects) {
      if (!known.has(p.projectId)) continue;
      ins.run(p.projectId, p.hfCredits, p.tokens.input, p.tokens.output, p.tokens.cacheRead, p.tokens.cacheWrite, p.weekWeight, p.sessions, now);
      saved++;
    }
    setMeta(ctx, 'usage_week_total', JSON.stringify({ weekWeightTotal: r.data.weekWeightTotal, at: now }));
  });
  return { saved };
}

export function setPlanUsage(ctx: Ctx, body: unknown): PlanUsage {
  const r = planUsageSchema.safeParse(body);
  if (!r.success || !r.data.windows.length) throw new GateError('נתוני מגבלה לא תקינים', 400);
  const plan: PlanUsage = { windows: r.data.windows, at: ctx.now().toISOString() };
  setMeta(ctx, 'plan_usage', JSON.stringify(plan));
  return plan;
}

export function planUsage(ctx: Ctx): PlanUsage | null {
  const v = meta(ctx, 'plan_usage');
  return v ? (JSON.parse(v) as PlanUsage) : null;
}

export function usageFor(ctx: Ctx, projectId: string): ProjectUsage | null {
  const row = ctx.db.prepare('SELECT * FROM project_usage WHERE project_id = ?').get(projectId) as
    | { hf_credits: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; week_weight: number; sessions: number; updated_at: string }
    | undefined;
  if (!row) return null;
  const tokens = { input: row.input_tokens, output: row.output_tokens, cacheRead: row.cache_read_tokens, cacheWrite: row.cache_write_tokens };
  const total = (JSON.parse(meta(ctx, 'usage_week_total') ?? '{}') as { weekWeightTotal?: number }).weekWeightTotal ?? 0;
  const weekShare = total > 0 ? Math.min(1, row.week_weight / total) : 0;
  const weekly = weeklyWindow(planUsage(ctx));
  return {
    hfCredits: Math.round(row.hf_credits * 100) / 100,
    hfUsd: Math.round(row.hf_credits * HF_CREDIT_USD * 100) / 100,
    tokens: { ...tokens, total: tokensTotal(tokens) },
    sessions: row.sessions,
    weekShare,
    weekPct: weekly ? Math.round(weekShare * weekly.percentUsed * 10) / 10 : null,
    updatedAt: row.updated_at,
  };
}
