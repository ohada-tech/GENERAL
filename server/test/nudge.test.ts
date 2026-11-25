import { nudgeText, waLink } from '@apos/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeCtx, projectWithBrief } from './helpers.js';

describe('תזכורת ללקוח', () => {
  const now = new Date('2026-11-24T10:00:00');
  it('נוסח בסגנון של אוהד: שם פרטי, מה שלומך, :) ובלי חתימה', () => {
    const t = nudgeText({ contactName: 'אילן כהן', what: 'התסריט', sentAt: '2026-11-20T10:00:00', viewed: true, now });
    const lines = t.split('\n');
    expect(lines[0]).toBe('היי אילן בוקר טוב מה שלומך?');
    expect(t).toContain('אשמח לדעת אם יצא לך לעבור על התסריט');
    expect(t).toContain(':)');
    expect(t).not.toMatch(/בברכה|לכבוד/);
  });
  it('לא נפתח: מוודא שהקישור הגיע ומצרף אותו', () => {
    const t = nudgeText({ contactName: '', what: 'התסריט', sentAt: '2026-11-20T10:00:00', viewed: false, url: 'https://x/s/abc', now });
    expect(t.split('\n')[0]).toBe('היי בוקר טוב מה שלומך?');
    expect(t).toContain('רק מוודא שהקישור לתסריט');
    expect(t).toContain('https://x/s/abc');
  });
  it('קישור וואטסאפ ממספר ישראלי', () => {
    expect(waLink('050-123-4567', 'היי')).toBe('https://wa.me/972501234567?text=%D7%94%D7%99%D7%99');
    expect(waLink('+972 50 1234567', 'a')).toContain('wa.me/972501234567');
    expect(waLink('', 'a')).toBeNull();
  });
  it('שם, טלפון ומתי הוזכר נשמרים לפרויקט ומופיעים בדשבורד', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    const app = await buildApp(ctx);
    await app.inject({ method: 'PATCH', url: `/api/projects/${p.id}`, payload: { settings: { contactName: 'לאה', contactPhone: '0521234567', nudgedAt: '2026-11-24T10:00:00.000Z' } } });
    const d = (await app.inject({ method: 'GET', url: '/api/dashboard' })).json();
    const s = d.projects.find((x: { id: string }) => x.id === p.id);
    expect(s.contact).toEqual({ name: 'לאה', phone: '0521234567', nudgedAt: '2026-11-24T10:00:00.000Z' });
  });
});
