/**
 * התראות Push: קופצות במחשב / בטלפון גם כשהמערכת סגורה (דרך Chrome / Edge),
 * ומסמנות את האייקון של האפליקציה בשורת המשימות.
 * המפתחות (VAPID) נוצרים פעם אחת ונשמרים במסד הנתונים בשרת — לא בקוד ולא ב-GitHub.
 */
import webpush from 'web-push';
import type { Ctx } from '../context.js';
import { GateError } from '../context.js';

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  label?: string;
  createdAt?: string;
}

export interface PushMessage {
  title: string;
  body?: string;
  link?: string;
  tag?: string;
}

type Sender = (sub: PushSub, payload: string, vapid: { publicKey: string; privateKey: string }) => Promise<unknown>;

/** שליחה בפועל (בבדיקות מחליפים אותה) */
export let pushSender: Sender = (sub, payload, v) =>
  webpush.sendNotification(sub, payload, { vapidDetails: { subject: 'mailto:apos@ai-production-ap.onrender.com', publicKey: v.publicKey, privateKey: v.privateKey }, TTL: 6 * 3600, urgency: 'high' });
export function setPushSender(s: Sender) {
  pushSender = s;
}

const getMeta = (ctx: Ctx, key: string) => (ctx.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
const setMeta = (ctx: Ctx, key: string, value: string) => ctx.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

export function vapidKeys(ctx: Ctx): { publicKey: string; privateKey: string } {
  const raw = getMeta(ctx, 'vapid');
  if (raw) return JSON.parse(raw);
  const k = webpush.generateVAPIDKeys();
  setMeta(ctx, 'vapid', JSON.stringify(k));
  return k;
}

export function listSubs(ctx: Ctx): PushSub[] {
  const raw = getMeta(ctx, 'push_subs');
  return raw ? (JSON.parse(raw) as PushSub[]) : [];
}
const saveSubs = (ctx: Ctx, subs: PushSub[]) => setMeta(ctx, 'push_subs', JSON.stringify(subs.slice(-20)));

export function subscribe(ctx: Ctx, sub: Partial<PushSub>) {
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new GateError('מנוי התראות לא תקין', 400);
  const clean: PushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, label: String(sub.label ?? '').slice(0, 60), createdAt: ctx.now().toISOString() };
  saveSubs(ctx, [...listSubs(ctx).filter((s) => s.endpoint !== clean.endpoint), clean]);
  return { devices: listSubs(ctx).length };
}

export function unsubscribe(ctx: Ctx, endpoint: string) {
  saveSubs(ctx, listSubs(ctx).filter((s) => s.endpoint !== endpoint));
  return { devices: listSubs(ctx).length };
}

/** שולח לכל המכשירים הרשומים; מכשיר שבוטל (404/410) יורד מהרשימה */
export async function pushAll(ctx: Ctx, m: PushMessage): Promise<{ sent: number; failed: number }> {
  const subs = listSubs(ctx);
  if (!subs.length) return { sent: 0, failed: 0 };
  const v = vapidKeys(ctx);
  const payload = JSON.stringify({ title: m.title, body: m.body ?? '', link: m.link || '/', tag: m.tag });
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await pushSender(s, payload, v);
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.endpoint);
        else console.warn('[push] failed:', code ?? (e as Error).message);
      }
    }),
  );
  if (gone.length) saveSubs(ctx, listSubs(ctx).filter((s) => !gone.includes(s.endpoint)));
  return { sent, failed: subs.length - sent };
}
