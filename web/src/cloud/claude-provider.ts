/**
 * ספק טקסט לגרסת הענן: Claude דרך יכולת sample של claude.ai — רץ על חשבון המשתמש,
 * בלי מפתח API. אותם פרומפטים ואותה ולידציה כמו ספק OpenAI.
 */
import { shotFieldsSchema, type ScriptContent, type ShotFields } from '@apos/shared';
import { validateScript } from '../../../server/src/providers/openai';
import {
  SCRIPT_JSON_SCHEMA,
  STORYBOARD_JSON_SCHEMA,
  reviseUserPrompt,
  scriptSystemPrompt,
  scriptUserPrompt,
  storyboardSystemPrompt,
  storyboardUserPrompt,
} from '../../../server/src/providers/prompts';
import {
  ProviderError,
  type GenResult,
  type ProjectContext,
  type ScriptDraft,
  type TextProvider,
} from '../../../server/src/providers/types';

type Sample = ClaudeCapabilityMap['sample'];

const MODEL_LABEL = 'Claude';

/** קודים שבהם ניסיון חוזר אוטומטי (עם backoff של ה-worker) הגיוני. */
const RETRYABLE = new Set(['rate_limited', 'upstream_error', 'invalid_json', 'empty_completion', 'queue_overflow']);

const MESSAGES: Record<string, string> = {
  not_granted: 'לא אושרה גישה ל-Claude. רענן את הדף ואשר את הבקשה כשתופיע, או בחר "הדגמה" בהגדרות הפרויקט.',
  session_expired: 'פג תוקף ההתחברות ל-claude.ai — התחבר מחדש ורענן.',
  sampling_disabled: 'Claude לא זמין לחשבון או לארגון הזה.',
  rate_limited: 'הגעת למגבלת השימוש של Claude כרגע — ננסה שוב בעוד רגע.',
  refused: 'Claude סירב לבקשה. נסה לנסח את הבריף אחרת.',
  invalid_json: 'התשובה מ-Claude לא הייתה במבנה הנדרש — מנסה שוב.',
  empty_completion: 'Claude החזיר תשובה ריקה.',
  prompt_too_large: 'הבריף/התסריט ארוך מדי לבקשה אחת.',
  upstream_error: 'תקלה זמנית בחיבור ל-Claude.',
};

export class ClaudeTextProvider implements TextProvider {
  readonly id = 'claude';
  readonly label = 'Claude (claude.ai)';
  readonly isDemo = false;

  constructor(private readonly sample: Sample | null) {}

  isConfigured() {
    return this.sample !== null;
  }

  async generateScript(ctx: ProjectContext): Promise<GenResult<ScriptDraft>> {
    const data = await this.complete<ScriptDraft>(scriptSystemPrompt(ctx), scriptUserPrompt(ctx), SCRIPT_JSON_SCHEMA);
    return { data: validateScript(data), provider: this.id, model: MODEL_LABEL };
  }

  async reviseScript(ctx: ProjectContext, base: ScriptContent, feedback: string): Promise<GenResult<ScriptDraft>> {
    const data = await this.complete<ScriptDraft>(
      scriptSystemPrompt(ctx),
      reviseUserPrompt(ctx, base, feedback),
      SCRIPT_JSON_SCHEMA,
    );
    return { data: validateScript(data), provider: this.id, model: MODEL_LABEL };
  }

  async generateStoryboard(
    ctx: ProjectContext,
    script: ScriptContent,
    defaults: { imageModel: string; animationModel: string },
  ): Promise<GenResult<ShotFields[]>> {
    const data = await this.complete<{ shots: unknown[] }>(
      storyboardSystemPrompt(defaults),
      storyboardUserPrompt(ctx, script),
      STORYBOARD_JSON_SCHEMA,
    );
    if (!Array.isArray(data?.shots) || data.shots.length === 0) {
      throw new ProviderError('Claude החזיר סטורי בורד ריק', true, 'empty_output');
    }
    try {
      return { data: data.shots.map((s) => shotFieldsSchema.parse(s)), provider: this.id, model: MODEL_LABEL };
    } catch {
      throw new ProviderError('מבנה השוטים מ-Claude לא תקין', true, 'invalid_json');
    }
  }

  private async complete<T>(system: string, user: string, schema: object): Promise<T> {
    if (!this.sample) {
      throw new ProviderError(
        'Claude לא זמין בתצוגה הזו (פתח את הקישור ב-claude.ai כשאתה מחובר), או בחר "הדגמה" בהגדרות הפרויקט.',
        false,
        'missing_engine',
      );
    }
    const input = [
      system,
      '',
      user,
      '',
      'Output format: reply with ONLY one JSON object (no prose, no Markdown fence) that validates against this JSON Schema. Every property in "required" must be present.',
      JSON.stringify(schema),
    ].join('\n');
    try {
      return await this.sample.json<T>(input, { modelTier: 'default', cache: false });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const code = err.code ?? 'upstream_error';
      throw new ProviderError(MESSAGES[code] ?? `שגיאה מ-Claude (${code}): ${err.message ?? ''}`, RETRYABLE.has(code), code);
    }
  }
}
