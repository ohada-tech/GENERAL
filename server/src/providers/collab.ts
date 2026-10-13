/**
 * מצב שיתוף: מודל אחד כותב טיוטה, והשני עובר עליה כבמאי/עורך ומחזיר גרסה משופרת + הערות.
 * ברירת המחדל: ChatGPT כותב, Claude מבקר ומשפר. אם אחד מהם לא מחובר — המשימה נחסמת עם הסבר,
 * לא עוברת בשקט למודל אחד.
 */
import { shotFieldsSchema, type ScriptContent, type ShotFields } from '@apos/shared';
import type { JsonResult } from './anthropic.js';
import { validateScript } from './openai.js';
import {
  SCRIPT_REVIEW_JSON_SCHEMA,
  STORYBOARD_REVIEW_JSON_SCHEMA,
  scriptReviewSystemPrompt,
  scriptReviewUserPrompt,
  storyboardReviewSystemPrompt,
  storyboardReviewUserPrompt,
} from './prompts.js';
import { ProviderError, type GenResult, type ProjectContext, type ScriptDraft, type TextProvider } from './types.js';

/** ספק טקסט שתומך בקריאת JSON כללית (OpenAI / Claude). */
export interface JsonCapableProvider extends TextProvider {
  json<T>(name: string, schema: object, system: string, user: string, model?: string): Promise<JsonResult<T>>;
}

const NAMES: Record<string, string> = { openai: 'ChatGPT', claude: 'Claude' };
const nameOf = (p: TextProvider) => NAMES[p.id] ?? p.label;

export class CollabTextProvider implements TextProvider {
  readonly id = 'collab';
  readonly isDemo = false;

  constructor(
    private readonly writer: JsonCapableProvider,
    private readonly reviewer: JsonCapableProvider,
  ) {}

  get label() {
    return `${nameOf(this.writer)} כותב · ${nameOf(this.reviewer)} משפר`;
  }

  isConfigured() {
    return this.writer.isConfigured() && this.reviewer.isConfigured();
  }

  private ensure() {
    const missing = [this.writer, this.reviewer].filter((p) => !p.isConfigured()).map(nameOf);
    if (missing.length) {
      throw new ProviderError(
        `מצב שיתוף דורש את שני המודלים — ${missing.join(' ו-')} לא מחובר. חבר אותו ב"מפתחות" בסרגל העליון, או בחר מודל יחיד בהגדרות הפרויקט.`,
        false,
        'missing_api_key',
      );
    }
  }

  private label2(a: GenResult<unknown>, reviewerModel: string) {
    return `${nameOf(this.writer)} (${a.model}) + ${nameOf(this.reviewer)} (${reviewerModel})`;
  }

  async generateScript(ctx: ProjectContext): Promise<GenResult<ScriptDraft>> {
    this.ensure();
    const draft = await this.writer.generateScript(ctx);
    return this.reviewScript(ctx, draft);
  }

  async reviseScript(ctx: ProjectContext, base: ScriptContent, feedback: string): Promise<GenResult<ScriptDraft>> {
    this.ensure();
    const draft = await this.writer.reviseScript(ctx, base, feedback);
    return this.reviewScript(ctx, draft, feedback, base);
  }

  private async reviewScript(ctx: ProjectContext, draft: GenResult<ScriptDraft>, feedback?: string, base?: ScriptContent): Promise<GenResult<ScriptDraft>> {
    const r = await this.reviewer.json<{ reviewNotes: string[]; script: ScriptDraft }>(
      'script_review',
      SCRIPT_REVIEW_JSON_SCHEMA,
      scriptReviewSystemPrompt(ctx),
      scriptReviewUserPrompt(ctx, draft.data, feedback, base),
    );
    return {
      data: validateScript(r.data?.script),
      provider: 'collab',
      model: this.label2(draft, r.model),
      usage: sumUsage(draft.usage, r.usage),
      reviewNotes: notes(r.data?.reviewNotes),
      reviewer: nameOf(this.reviewer),
    };
  }

  async generateStoryboard(
    ctx: ProjectContext,
    script: ScriptContent,
    defaults: { imageModel: string; animationModel: string },
  ): Promise<GenResult<ShotFields[]>> {
    this.ensure();
    const draft = await this.writer.generateStoryboard(ctx, script, defaults);
    const r = await this.reviewer.json<{ reviewNotes: string[]; shots: unknown[] }>(
      'storyboard_review',
      STORYBOARD_REVIEW_JSON_SCHEMA,
      storyboardReviewSystemPrompt(defaults, ctx.brief.language),
      storyboardReviewUserPrompt(ctx, script, draft.data),
    );
    if (!Array.isArray(r.data?.shots) || r.data.shots.length === 0) {
      throw new ProviderError(`${nameOf(this.reviewer)} החזיר רשימת שוטים ריקה`, true, 'empty_output');
    }
    return {
      data: r.data.shots.map((s) => shotFieldsSchema.parse(s)),
      provider: 'collab',
      model: this.label2(draft, r.model),
      usage: sumUsage(draft.usage, r.usage),
      reviewNotes: notes(r.data.reviewNotes),
      reviewer: nameOf(this.reviewer),
    };
  }
}

const notes = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 8) : []);

function sumUsage(a?: GenResult<unknown>['usage'], b?: GenResult<unknown>['usage']) {
  return {
    inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
  };
}
