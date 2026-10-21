import { describe, expect, it } from 'vitest';
import { emptyBrief } from '@apos/shared';
import { OpenAITextProvider } from '../src/providers/openai.js';
import { ProviderError } from '../src/providers/types.js';

const cfg = { apiKey: 'sk-test', model: 'gpt-test', baseUrl: 'https://api.example/v1', timeoutMs: 1000 };
const ctx = { name: 'P', clientName: 'C', brief: { ...emptyBrief(), language: 'עברית', durationSec: 20 } };

const respond = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const okScript = {
  model: 'gpt-test-2026',
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          title: 'כותרת',
          logline: 'שורה',
          scenes: [
            { storyRole: 'hook', narration: 'שלום', onScreenText: '', visualAction: 'אישה מחייכת', estDurationSec: 3, notes: '' },
          ],
        }),
      },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
};

async function expectProviderError(p: Promise<unknown>, retryable: boolean, code: string) {
  const err = await p.catch((e) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect((err as ProviderError).retryable).toBe(retryable);
  expect((err as ProviderError).code).toBe(code);
}

describe('OpenAITextProvider', () => {
  it('writes free text first (like the chat), then structures it into scenes', async () => {
    const sent: any[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as any).Authorization });
      return new Response(JSON.stringify(okScript), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenAITextProvider(cfg, fetchFn);
    const r = await p.generateScript(ctx, { model: 'override-model' });
    expect(sent).toHaveLength(2);
    const [creative, structure] = sent;
    expect(creative.url).toBe('https://api.example/v1/chat/completions');
    expect(creative.auth).toBe('Bearer sk-test');
    expect(creative.body.model).toBe('override-model');
    expect(creative.body.response_format).toBeUndefined();
    expect(creative.body.messages[0].content).toContain('COPY RULES');
    expect(structure.body.response_format.json_schema.strict).toBe(true);
    expect(structure.body.messages[0].content).toContain('WORD FOR WORD');
    expect(r.data.scenes[0].narration).toBe('שלום');
    expect(r.model).toBe('gpt-test-2026');
    expect(r.usage?.outputTokens).toBe(40);
  });

  it('missing API key is a non-retryable error', async () => {
    const p = new OpenAITextProvider({ ...cfg, apiKey: '' }, respond(200, okScript));
    expect(p.isConfigured()).toBe(false);
    await expectProviderError(p.generateScript(ctx), false, 'missing_api_key');
  });

  it('classifies HTTP errors', async () => {
    await expectProviderError(
      new OpenAITextProvider(cfg, respond(401, { error: { message: 'bad key' } })).generateScript(ctx),
      false,
      'auth',
    );
    await expectProviderError(
      new OpenAITextProvider(cfg, respond(429, { error: { message: 'quota', code: 'insufficient_quota' } })).generateScript(ctx),
      false,
      'insufficient_quota',
    );
    await expectProviderError(
      new OpenAITextProvider(cfg, respond(429, { error: { message: 'slow down' } })).generateScript(ctx),
      true,
      'rate_limit',
    );
    await expectProviderError(
      new OpenAITextProvider(cfg, respond(503, { error: { message: 'down' } })).generateScript(ctx),
      true,
      'server',
    );
    await expectProviderError(
      new OpenAITextProvider(cfg, respond(404, { error: { message: 'no model', code: 'model_not_found' } })).generateScript(ctx),
      false,
      'model_not_found',
    );
  });

  it('handles refusals, truncation and network errors', async () => {
    await expectProviderError(
      new OpenAITextProvider(cfg, respond(200, { choices: [{ message: { refusal: 'no' } }] })).generateScript(ctx),
      false,
      'refusal',
    );
    await expectProviderError(
      new OpenAITextProvider(cfg, respond(200, { choices: [{ finish_reason: 'length', message: { content: '{' } }] })).generateScript(ctx),
      true,
      'truncated',
    );
    const boom = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expectProviderError(new OpenAITextProvider(cfg, boom).generateScript(ctx), true, 'network');
  });
});
