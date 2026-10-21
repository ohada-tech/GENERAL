/**
 * "🎯 כיוון קריאייטיב" במסך האפיון, ותסריט לבדיקה בלי שמירה.
 * שניהם עוברים באותו תהליך קריאייטיבי (creative.ts) — אין מסלול מקביל.
 */
import type { Concept } from '@apos/shared';
import type { Ctx } from '../context.js';
import { getProject } from '../db/repo.js';
import type { TextProvider } from '../providers/types.js';
import { chooseConcept, extractIntel, runCreativePipeline, type PipelineResult } from './creative.js';

export { writingContext } from './creative.js';

/** הבנת מוצר (אם חסרה) → 3 כיוונים → דירוג → הבחירה נשמרת באפיון; אוהד יכול להחליף */
export async function proposeConcepts(ctx: Ctx, projectId: string): Promise<{ concepts: Concept[]; chosen: string; belowBar: boolean }> {
  if (!getProject(ctx.db, projectId)?.brief.intel) await extractIntel(ctx, projectId);
  const r = await chooseConcept(ctx, projectId);
  return { concepts: r.options, chosen: r.chosen.title, belowBar: r.belowBar };
}

/** תסריט לבדיקה בלבד — כל התהליך כולל QA, בלי לשמור גרסה (להשוואה בין שיטות) */
export async function previewScript(ctx: Ctx, projectId: string, visualBy: TextProvider | null): Promise<PipelineResult> {
  return runCreativePipeline(ctx, projectId, { visualBy });
}
