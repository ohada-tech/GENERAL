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
import { writeScriptTwoStep, type TextResult } from './writer.js';
import { bridge } from '../services/bridge.js';
import { ProviderError, type GenResult, type ProjectContext, type ScriptDraft, type TextProvider } from './types.js';

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

type FetchFn = typeof fetch;

/** כשלי API שבהם עוברים למנוי (אם הגשר מחובר) */
const BRIDGE_FALLBACK = new Set(['missing_api_key', 'auth', 'insufficient_quota', 'rate_limit', 'server', 'network']);

export class OpenAITextProvider implements TextProvider {
  readonly id = 'openai';
  readonly label = 'ChatGPT (OpenAI API)';
  readonly isDemo = false;

  constructor(
    private readonly cfg: OpenAIConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  /** מחובר: יש מפתח API, או שהגשר למנוי ChatGPT (Codex) פעיל במחשב של אוהד */
  isConfigured() {
    return Boolean(this.cfg.apiKey) || bridge.usable(true);
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

  /** רשימת המודלים שזמינים לחשבון (GET /models — לא עולה כסף) */
  async listModels(): Promise<string[]> {
    if (!this.cfg.apiKey) throw new ProviderError('OpenAI לא מחובר', false, 'missing_api_key');
    const res = await this.fetchFn(`${this.cfg.baseUrl}/models`, { headers: { Authorization: `Bearer ${this.cfg.apiKey}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new ProviderError(`OpenAI החזיר ${res.status}`, true, 'error');
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id).sort();
  }

  /** טיוטה ראשונה: כתיבה חופשית ואז חלוקה לסצנות (ראו writer.ts) */
  async generateScript(ctx: ProjectContext, opts?: { model?: string }): Promise<GenResult<ScriptDraft>> {
    return writeScriptTwoStep(this, ctx, opts?.model);
  }

  /** טקסט חופשי, בלי סכמה — כמו תשובה בצ'אט */
  async text(system: string, user: string, modelOverride?: string): Promise<TextResult> {
    const r = await this.complete<string>(
      'text',
      null,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      modelOverride,
    );
    return { text: r.data, model: r.model, usage: r.usage };
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

  /** קריאה כללית עם JSON Schema — משמשת גם את מצב השיתוף (ChatGPT + Claude). */
  async json<T>(name: string, schema: object, system: string, user: string, modelOverride?: string) {
    return this.complete<T>(
      name,
      schema,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      modelOverride,
    );
  }

  /**
   * API קודם; אם הוא נכשל (אין קרדיט / אין מפתח / תקלה) והגשר מחובר — אותה בקשה דרך המנוי של ChatGPT (Codex).
   * במצב "always" — רק המנוי.
   */
  private async complete<T>(
    name: string,
    schema: object | null,
    messages: Array<{ role: string; content: string }>,
    modelOverride?: string,
  ): Promise<{ data: T; model: string; usage?: GenResult<T>['usage'] }> {
    if (bridge.usable(false) || (!this.cfg.apiKey && bridge.usable(true))) return this.viaBridge<T>(name, schema, messages);
    try {
      return await this.completeApi<T>(name, schema, messages, modelOverride);
    } catch (e) {
      if (e instanceof ProviderError && BRIDGE_FALLBACK.has(e.code) && bridge.usable(true)) return this.viaBridge<T>(name, schema, messages);
      throw e;
    }
  }

  private async viaBridge<T>(name: string, schema: object | null, messages: Array<{ role: string; content: string }>) {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const user = messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n\n');
    const text = (await bridge.call(name, system, user, schema)).trim();
    if (!text) throw new ProviderError('תשובה ריקה מהמנוי של ChatGPT', true, 'empty_output');
    let data: T;
    if (!schema) data = text as T;
    else
      try {
        data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as T;
      } catch {
        throw new ProviderError('הפלט מהמנוי של ChatGPT אינו JSON תקין', true, 'invalid_json');
      }
    return { data, model: 'ChatGPT מנוי (Codex)', usage: undefined };
  }

  private async completeApi<T>(
    name: string,
    schema: object | null,
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
          ...(schema ? { response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } } } : {}),
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
    if (!schema) data = content as T;
    else try {
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
