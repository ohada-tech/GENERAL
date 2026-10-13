import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { Ctx } from '../src/context.js';
import { openDb } from '../src/db/db.js';
import { DemoTextProvider } from '../src/providers/demo.js';
import { OpenAITextProvider } from '../src/providers/openai.js';
import * as secrets from '../src/services/secrets.js';

const GOOD = 'sk-proj-' + 'a'.repeat(40);

function setup(responder: (url: string, key: string) => number) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apos-sec-'));
  const config = loadConfig({ DATA_DIR: dataDir, OPENAI_MODEL: 'gpt-test' } as any);
  const calls: string[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const key = String((init.headers as any).Authorization).replace('Bearer ', '');
    calls.push(url);
    const status = responder(url, key);
    return new Response(JSON.stringify(status === 200 ? { id: 'gpt-test' } : { error: { message: 'nope' } }), { status });
  }) as unknown as typeof fetch;
  secrets.loadSecrets(config);
  const ctx: Ctx = {
    db: openDb(':memory:'),
    config,
    providers: { text: { openai: new OpenAITextProvider(config.openai, fetchFn), demo: new DemoTextProvider() }, media: undefined as any },
    now: () => new Date(),
  };
  return { ctx, dataDir, calls };
}

describe('OpenAI connection from the UI', () => {
  it('verifies the key against OpenAI before saving, and never exposes it', async () => {
    const { ctx, dataDir, calls } = setup((_u, key) => (key === GOOD ? 200 : 401));
    expect(secrets.openaiStatus(ctx.config).configured).toBe(false);

    const bad = await secrets.saveOpenAI(ctx, { apiKey: 'sk-proj-' + 'b'.repeat(40) });
    expect(bad.ok).toBe(false);
    expect(ctx.config.openai.apiKey).toBe('');
    expect(fs.existsSync(path.join(dataDir, 'secrets.json'))).toBe(false);

    const ok = await secrets.saveOpenAI(ctx, { apiKey: GOOD });
    expect(ok.ok).toBe(true);
    expect(calls.at(-1)).toContain('/models/gpt-test');
    const st = secrets.openaiStatus(ctx.config);
    expect(st).toMatchObject({ configured: true, source: 'ui', verified: true, last4: 'aaaa' });
    expect(JSON.stringify(st)).not.toContain(GOOD);
    // הספק משתמש במפתח החדש מיד, בלי הפעלה מחדש
    expect(ctx.providers.text.openai.isConfigured()).toBe(true);

    // נשמר בקובץ ונטען בהפעלה הבאה
    const config2 = loadConfig({ DATA_DIR: dataDir } as any);
    secrets.loadSecrets(config2);
    expect(config2.openai.apiKey).toBe(GOOD);
  });

  it('rejects text that is not a key without calling OpenAI', async () => {
    const { ctx, calls } = setup(() => 200);
    const r = await secrets.saveOpenAI(ctx, { apiKey: 'hello' });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('reports a valid key with an unavailable model', async () => {
    const { ctx } = setup((url) => (url.endsWith('/models/no-such-model') ? 404 : 200));
    const r = await secrets.saveOpenAI(ctx, { apiKey: GOOD, model: 'no-such-model' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no-such-model');
    expect(ctx.config.openai.model).toBe('gpt-test');
  });

  it('test endpoint marks a revoked key as failed', async () => {
    let valid = true;
    const { ctx } = setup(() => (valid ? 200 : 401));
    await secrets.saveOpenAI(ctx, { apiKey: GOOD });
    valid = false;
    const st = await secrets.testOpenAI(ctx);
    expect(st.verified).toBe(false);
    expect(st.lastError).toContain('לא תקף');
    const cleared = secrets.clearOpenAI(ctx);
    expect(cleared.configured).toBe(false);
  });
});
