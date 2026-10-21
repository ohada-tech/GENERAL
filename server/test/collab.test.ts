import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { CollabTextProvider, type JsonCapableProvider } from '../src/providers/collab.js';
import { DemoTextProvider } from '../src/providers/demo.js';
import { makeCtx, FULL_BRIEF } from './helpers.js';

/** "מודל" מזויף שתומך גם בקריאת JSON כללית — כדי לבדוק את שרשרת כותב → מבקר */
function fakeModel(id: string, configured = true): JsonCapableProvider & { reviews: string[] } {
  const demo = new DemoTextProvider();
  return {
    id,
    label: id,
    isDemo: false,
    reviews: [],
    isConfigured: () => configured,
    generateScript: async (c) => ({ ...(await demo.generateScript(c)), provider: id, model: `${id}-m` }),
    reviseScript: async (c, b, f) => ({ ...(await demo.reviseScript(c, b, f)), provider: id, model: `${id}-m` }),
    generateStoryboard: async (c, s, d) => ({ ...(await demo.generateStoryboard(c, s, d)), provider: id, model: `${id}-m` }),
    async json<T>(name: string, _schema: object, _sys: string, user: string) {
      this.reviews.push(name);
      const draft = JSON.parse(user.split('DRAFT SCRIPT (JSON):\n')[1]?.split('\n\nReturn')[0] ?? '{}');
      // המבקר "מנסה" לשנות גם קופי — זה חייב להיזרק כשהמבקר הוא Claude
      const scenes = (draft.scenes ?? []).map((s: any) => ({ ...s, narration: 'שוכתב', visualAction: `${s.visualAction} (ויזואל)` }));
      const data = { reviewNotes: ['חיזקתי את ההוק'], script: { ...draft, title: `${draft.title} (משופר)`, scenes } };
      return { data: data as T, model: `${id}-m` };
    },
  };
}

const pc = { name: 'P', clientName: 'C', brief: { ...FULL_BRIEF, characters: [], links: [], attachmentIds: [] } as any };

describe('ChatGPT + Claude collaboration', () => {
  it('ChatGPT writes the copy; Claude improves only the visuals (copy is locked)', async () => {
    const gpt = fakeModel('openai');
    const claude = fakeModel('claude');
    const collab = new CollabTextProvider(gpt, claude);
    expect(collab.label).toBe('ChatGPT כותב · Claude משפר');
    const written = await gpt.generateScript(pc);
    const r = await collab.generateScript(pc);
    expect(claude.reviews).toEqual(['script_review']);
    expect(r.data.title).toBe(written.data.title);
    expect(r.data.scenes.map((s) => s.narration)).toEqual(written.data.scenes.map((s) => s.narration));
    expect(r.data.scenes.every((s) => s.visualAction.endsWith('(ויזואל)'))).toBe(true);
    expect(r.reviewNotes).toEqual(['חיזקתי את ההוק']);
    expect(r.model).toBe('ChatGPT (openai-m) + Claude (claude-m)');
  });

  it('refuses to silently fall back to one model when the other is not connected', async () => {
    const collab = new CollabTextProvider(fakeModel('openai'), fakeModel('claude', false));
    await expect(collab.generateScript(pc)).rejects.toThrow(/Claude לא מחובר/);
  });
});

describe('Login', () => {
  it('protects every /api route when a password is set', async () => {
    const ctx = makeCtx();
    ctx.config.auth.password = 'secret-pass';
    const app = await buildApp(ctx);
    expect((await app.inject({ url: '/api/dashboard' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/healthz' })).statusCode).toBe(200);
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'nope' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secret-pass' } });
    expect(ok.statusCode).toBe(200);
    const cookie = String(ok.headers['set-cookie']).split(';')[0];
    expect((await app.inject({ url: '/api/dashboard', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/dashboard', headers: { cookie: cookie.slice(0, -3) + 'xxx' } })).statusCode).toBe(401);
    await app.close();
  });
});
