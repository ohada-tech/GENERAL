/**
 * התהליך הקריאייטיבי המחייב (ChatGPT בלבד בקופי ובשיפוט — החלטה של אוהד; Claude רק בוויזואל):
 *   A. הבנת המוצר — עובדות / הנחות / שאלות פתוחות, כולל אתר הלקוח.
 *   B. 3 כיוונים שונים מהותית.
 *   C. בחירה לפי קריטריונים מפורשים; אם אף כיוון לא עומד ברף — כיוונים חדשים.
 *   D. כתיבה (טקסט חופשי ← סצנות מילה במילה) + תזמון מציאותי.
 *   QA — שופט עצמאי מתוך 100 + בדיקות קוד. כשל חוזר לשלב שממנו הוא נובע (לא רק החלפת מילים),
 *        עד 2 סבבי תיקון; אחר כך עוצרים ומבקשים החלטה של אוהד ("⏳ מחכה לך").
 */
import {
  CONCEPT_MIN_AVG,
  QA_PASS_EACH,
  QA_PASS_TOTAL,
  QA_RUBRIC,
  conceptAvg,
  conceptSchema,
  conceptText,
  productIntelSchema,
  qaReportSchema,
  type Concept,
  type ProductIntel,
  type QaCriterion,
  type QaReport,
} from '@apos/shared';
import { NotFoundError, type Ctx } from '../context.js';
import { getProject } from '../db/repo.js';
import { improveScript, type JsonCapableProvider } from '../providers/collab.js';
import {
  CONCEPTS_JSON_SCHEMA,
  INTEL_JSON_SCHEMA,
  QA_JSON_SCHEMA,
  SELECT_JSON_SCHEMA,
  conceptsSystemPrompt,
  conceptsUserPrompt,
  intelSystemPrompt,
  intelUserPrompt,
  qaSystemPrompt,
  qaUserPrompt,
  selectSystemPrompt,
  selectUserPrompt,
} from '../providers/prompts.js';
import { ProviderError, type GenResult, type ProjectContext, type ScriptDraft, type TextProvider } from '../providers/types.js';
import { writeScriptTwoStep, type TwoStepWriter } from '../providers/writer.js';
import { updateBrief } from '../workflow/commands.js';
import { siteText } from './auto-brief.js';
import { normalizeTiming, scriptChecks } from './creative-checks.js';
import { playbookFor } from './knowledge.js';
import { lessonsFor } from './learning.js';

/** סבבי תיקון אוטומטיים אחרי הניסיון הראשון */
export const MAX_FIX_ROUNDS = 2;

type Gpt = TwoStepWriter & JsonCapableProvider;

/** ההקשר לכתיבה — בלי לדרוש שהאפיון סומן כמוכן (הכיוונים באים לפני) */
export function writingContext(ctx: Ctx, projectId: string, extra: Partial<ProjectContext> = {}): ProjectContext {
  const p = getProject(ctx.db, projectId);
  if (!p) throw new NotFoundError('פרויקט');
  return {
    name: p.name,
    clientName: p.clientName,
    brief: p.brief,
    lessons: lessonsFor(ctx, p.clientName, ['script', 'audio', 'general']),
    playbook: playbookFor(ctx, p.clientName, ['script', 'audio', 'general']),
    ...extra,
  };
}

function gptFor(ctx: Ctx): Gpt {
  const g = ctx.providers.text.openai as unknown as Gpt | undefined;
  if (!g?.isConfigured() || !g.text || !g.json) throw new ProviderError('ChatGPT לא מחובר — הוסף מפתח בחלון "מפתחות"', false, 'not_configured');
  return g;
}
const modelOf = (ctx: Ctx, projectId: string) => getProject(ctx.db, projectId)?.settings.textModel || undefined;

/* ---------- A. הבנת המוצר ---------- */

