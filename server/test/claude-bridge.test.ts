import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { AnthropicTextProvider } from '../src/providers/anthropic.js';
import { bridges } from '../src/services/bridge.js';
import { makeCtx } from './helpers.js';

const cfg = { apiKey: '', model: 'claude-test', timeoutMs: 5000 };

afterEach(() => {
  for (const b of Object.values(bridges)) {
    b.mode = 'fallback';
    b.lastSeen = 0;
  }
});

describe('גשר ל-Claude Code (מנוי Max)', () => {
  it('בלי מפתח / בלי קרדיט — הסטורי בורד עובר לעובד של Claude, לא לתור של ChatGPT', async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    bridges.claude.lastSeen = Date.now();
    const p = new AnthropicTextProvider(cfg);
    expect(p.isConfigured()).toBe(true);
    const pending = p.json<{ shots: string[] }>('storyboard', { type: 'object' }, 'SYS', 'USER');

    // ChatGPT לא מקבל את הבקשה
    expect((await app.inject({ url: '/api/bridge/next?wait=0&worker=pc-chrome' })).statusCode).toBe(204);
    const req = (await app.inject({ url: '/api/bridge/next?wait=1&worker=pc-claude&engine=claude' })).json();
    expect(req).toMatchObject({ system: 'SYS', user: 'USER', schema: { type: 'object' } });
    await app.inject({ method: 'POST', url: `/api/bridge/${req.id}/result`, payload: { text: '```json\n{"shots":["a"]}\n```' } });
    const r = await pending;
    expect(r.data.shots).toEqual(['a']);
    expect(r.model).toBe('Claude Code (מנוי)');

    const st = (await app.inject({ url: '/api/bridge/status' })).json();
    expect(st.claude).toMatchObject({ online: true, kind: 'claude' });
    expect((await app.inject({ method: 'POST', url: '/api/bridge/mode', payload: { mode: 'always', engine: 'claude' } })).json().mode).toBe('always');
    expect(bridges.chatgpt.mode).toBe('fallback');
  });

  it('מצב always והמחשב כבוי — ממתינים לגשר של Claude ולא מנסים API', async () => {
    bridges.claude.mode = 'always';
    const p = new AnthropicTextProvider({ ...cfg, apiKey: 'sk-ant-test' });
    await expect(p.text('s', 'u')).rejects.toMatchObject({ code: 'bridge_offline', message: expect.stringContaining('Claude Code') });
  });
});
