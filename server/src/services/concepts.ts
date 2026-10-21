/**
 * כיווני קריאייטיב: לפני שכותבים תסריט, ChatGPT מציע 3 רעיונות שונים באמת (רעיון, הוק, איך זה נבנה).
 * אוהד בוחר אחד — הוא נשמר באפיון (brief.concept) והתסריט נכתב סביבו.
 * הקופי הוא של ChatGPT בלבד (החלטה של אוהד): Claude לא משתתף כאן.
 */
import { NotFoundError, type Ctx } from '../context.js';
import { getProject } from '../db/repo.js';
import { CONCEPTS_JSON_SCHEMA, conceptsSystemPrompt, briefToText } from '../providers/prompts.js';
import { ProviderError, type ProjectContext, type GenResult, type ScriptDraft, type TextProvider } from '../providers/types.js';
import { playbookFor } from './knowledge.js';
import { lessonsFor } from './learning.js';

export interface Concept {
  title: string;
  idea: string;
  hook: string;
  story: string;
  why: string;
}

/** ההקשר לכתיבה — בלי לדרוש שהאפיון סומן כמוכן (הכיוונים באים לפני) */
export function writingContext(ctx: Ctx, projectId: string): ProjectContext {
  const p = getProject(ctx.db, projectId);
  if (!p) throw new NotFoundError('פרויקט');
  return {
    name: p.name,
    clientName: p.clientName,
    brief: p.brief,
    lessons: lessonsFor(ctx, p.clientName, ['script', 'audio', 'general']),
    playbook: playbookFor(ctx, p.clientName, ['script', 'audio', 'general']),
  };
}

type Jsonable = TextProvider & { json<T>(n: string, s: object, sys: string, user: string, model?: string): Promise<{ data: T; model: string }> };

export async function proposeConcepts(ctx: Ctx, projectId: string): Promise<{ concepts: Concept[]; model: string }> {
  const pc = writingContext(ctx, projectId);
  const gpt = ctx.providers.text.openai as Jsonable | undefined;
  if (!gpt?.isConfigured()) throw new ProviderError('ChatGPT לא מחובר — הוסף מפתח בחלון "מפתחות"', false, 'not_configured');
  const p = getProject(ctx.db, projectId)!;
  const r = await gpt.json<{ concepts: Concept[] }>(
    'concepts',
    CONCEPTS_JSON_SCHEMA,
    conceptsSystemPrompt(pc),
    `BRIEF:\n${briefToText({ ...pc, brief: { ...pc.brief, concept: '' } })}\n\nPropose the 3 directions now.`,
    p.settings.textModel || undefined,
  );
  const concepts = (r.data?.concepts ?? []).filter((c) => c?.idea?.trim()).slice(0, 3);
  if (!concepts.length) throw new ProviderError('ChatGPT לא החזיר כיוונים — נסה שוב', true, 'empty_output');
  return { concepts, model: r.model };
}

/** הכיוון כטקסט אחד שנשמר באפיון */
export const conceptText = (c: Concept) => [`${c.title}: ${c.idea}`, c.hook && `הוק: ${c.hook}`, c.story && `איך זה נבנה: ${c.story}`].filter(Boolean).join('\n');

/** תסריט לבדיקה בלבד — רץ באותו מנוע של הפרויקט ולא נשמר (להשוואה בין שיטות) */
export async function previewScript(ctx: Ctx, projectId: string, provider: TextProvider, model?: string): Promise<GenResult<ScriptDraft>> {
  return provider.generateScript(writingContext(ctx, projectId), { model });
}
