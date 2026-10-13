/**
 * ספק OpenAI (ChatGPT API) — Chat Completions עם Structured Outputs (json_schema strict).
 * שים לב: מנוי ChatGPT אינו כולל גישה ל-API. נדרש OPENAI_API_KEY עם קרדיט פעיל.
 */
import { shotFieldsSchema, type ScriptContent, type ShotFields } from '@apos/shared';
import {
  SCRIPT_JSON_SCHEMA,
  STORYBOARD_JSON_SCHEMA,
  reviseUserPrompt,
  scriptSystemPrompt,
  scriptUserPrompt,
  storyboardSystemPrompt,
  storyboardUserPrompt,
} from './prompts.js';
import { ProviderError, type GenResult, type ProjectContext, type ScriptDraft, type TextProvider } from './types.js';

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

type FetchFn = typeof fetch;

export class OpenAITextProvider implements TextProvider {
  readonly id = 'openai';
  readonly label = 'OpenAI (ChatGPT API)';
  readonly isDemo = false;

  constructor(
    private readonly cfg: OpenAIConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  isConfigured() {
    return Boolean(this.cfg.apiKey);
  }

  /**
   * בדיקת חיבור אמיתית מול OpenAI: האם המפתח תקף והאם המודל זמין לחשבון.
   * GET /models/{model} — לא צורך טוקנים ולא עולה כסף.
   */
  async verify(apiKey = this.cfg.apiKey, model = this.cfg.model): Promise<{ ok: true; model: string } | { ok: false; code: string; message: string }> {
    if (!apiKey) return { ok: false, code: 'missing_api_key', message: 'לא הוזן מפתח' };
    let res: Response;
    try {
      res = await this.fetchFn(`${this.cfg.baseUrl}/models/${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      return { ok: false, code: 'network', message: `אין חיבור ל-OpenAI: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (res.ok) return { ok: true, model };
    let msg = '';
    try {
      msg = ((await res.json()) as any)?.error?.message ?? '';
    } catch {
      /* ignore */
    }
    if (res.status === 401) return { ok: false, code: 'auth', message: 'המפתח לא תקף (ייתכן שבוטל או הועתק חלקית)' };
    if (res.status === 403) return { ok: false, code: 'forbidden', message: `למפתח אין הרשאה: ${msg}` };
    if (res.status === 404) return { ok: false, code: 'model_not_found', message: `המפתח תקף, אבל המודל "${model}" לא זמין לחשבון` };
    if (res.status === 429) return { ok: false, code: 'rate_limit', message: `OpenAI הגביל בקשות: ${msg}` };
    return { ok: false, code: 'error', message: `OpenAI החזיר ${res.status}: ${msg}` };
  }

  async generateScript(ctx: ProjectContext, opts?: { model?: string }): Promise<GenResult<ScriptDraft>> {
    const { data, model, usage } = await this.complete<ScriptDraft>(
      'script',
      SCRIPT_JSON_SCHEMA,
      [
        { role: 'system', content: scriptSystemPrompt(ctx) },
        { role: 'user', content: scriptUserPrompt(ctx) },
      ],
      opts?.model,
    );
    return { data: validateScript(data), provider: this.id, model, usage };
  }

  async reviseScript(ctx: ProjectContext, base: ScriptContent, feedback: string, opts?: { model?: string }) {
    const { data, model, usage } = await this.complete<ScriptDraft>(
      'script',
      SCRIPT_JSON_SCHEMA,
      [
        { role: 'system', content: scriptSystemPrompt(ctx) },
        { role: 'user', content: reviseUserPrompt(ctx, base, feedback) },
      ],
      opts?.model,
    );
    return { data: validateScript(data), provider: this.id, model, usage };
  }

  async generateStoryboard(
    ctx: ProjectContext,
    script: ScriptContent,
    defaults: { imageModel: string; animationModel: string },
    opts?: { model?: string },
  ): Promise<GenResult<ShotFields[]>> {
    const { data, model, usage } = await this.complete<{ shots: unknown[] }>(
      'storyboard',
      STORYBOARD_JSON_SCHEMA,
      [
        { role: 'system', content: storyboardSystemPrompt(defaults) },
        { role: 'user', content: storyboardUserPrompt(ctx, script) },
      ],
      opts?.model,
    );
    if (!Array.isArray(data?.shots) || data.shots.length === 0) {
      throw new ProviderError('המודל החזיר סטורי בורד ריק', true, 'empty_output');
    }
    return { data: data.shots.map((s) => shotFieldsSchema.parse(s)), provider: this.id, model, usage };
  }

  private async complete<T>(
    name: string,
    schema: object,
    messages: Array<{ role: string; content: string }>,
    modelOverride?: string,
  ): Promise<{ data: T; model: string; usage?: GenResult<T>['usage'] }> {
    if (!this.cfg.apiKey) {
      throw new ProviderError(
        'OpenAI לא מחובר. לחץ על "חבר OpenAI" בסרגל העליון והדבק מפתח API, או בחר ספק "demo" בהגדרות הפרויקט.',
        false,
        'missing_api_key',
      );
    }
    const model = modelOverride || this.cfg.model;
    let res: Response;
    try {
      res = await this.fetchFn(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ProviderError(`שגיאת רשת מול OpenAI: ${msg}`, true, 'network');
    }

    const text = await res.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON body */
    }

    if (!res.ok) {
      const apiMsg: string = body?.error?.message || text.slice(0, 300);
      const apiCode: string = body?.error?.code || body?.error?.type || '';
      if (res.status === 401 || res.status === 403)
        throw new ProviderError(`OpenAI דחה את המפתח (${res.status}): ${apiMsg}`, false, 'auth');
      if (res.status === 429 && apiCode === 'insufficient_quota')
        throw new ProviderError(`אין קרדיט/מכסה בחשבון ה-API: ${apiMsg}`, false, 'insufficient_quota');
      if (res.status === 429) throw new ProviderError(`הגבלת קצב OpenAI: ${apiMsg}`, true, 'rate_limit');
      if (res.status >= 500) throw new ProviderError(`שגיאת שרת OpenAI (${res.status}): ${apiMsg}`, true, 'server');
      if (res.status === 404 || apiCode === 'model_not_found')
        throw new ProviderError(`המודל "${model}" לא זמין לחשבון: ${apiMsg}`, false, 'model_not_found');
      throw new ProviderError(`בקשה נדחתה ע"י OpenAI (${res.status}): ${apiMsg}`, false, 'bad_request');
    }

    const choice = body?.choices?.[0];
    if (choice?.message?.refusal) {
      throw new ProviderError(`המודל סירב: ${choice.message.refusal}`, false, 'refusal');
    }
    if (choice?.finish_reason === 'length') {
      throw new ProviderError('התשובה נקטעה (חריגה מאורך פלט מקסימלי)', true, 'truncated');
    }
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content) {
      throw new ProviderError('תשובה ריקה מ-OpenAI', true, 'empty_output');
    }
    let data: T;
    try {
      data = JSON.parse(content) as T;
    } catch {
      throw new ProviderError('הפלט מהמודל אינו JSON תקין', true, 'invalid_json');
    }
    return {
      data,
      model: body?.model || model,
      usage: { inputTokens: body?.usage?.prompt_tokens, outputTokens: body?.usage?.completion_tokens },
    };
  }
}

export function validateScript(d: ScriptDraft): ScriptDraft {
  if (!d || !Array.isArray(d.scenes) || d.scenes.length === 0) {
    throw new ProviderError('המודל החזיר תסריט ללא סצנות', true, 'empty_output');
  }
  return {
    title: String(d.title ?? ''),
    logline: String(d.logline ?? ''),
    scenes: d.scenes.map((s) => ({
      storyRole: String(s.storyRole ?? 'other'),
      narration: String(s.narration ?? ''),
      onScreenText: String(s.onScreenText ?? ''),
      visualAction: String(s.visualAction ?? ''),
      estDurationSec: Number(s.estDurationSec) || 0,
      notes: String(s.notes ?? ''),
    })),
  };
}