export async function extractIntel(ctx: Ctx, projectId: string, fetcher?: typeof fetch): Promise<ProductIntel> {
  const g = gptFor(ctx);
  const pc = writingContext(ctx, projectId);
  const site = pc.brief.website ? await siteText(pc.brief.website, fetcher) : '';
  const r = await g.json<ProductIntel>('product_intel', INTEL_JSON_SCHEMA, intelSystemPrompt(pc), intelUserPrompt(pc, site), modelOf(ctx, projectId));
  const intel = productIntelSchema.parse(r.data ?? {});
  updateBrief(ctx, projectId, { intel }, { by: 'ChatGPT', note: `הבנת המוצר: ${intel.facts.length} עובדות, ${intel.assumptions.length} הנחות, ${intel.openQuestions.length} שאלות פתוחות` });
  return intel;
}

/* ---------- B + C. כיוונים ובחירה ---------- */

async function proposeAndScore(ctx: Ctx, projectId: string, avoid: string[]): Promise<Concept[]> {
  const g = gptFor(ctx);
  const pc = writingContext(ctx, projectId);
  const model = modelOf(ctx, projectId);
  const r = await g.json<{ concepts: Concept[] }>('concepts', CONCEPTS_JSON_SCHEMA, conceptsSystemPrompt(pc), conceptsUserPrompt(pc, avoid), model);
  const concepts = (r.data?.concepts ?? []).filter((c) => c?.idea?.trim()).slice(0, 3).map((c) => conceptSchema.parse(c));
  if (!concepts.length) throw new ProviderError('ChatGPT לא החזיר כיוונים — נסה שוב', true, 'empty_output');
  // השיפוט בקריאה נפרדת: מי שהציע לא מדרג את עצמו באותה נשימה
  const s = await g.json<{ evaluations: Array<{ index: number; scores: Record<string, number>; verdict: string }> }>(
    'concept_selection',
    SELECT_JSON_SCHEMA,
    selectSystemPrompt(pc),
    selectUserPrompt(pc, concepts),
    model,
  );
  for (const e of s.data?.evaluations ?? []) {
    const c = concepts[e.index];
    if (c) Object.assign(c, { scores: e.scores ?? {}, verdict: e.verdict ?? '' });
  }
  return concepts;
}

/**
 * מציע 3 כיוונים, מדרג, בוחר את החזק. אם הטוב ביותר מתחת לרף — סבב כיוונים חדש (פעם אחת), ובוחרים מכל מה שנבדק.
 * הבחירה נשמרת באפיון; אוהד יכול להחליף אותה במסך האפיון.
 */
export async function chooseConcept(ctx: Ctx, projectId: string, avoid: string[] = []): Promise<{ chosen: Concept; options: Concept[]; belowBar: boolean }> {
  let options = await proposeAndScore(ctx, projectId, avoid);
  let best = bestOf(options);
  if (!best || conceptAvg(best) < CONCEPT_MIN_AVG) {
    const more = await proposeAndScore(ctx, projectId, [...avoid, ...options.map((c) => `${c.title}: ${c.idea}`)]);
    const all = [...options, ...more];
    best = bestOf(all);
    options = best && more.includes(best) ? more : options;
  }
  if (!best) throw new ProviderError('לא נמצא כיוון', true, 'empty_output');
  const belowBar = conceptAvg(best) < CONCEPT_MIN_AVG;
  updateBrief(
    ctx,
    projectId,
    { concept: conceptText(best), conceptOptions: options },
    { by: 'ChatGPT', note: `נבחר כיוון: ${best.title} (${conceptAvg(best).toFixed(1)}/10)${belowBar ? ' — מתחת לרף' : ''}` },
  );
  return { chosen: best, options, belowBar };
}
const bestOf = (cs: Concept[]) => cs.filter((c) => !c.rejected).sort((a, b) => conceptAvg(b) - conceptAvg(a))[0];

/* ---------- QA ---------- */

export async function judgeScript(ctx: Ctx, projectId: string, draft: ScriptDraft): Promise<QaReport> {
  const g = gptFor(ctx);
  const pc = writingContext(ctx, projectId);
  const checks = scriptChecks(draft, pc.brief);
  const others = (pc.brief.conceptOptions ?? []).filter((c) => conceptText(c) !== pc.brief.concept);
  const r = await g.json<{
    scores: Record<string, { score: number; evidence: string }>;
    detectors: Record<string, { found: boolean; evidence: string }>;
    critical: string[];
    unsupportedClaims: string[];
    failStage: string;
    fixes: string[];
  }>('script_qa', QA_JSON_SCHEMA, qaSystemPrompt(pc), qaUserPrompt(pc, draft, [...checks.critical, ...checks.issues], others), modelOf(ctx, projectId));
  return gate(r.data ?? ({} as never), checks, `ChatGPT (${r.model})`);
}

