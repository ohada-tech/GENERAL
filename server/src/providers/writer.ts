/**
 * כתיבת תסריט בשני שלבים — כמו שעובדים עם ChatGPT בצ'אט:
 * 1. הכותב כותב טקסט חופשי, אנושי, לפי כללי הקופי (בלי JSON שמכתיב מבנה).
 * 2. קריאה שנייה רק מחלקת את הטקסט לסצנות — מילה במילה, בלי לשכתב.
 */
import type { JsonResult } from './anthropic.js';
import { validateScript } from './openai.js';
import { SCRIPT_JSON_SCHEMA, creativeSystemPrompt, creativeUserPrompt, structureSystemPrompt, structureUserPrompt } from './prompts.js';
import { ProviderError, type GenResult, type ProjectContext, type ScriptDraft } from './types.js';

export interface TextResult {
  text: string;
  model: string;
  usage?: GenResult<unknown>['usage'];
}

export interface TwoStepWriter {
  readonly id: string;
  text(system: string, user: string, model?: string): Promise<TextResult>;
  json<T>(name: string, schema: object, system: string, user: string, model?: string): Promise<JsonResult<T>>;
}

export async function writeScriptTwoStep(p: TwoStepWriter, ctx: ProjectContext, model?: string): Promise<GenResult<ScriptDraft>> {
  const draft = await p.text(creativeSystemPrompt(ctx), creativeUserPrompt(ctx), model);
  if (!draft.text.trim()) throw new ProviderError('הכותב החזיר טקסט ריק', true, 'empty_output');
  const s = await p.json<ScriptDraft>('script', SCRIPT_JSON_SCHEMA, structureSystemPrompt(), structureUserPrompt(draft.text), model);
  return {
    data: validateScript(s.data),
    provider: p.id,
    model: draft.model,
    usage: {
      inputTokens: (draft.usage?.inputTokens ?? 0) + (s.usage?.inputTokens ?? 0),
      outputTokens: (draft.usage?.outputTokens ?? 0) + (s.usage?.outputTokens ?? 0),
    },
  };
}
