import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { attentionTopic, needsOwner, tidyAttention } from '../src/services/attention.js';
import { isGarbled } from '../src/services/text-guard.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

const open = (ctx: ReturnType<typeof makeCtx>) =>
  ctx.db.prepare("SELECT body FROM notifications WHERE dedupe_key LIKE 'attention:%' AND read_at IS NULL ORDER BY created_at").all() as Array<{ body: string }>;

describe('"מחכה לך" stays clean', () => {
  it('topic is the short prefix before a colon', () => {
    expect(attentionTopic('כונן C: נשארו רק 6 GB פנויים')).toBe('כונן c');
    expect(attentionTopic('Fireberry: להתחבר מחדש')).toBe('fireberry');
    expect(attentionTopic('לבחור טייק קריינות רגוע')).toBeNull();
    expect(attentionTopic('משפט ארוך מאוד שיש בו נקודתיים רק הרבה אחרי ההתחלה: כאן')).toBeNull();
  });

  it('a new project-less alert on the same topic replaces the older one; other topics stay', () => {
    const ctx = makeCtx();
    needsOwner(ctx, { text: 'כונן C: נשארו רק 10 GB פנויים' });
    ctx.advance(60);
    needsOwner(ctx, { text: 'לבחור טייק קריינות לסרטון HERO' });
    ctx.advance(60);
    needsOwner(ctx, { text: 'כונן C: נשארו רק 6 GB פנויים' });
    expect(open(ctx).map((r) => r.body)).toEqual(['לבחור טייק קריינות לסרטון HERO', 'כונן C: נשארו רק 6 GB פנויים']);
  });

  it('startup tidy closes old duplicates and alerts of delivered projects, without deleting', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    const ins = ctx.db.prepare(
      "INSERT INTO notifications (id, project_id, kind, title, body, link, dedupe_key, created_at) VALUES (?, ?, 'approval_needed', '⏳ Claude מחכה לך', ?, '/', ?, ?)",
    );
    ins.run('a1', null, 'כונן C: 10 GB', 'attention:1', '2026-11-20T08:00:00.000Z');
    ins.run('a2', null, 'כונן C: 6 GB', 'attention:2', '2026-11-26T08:00:00.000Z');
    ins.run('a3', p.id, 'לבחור כרטיס סיום', 'attention:3', '2026-11-20T09:00:00.000Z');
    ctx.db.prepare('UPDATE projects SET delivered_at = ? WHERE id = ?').run('2026-11-24T10:00:00.000Z', p.id);
    expect(tidyAttention(ctx)).toEqual({ delivered: 1, duplicates: 1 });
    expect(open(ctx).map((r) => r.body)).toEqual(['כונן C: 6 GB']);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE dedupe_key LIKE 'attention:%'").get()).toMatchObject({ n: 3 });
    // הרשימה מחזירה את כל הפתוחות (בלי תקרה של 30) + אחרונות שטופלו
    for (let i = 0; i < 35; i++) needsOwner(ctx, { text: `שאלה מספר ${i}` });
    const app = await buildApp(ctx);
    const list = (await app.inject({ url: '/api/attention' })).json() as Array<{ readAt: string | null }>;
    expect(list.filter((n) => !n.readAt)).toHaveLength(36);
    expect(list.filter((n) => n.readAt).length).toBeGreaterThan(0);
    // "סגור ישנות" — רק מה שנשלח לפני התאריך
    const before = '2026-11-26T08:00:00.001Z';
    const older = ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE dedupe_key LIKE 'attention:%' AND read_at IS NULL AND created_at < ?").get(before) as { n: number };
    const r = await app.inject({ method: 'POST', url: '/api/attention/resolve', payload: { all: true, before } });
    expect(r.json().resolved).toBe(older.n);
    expect(ctx.db.prepare("SELECT read_at FROM notifications WHERE id = 'a2'").get()).toMatchObject({ read_at: expect.any(String) });
    expect(open(ctx)).toHaveLength(36 - older.n);
    await app.close();
  });

  it('marking a project delivered still clears its alerts', () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    needsOwner(ctx, { projectId: p.id, text: 'לבחור טייק' });
    cmd.markDelivered(ctx, p.id, {});
    expect(open(ctx)).toHaveLength(0);
  });
});

describe('Broken-encoding guard', () => {
  it('detects mojibake but lets a stray replacement char through', () => {
    expect(isGarbled('����. ��� ����� ������ ������� �� ����� ��� GNSS | OA')).toBe(true);
    expect(isGarbled('בוצע ✓ שוט 2 תוקן, והתמונה � הוחלפה')).toBe(false);
  });

  it('chat replies, alerts and progress updates with broken text are refused with 400', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    const app = await buildApp(ctx);
    const bad = '����. ��� ����� ������ ������� ��';
    const auth = { authorization: 'Bearer test' };
    const chat = await app.inject({ method: 'POST', url: '/api/dev/messages', headers: auth, payload: { role: 'claude', text: bad, status: 'done' } });
    expect(chat.statusCode).toBe(400);
    expect(chat.json().error).toContain('--data-binary');
    expect((await app.inject({ method: 'POST', url: '/api/attention', headers: auth, payload: { text: bad } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/projects/${p.id}/progress`, payload: { text: bad, by: 'Claude' } })).statusCode).toBe(400);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM dev_messages').get()).toMatchObject({ n: 0 });
    const ok = await app.inject({ method: 'POST', url: '/api/dev/messages', headers: auth, payload: { role: 'claude', text: 'בוצע ✓', status: 'info' } });
    expect(ok.statusCode).toBe(201);
    await app.close();
  });
});