/** שער המעבר מחושב בקוד, לא לפי מה שהשופט "מרגיש": 85+, 70% בכל קריטריון, בלי כשל קריטי ובלי טענות לא מבוססות */
export function gate(
  d: { scores?: Record<string, { score: number; evidence: string }>; detectors?: Record<string, { found: boolean; evidence: string }>; critical?: string[]; unsupportedClaims?: string[]; failStage?: string; fixes?: string[] },
  checks: { critical: string[]; issues: string[] },
  judge: string,
): QaReport {
  const scores: QaReport['scores'] = {};
  let total = 0;
  let eachOk = true;
  for (const k of Object.keys(QA_RUBRIC) as QaCriterion[]) {
    const max = QA_RUBRIC[k].max;
    const sc = Math.max(0, Math.min(max, Math.round(Number(d.scores?.[k]?.score) || 0)));
    // ציון בלי ראיה מתוך התסריט לא נחשב
    const evidence = String(d.scores?.[k]?.evidence ?? '').trim();
    const counted = evidence ? sc : 0;
    scores[k] = { score: counted, evidence };
    total += counted;
    if (counted < max * QA_PASS_EACH) eachOk = false;
  }
  const critical = [...(d.critical ?? []).map(String).filter(Boolean), ...checks.critical];
  const unsupported = (d.unsupportedClaims ?? []).map(String).filter(Boolean);
  const passed = total >= QA_PASS_TOTAL && eachOk && critical.length === 0 && unsupported.length === 0;
  let failStage = passed ? 'none' : String(d.failStage ?? 'writing');
  if (!passed && failStage === 'none') failStage = 'writing';
  if (unsupported.length && failStage === 'writing') failStage = 'product';
  return qaReportSchema.parse({
    total,
    passed,
    scores,
    detectors: d.detectors ?? {},
    critical,
    unsupportedClaims: unsupported,
    codeChecks: [...checks.critical, ...checks.issues],
    failStage,
    fixes: (d.fixes ?? []).map(String).filter(Boolean).slice(0, 5),
    judge,
  });
}

