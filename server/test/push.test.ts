import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { notify } from '../src/services/notifications.js';
import { listSubs, pushSender, setPushSender, subscribe, vapidKeys } from '../src/services/push.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx } from './helpers.js';

const original = pushSender;
afterEach(() => setPushSender(original));

const sub = (n = 1) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'p', auth: 'a' } });
const flush = () => new Promise((r) => setTimeout(r, 10));

describe('Push alerts when something waits for Ohad', () => {
  it('keeps one VAPID key pair in the database', () => {
    const ctx = makeCtx();
    const k = vapidKeys(ctx);
    expect(k.publicKey.length).toBeGreaterThan(40);
    expect(vapidKeys(ctx)).toEqual(k);
  });

  it('pushes approval notifications only, and drops expired devices', async () => {
    const ctx = makeCtx();
    const sent: string[] = [];
    setPushSender(async (s, payload) => {
      if (s.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push(JSON.parse(payload).title);
    });
    subscribe(ctx, sub(1));
    subscribe(ctx, sub(2));
    subscribe(ctx, sub(1)); // אותו מכשיר — לא כפול
    expect(listSubs(ctx)).toHaveLength(2);

    notify(ctx, { projectId: null, kind: 'info', title: 'סתם מידע' });
    notify(ctx, { projectId: null, kind: 'approval_needed', title: 'טיוטה מוכנה לבדיקה', link: '/projects/x' });
    await flush();
    expect(sent).toEqual(['טיוטה מוכנה לבדיקה']);
    expect(listSubs(ctx).map((s) => s.endpoint)).toEqual(['https://push.example/1']);
  });

  it('"Claude is waiting for you" reaches the bell, the project history and push', async () => {
    const ctx = makeCtx();
    const sent: Array<{ title: string; body: string; link: string }> = [];
    setPushSender(async (_s, payload) => void sent.push(JSON.parse(payload)));
    subscribe(ctx, sub(1));
    const p = cmd.createProject(ctx, { name: 'Car rental', clientName: 'Rent' });
    const app = await buildApp(ctx);
    const r = await app.inject({ method: 'POST', url: '/api/attention', payload: { projectId: p.id, text: 'תפתח את Chrome עם התוסף של Claude' } });
    expect(r.statusCode).toBe(201);
    await flush();
    expect(sent[0].title).toContain('Claude מחכה לך · Car rental');
    expect(sent[0].body).toBe('תפתח את Chrome עם התוסף של Claude');
    expect(sent[0].link).toBe(`/projects/${p.id}`);
    // דחוף — באזור "מחכה לך", לא בפעמון
    const urgent = (await app.inject({ url: '/api/attention' })).json();
    expect(urgent).toHaveLength(1);
    expect(urgent[0].readAt).toBeNull();
    expect((await app.inject({ url: '/api/notifications' })).json()).toHaveLength(0);
    await app.inject({ method: 'POST', url: '/api/notifications/read-all' });
    expect((await app.inject({ url: '/api/attention' })).json()[0].readAt).toBeNull();
    await app.inject({ method: 'POST', url: `/api/attention/${urgent[0].id}/done` });
    expect((await app.inject({ url: '/api/attention' })).json()[0].readAt).not.toBeNull();
    expect((await app.inject({ method: 'POST', url: '/api/attention', payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/push/subscribe', payload: { endpoint: 'http://x' } })).statusCode).toBe(400);
  });
});

describe('"מחכה לך" מסונכרן עם העבודה', () => {
  it('הודעה חדשה על אותו פרויקט מחליפה את הקודמת; נמסר סוגר הכל; סגירה לפי מילים', async () => {
    const ctx = makeCtx();
    setPushSender(async () => undefined);
    const p = cmd.createProject(ctx, { name: 'Car rental', clientName: 'Rent' });
    const app = await buildApp(ctx);
    const open = async () => (await app.inject({ url: '/api/attention' })).json().filter((n: any) => !n.readAt);
    await app.inject({ method: 'POST', url: '/api/attention', payload: { projectId: p.id, text: 'שלב 1: תתחבר להיגספילד' } });
    await app.inject({ method: 'POST', url: '/api/attention', payload: { projectId: p.id, text: 'שלב 2: לאשר קריינות' } });
    await app.inject({ method: 'POST', url: '/api/attention', payload: { text: 'שאלה כללית בלי פרויקט' } });
    expect((await open()).map((n: any) => n.body).sort()).toEqual(['שאלה כללית בלי פרויקט', 'שלב 2: לאשר קריינות'].sort());
    const r = (await app.inject({ method: 'POST', url: '/api/attention/resolve', payload: { match: 'שאלה כללית' } })).json();
    expect(r.resolved).toBe(1);
    cmd.markDelivered(ctx, p.id, {});
    expect(await open()).toEqual([]);
    expect((await app.inject({ method: 'POST', url: '/api/attention/resolve', payload: {} })).statusCode).toBe(400);
  });
});
