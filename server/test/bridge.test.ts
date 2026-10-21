import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { OpenAITextProvider } from '../src/providers/openai.js';
import { bridge } from '../src/services/bridge.js';
import { makeCtx } from './helpers.js';

const cfg = { apiKey: 'sk-test', model: 'gpt-test', baseUrl: 'https://api.example/v1', timeoutMs: 5000 };
const noCredits = (async () =>
  new Response(JSON.stringify({ error: { message: 'You have no credits remaining.' } }), { status: 429 })) as unknown as typeof fetch;

/** עובד מזויף: מושך בקשה אחת מהתור ועונה עליה */
async function workerAnswers(text: string) {
  const req = await bridge.next('test-worker', 2000);
  expect(req).toBeTruthy();
  bridge.answer(req!.id, { text });
  return req!;
}

afterEach(() => {
  bridge.mode = 'fallback';
  bridge.lastSeen = 0;
});

describe('גשר למנוי ChatGPT (Codex)', () => {
  it('נגמר הקרדיט ב-API והגשר מחובר — אותה בקשה עוברת למנוי', async () => {
    bridge.lastSeen = Date.now();
    const p = new OpenAITextProvider(cfg, noCredits);
    const pending = p.json<{ line: string }>('t', { type: 'object' }, 'SYS', 'USER');
    const req = await workerAnswers('{"line":"שלום"}');
    const r = await pending;
    expect(r.data.line).toBe('שלום');
    expect(r.model).toContain('מנוי');
    expect(req.system).toBe('SYS');
    expect(req.user).toBe('USER');
    expect(req.schema).toEqual({ type: 'object' });
  });

  it('הגשר לא מחובר — השגיאה המקורית של ה-API, בלי לחכות', async () => {
    const p = new OpenAITextProvider(cfg, noCredits);
    await expect(p.json('t', { type: 'object' }, 's', 'u')).rejects.toThrow(/credits/);
  });

  it('בלי מפתח API אבל עם גשר — נחשב מחובר וטקסט חופשי עובר', async () => {
    bridge.lastSeen = Date.now();
    const p = new OpenAITextProvider({ ...cfg, apiKey: '' }, noCredits);
    expect(p.isConfigured()).toBe(true);
    const pending = p.text('s', 'u');
    await workerAnswers('קריינות חופשית');
    expect((await pending).text).toBe('קריינות חופשית');
  });

  it('מצב "always": לא נוגעים ב-API בכלל; מצב "off": אף פעם לא במנוי', async () => {
    bridge.lastSeen = Date.now();
    let apiCalls = 0;
    const counting = (async (...a: Parameters<typeof fetch>) => {
      apiCalls++;
      return noCredits(...a);
    }) as typeof fetch;
    bridge.mode = 'always';
    const p = new OpenAITextProvider(cfg, counting);
    const pending = p.text('s', 'u');
    await workerAnswers('x');
    await pending;
    expect(apiCalls).toBe(0);
    bridge.mode = 'off';
    await expect(p.text('s', 'u')).rejects.toThrow(/credits/);
    expect(apiCalls).toBe(1);
  });

  it('הנתיבים: העובד מושך (204 כשאין), עונה, והמצב נשמר', async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    expect((await app.inject({ url: '/api/bridge/next?wait=0&worker=pc' })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/bridge/status' })).json().online).toBe(true);
    const pending = bridge.call('n', 's', 'u', null);
    const next = (await app.inject({ url: '/api/bridge/next?wait=0&worker=pc' })).json();
    await app.inject({ method: 'POST', url: `/api/bridge/${next.id}/result`, payload: { text: 'תשובה' } });
    expect(await pending).toBe('תשובה');
    const m = (await app.inject({ method: 'POST', url: '/api/bridge/mode', payload: { mode: 'always' } })).json();
    expect(m.mode).toBe('always');
    expect((ctx.db.prepare("SELECT value FROM meta WHERE key = 'bridge_mode'").get() as any).value).toBe('always');
  });
});