/** סיכום קצר לכותב בניסיון הבא: שורש הכשל, לא רשימת מילים להחליף */
export function failureNotes(qa: QaReport): string {
  const low = (Object.keys(QA_RUBRIC) as QaCriterion[])
    .filter((k) => (qa.scores[k]?.score ?? 0) < QA_RUBRIC[k].max * QA_PASS_EACH)
    .map((k) => `${QA_RUBRIC[k].label}: ${qa.scores[k]?.score ?? 0}/${QA_RUBRIC[k].max} — ${qa.scores[k]?.evidence ?? ''}`);
  const found = Object.entries(qa.detectors)
    .filter(([, v]) => v.found)
    .map(([k, v]) => `${k}: ${v.evidence}`);
  return [
    `QA ${qa.total}/100 (pass = ${QA_PASS_TOTAL}).`,
    low.length ? `Weak criteria:\n${low.map((x) => `- ${x}`).join('\n')}` : '',
    found.length ? `Problems found:\n${found.map((x) => `- ${x}`).join('\n')}` : '',
    qa.critical.length ? `Critical:\n${qa.critical.map((x) => `- ${x}`).join('\n')}` : '',
    qa.unsupportedClaims.length ? `Unsupported claims (remove):\n${qa.unsupportedClaims.map((x) => `- ${x}`).join('\n')}` : '',
    qa.codeChecks.length ? `Measured:\n${qa.codeChecks.map((x) => `- ${x}`).join('\n')}` : '',
    qa.fixes.length ? `Fix the root cause:\n${qa.fixes.map((x) => `- ${x}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/* ---------- הלולאה המלאה ---------- */

export interface PipelineResult {
  draft: GenResult<ScriptDraft>;
  qa: QaReport;
  steps: string[];
}

export async function runCreativePipeline(
  ctx: Ctx,
  projectId: string,
  opts: { rewriteNotes?: string; visualBy?: TextProvider | null; fetcher?: typeof fetch } = {},
): Promise<PipelineResult> {
  const g = gptFor(ctx);
  const steps: string[] = [];
  const p0 = getProject(ctx.db, projectId);
  if (!p0) throw new NotFoundError('פרויקט');

  if (!p0.brief.intel) {
    await extractIntel(ctx, projectId, opts.fetcher);
    steps.push('הבנת המוצר');
  }
  if (!p0.brief.concept.trim()) {
    const c = await chooseConcept(ctx, projectId);
    steps.push(`כיוון: ${c.chosen.title}`);
  }

  let notes = opts.rewriteNotes?.trim() ?? '';
  let best: { draft: GenResult<ScriptDraft>; qa: QaReport } | null = null;
  let round = 0;
  for (; round <= MAX_FIX_ROUNDS; round++) {
    const pc = writingContext(ctx, projectId, { rewriteNotes: notes });
    const written = await writeScriptTwoStep(g, pc, modelOf(ctx, projectId));
    written.data = normalizeTiming(written.data, pc.brief);
    const qa = await judgeScript(ctx, projectId, written.data);
    steps.push(`סבב ${round + 1}: QA ${qa.total}/100${qa.passed ? ' ✓' : ` ✗ (${qa.failStage})`}`);
    if (!best || qa.total > best.qa.total || (qa.passed && !best.qa.passed)) best = { draft: written, qa };
    if (qa.passed || round === MAX_FIX_ROUNDS) break;

    // חוזרים לשלב שממנו הכשל נובע — לא רק מחליפים מילים
    if (qa.failStage === 'product') {
      await extractIntel(ctx, projectId, opts.fetcher);
      steps.push('חזרה להבנת המוצר');
    } else if (qa.failStage === 'concept' || qa.failStage === 'selection') {
      const b = getProject(ctx.db, projectId)!.brief;
      const options = b.conceptOptions.map((c) => (conceptText(c) === b.concept ? { ...c, rejected: true } : c));
      const next = qa.failStage === 'selection' ? bestOf(options) : undefined;
      if (next) {
        updateBrief(ctx, projectId, { concept: conceptText(next), conceptOptions: options }, { by: 'ChatGPT', note: `QA: עוברים לכיוון ${next.title}` });
        steps.push(`כיוון אחר: ${next.title}`);
      } else {
        const rejected = options.filter((c) => c.rejected).map((c) => `${c.title}: ${c.idea}`);
        const c = await chooseConcept(ctx, projectId, rejected);
        steps.push(`כיוונים חדשים → ${c.chosen.title}`);
      }
    }
    notes = [opts.rewriteNotes?.trim() ? `Owner's note: ${opts.rewriteNotes.trim()}` : '', failureNotes(qa)].filter(Boolean).join('\n\n');
  }

  const qa: QaReport = { ...best!.qa, rounds: Math.min(round, MAX_FIX_ROUNDS) + 1, needsOwner: !best!.qa.passed };
  let draft = best!.draft;

  // Claude: רק "מה רואים" (הקופי ננעל בקוד) — ורק על התסריט הסופי
  if (opts.visualBy?.isConfigured()) {
    try {
      const v = await improveScript(opts.visualBy as unknown as JsonCapableProvider, writingContext(ctx, projectId), draft.data as never);
      draft = { ...v, provider: 'collab', model: `ChatGPT (${draft.model}) + Claude ויזואל (${v.model})`, usage: sum(draft.usage, v.usage) };
      steps.push('Claude: ויזואל');
    } catch (e) {
      steps.push(`Claude ויזואל נכשל: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  draft.data = { ...draft.data, qa };
  return { draft, qa, steps };
}

const sum = (a?: GenResult<unknown>['usage'], b?: GenResult<unknown>['usage']) => ({
  inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
  outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
});
