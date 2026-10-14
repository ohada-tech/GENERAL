import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeCtx } from './helpers.js';

describe('Change-request chat with Claude', () => {
  it('owner posts a request; only the operator can answer as Claude and close it', async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const r = await app.inject({ method: 'POST', url: '/api/dev/messages', payload: { text: 'להוסיף כפתור', role: 'claude' } });
    expect(r.statusCode).toBe(201);
    expect(r.json().role).toBe('owner'); // דפדפן לא יכול להתחזות ל-Claude
    expect(r.json().status).toBe('new');
    const id = r.json().id;
    expect((await app.inject({ url: '/api/dev/messages?status=new' })).json().messages).toHaveLength(1);
    const ans = await app.inject({
      method: 'POST',
      url: '/api/dev/messages',
      headers: { authorization: 'Bearer test' },
      payload: { role: 'claude', text: 'בוצע', replyTo: id, status: 'done' },
    });
    expect(ans.json().role).toBe('claude');
    expect((await app.inject({ url: '/api/dev/messages?status=new' })).json().messages).toHaveLength(0);
    const n = ctx.db.prepare("SELECT title FROM notifications WHERE title LIKE 'Claude%'").all();
    expect(n).toHaveLength(1);
    expect((await app.inject({ url: '/api/dev/attachments/..%2F..%2Fetc%2Fpasswd' })).statusCode).toBe(404);
    await app.close();
  });
});
