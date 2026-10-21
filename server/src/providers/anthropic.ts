/**
 * ספק Claude (Anthropic API) — Messages API עם פלט מובנה (output_config.format: json_schema).
 * המפתח נשמר בשרת בלבד (ANTHROPIC_API_KEY או חיבור מהממשק).
 */
import Anthropic from '@anthropic-ai/sdk';
import { shotFieldsSchema, type ScriptContent, type ShotFields } from '@apos/shared';
import { validateScript } from './openai.js';
import {
  SCRIPT_JSON_SCHEMA,
  STORYBOARD_JSON_SCHEMA,
  reviseUserPrompt,
  scriptSystemPrompt,
  scriptUserPrompt,
  storyboardSystemPrompt,
  storyboardUserPrompt,
} from './prompts.js';
import { writeScriptTwoStep, type TextResult } from './writer.js';
import { ProviderError, type GenResult, type ProjectContext, type ScriptDraft, type TextProvider } from './types.js';

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export type JsonResult<T> = { data: T; model: string; usage?: GenResult<T>['usage'] };

export class AnthropicTextProvider implements TextProvider {
  readonly id = 'claude';
  readonly label = 'Claude (Anthropic API)';
  readonly isDemo = false;

  constructor(private readonly cfg: AnthropicConfig) {}

  isConfigured() {
    return Boolean(this.cfg.apiKey);
  }

  private client(apiKey = this.cfg.apiKey) {
    return new Anthropic({ apiKey, timeout: this.cfg.timeoutMs, maxRetries: 1 });
  }

  /** בדיקת חיבור: שליפת פרטי המודל — לא צורך טוקנים. */
  async verify(apiKey = this.cfg.apiKey, model = this.cfg.model): Promise<{ ok: true; model: string } | { ok: false; code: string; message: string }> {
    if (!apiKey) return { ok: false, code: 'missing_api_key', message: 'לא הוזן מפתח' };
    try {
      await this.client(apiKey).models.retrieve(model);
      return { ok: true, model };
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return { ok: false, code: 'auth', message: 'המפתח לא תקף (ייתכן שבוטל או הועתק חלקית)' };
      if (e instanceof Anthropic.PermissionDeniedError) return { ok: false, code: 'forbidden', message: `למפתח אין הרשאה: ${e.message}` };
      if (e instanceof Anthropic.NotFoundError) return { ok: false, code: 'model_not_found', message: `המפתח תקף, אבל המודל "${model}" לא זמין לחשבון` };
      if (e instanceof Anthropic.RateLimitError) return { ok: false, code: 'rate_limit', message: 'Anthropic הגביל בקשות — נסה שוב בעוד רגע' };
      if (e instanceof Anthropic.APIConnectionError) return { ok: false, code: 'network', message: `אין חיבור ל-Anthropic: ${e.message}` };
      return { ok: false, code: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }

  /** טיוטה ראשונה: כתיבה חופשית ואז חלוקה לסצנות (ראו writer.ts) */
  async generateScript(ctx: ProjectContext, opts?: { model?: string }): Promise<GenResult<ScriptDraft>> {
    return writeScriptTwoStep(this, ctx, opts?.model);
  }

  /** טקסט חופשי, בלי סכמה */
  async text(system: string, user: string, modelOverride?: string): Promise<TextResult> {
    const r = await this.call(system, user, modelOverride, null);
    return { text: r.text, model: r.model, usage: r.usage };
  }

  async reviseScript(ctx: ProjectContext, base: ScriptContent, feedback: string, opts?: { model?: string }) {
    const r = await this.json<ScriptDraft>(
      'script',
      SCRIPT_JSON_SCHEMA,
      scriptSystemPrompt(ctx),
      reviseUserPrompt(ctx, base, feedback),
      opts?.model,
    );
    return { data: validateScript(r.data), provider: this.id, model: r.model, usage: r.usage };
  }

  async generateStoryboard(
    ctx: ProjectContext,
    script: ScriptContent,
    defaults: { imageModel: string; animationModel: string },
    opts?: { model?: string },
  ): Promise<GenResult<ShotFields[]>> {
    const r = await this.json<{ shots: unknown[] }>(
      'storyboard',
      STORYBOARD_JSON_SCHEMA,
      storyboardSystemPrompt(defaults),
      storyboardUserPrompt(ctx, script),
      opts?.model,
    );
    if (!Array.isArray(r.data?.shots) || r.data.shots.length === 0) {
      throw new ProviderError('Claude החזיר סטורי בורד ריק', true, 'empty_output');
    }
    return { data: r.data.shots.map((s) => shotFieldsSchema.parse(s)), provider: this.id, model: r.model, usage: r.usage };
  }

  /** קריאה כללית עם JSON Schema. */
  async json<T>(_name: string, schema: object, system: string, user: string, modelOverride?: string): Promise<JsonResult<T>> {
    const r = await this.call(system, user, modelOverride, schema);
    let data: T;
    try {
      data = JSON.parse(r.text) as T;
    } catch {
      throw new ProviderError('הפלט מ-Claude אינו JSON תקין', true, 'invalid_json');
    }
    return { data, model: r.model, usage: r.usage };
  }

  private async call(system: string, user: string, modelOverride: string | undefined, schema: object | null) {
    if (!this.cfg.apiKey) {
      throw new ProviderError('Claude לא מחובר. לחץ על "מפתחות" בסרגל העליון והדבק מפתח Anthropic API.', false, 'missing_api_key');
    }
    const model = modelOverride || this.cfg.model;
    let msg: Anthropic.Beta.BetaMessage;
    try {
      const stream = this.client().beta.messages.stream({
        model,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: user }],
        output_config: schema ? { effort: 'high', format: { type: 'json_schema', schema: schema as Record<string, unknown> } } : { effort: 'high' },
      });
      msg = await stream.finalMessage();
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
        throw new ProviderError(`Anthropic דחה את המפתח: ${e.message}`, false, 'auth');
      if (e instanceof Anthropic.NotFoundError) throw new ProviderError(`המודל "${model}" לא זמין לחשבון`, false, 'model_not_found');
      if (e instanceof Anthropic.BadRequestError) throw new ProviderError(`בקשה נדחתה ע"י Anthropic: ${e.message}`, false, 'bad_request');
      if (e instanceof Anthropic.RateLimitError) throw new ProviderError(`הגבלת קצב Anthropic: ${e.message}`, true, 'rate_limit');
      if (e instanceof Anthropic.InternalServerError) throw new ProviderError(`שגיאת שרת Anthropic: ${e.message}`, true, 'server');
      if (e instanceof Anthropic.APIConnectionError) throw new ProviderError(`שגיאת רשת מול Anthropic: ${e.message}`, true, 'network');
      if (e instanceof Anthropic.APIError) throw new ProviderError(`Anthropic החזיר שגיאה ${e.status}: ${e.message}`, (e.status ?? 500) >= 500, 'error');
      throw new ProviderError(`שגיאה מול Anthropic: ${e instanceof Error ? e.message : String(e)}`, true, 'network');
    }
    if (msg.stop_reason === 'refusal') throw new ProviderError('Claude סירב לבקשה. נסה לנסח את הבריף אחרת.', false, 'refusal');
    if (msg.stop_reason === 'max_tokens') throw new ProviderError('התשובה מ-Claude נקטעה (חריגה מאורך פלט)', true, 'truncated');
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (!text) throw new ProviderError('תשובה ריקה מ-Claude', true, 'empty_output');
    return { text, model: msg.model || model, usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens } };
  }
}
