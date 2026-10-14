/**
 * צ'אט "שינויים במערכת": אתה כותב בקשה (אפשר עם צילום מסך), Claude — שמפתח את המערכת — עובר על הבקשות
 * החדשות, מבצע, ועונה באותו שרשור. owner = אתה, claude = המפתח.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { uid } from '../db/db.js';
import { notify } from './notifications.js';

export type DevStatus = 'new' | 'in_progress' | 'done' | 'declined' | 'info';

export interface DevMessage {
  id: string;
  role: 'owner' | 'claude';
  text: string;
  status: DevStatus;
  attachments: string[];
  replyTo: string | null;
  createdAt: string;
  updatedAt: string;
}

const map = (r: any): DevMessage => ({
  id: r.id,
  role: r.role,
  text: r.text,
  status: r.status,
  attachments: JSON.parse(r.attachments || '[]'),
  replyTo: r.reply_to ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const dir = (ctx: Ctx) => path.join(ctx.config.dataDir, 'dev-chat');

export function listDevMessages(ctx: Ctx, opts: { status?: string } = {}): DevMessage[] {
  const rows = opts.status
    ? ctx.db.prepare('SELECT * FROM dev_messages WHERE status = ? ORDER BY created_at').all(opts.status)
    : ctx.db.prepare('SELECT * FROM dev_messages ORDER BY created_at').all();
  return (rows as any[]).map(map);
}

export function getDevMessage(ctx: Ctx, id: string) {
  const r = ctx.db.prepare('SELECT * FROM dev_messages WHERE id = ?').get(id);
  return r ? map(r) : null;
}

export function postDevMessage(ctx: Ctx, input: { role: 'owner' | 'claude'; text: string; attachments?: string[]; replyTo?: string | null; status?: DevStatus }) {
  const text = (input.text ?? '').trim();
  const attachments = (input.attachments ?? []).filter((a) => /^[a-z0-9-]+\.(png|jpe?g|webp|gif)$/i.test(a));
  if (!text && !attachments.length) throw new GateError('ההודעה ריקה', 400);
  const id = uid();
  const now = ctx.now().toISOString();
  const status: DevStatus = input.status ?? (input.role === 'owner' ? 'new' : 'info');
  ctx.db
    .prepare('INSERT INTO dev_messages (id, role, text, status, attachments, reply_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.role, text.slice(0, 20000), status, JSON.stringify(attachments), input.replyTo ?? null, now, now);
  if (input.role === 'claude') {
    // תשובה של המפתח: מעדכנים את הבקשה המקורית ומתריעים לך בפעמון
    if (input.replyTo && input.status && input.status !== 'info') setDevStatus(ctx, input.replyTo, input.status);
    notify(ctx, {
      projectId: null,
      kind: 'info',
      title: input.status === 'done' ? 'Claude ביצע את הבקשה שלך ✓' : 'Claude ענה בצ\'אט השינויים',
      body: text.slice(0, 160),
      link: '/?dev=1',
      dedupeKey: `dev:${id}`,
    });
  }
  return getDevMessage(ctx, id)!;
}

export function setDevStatus(ctx: Ctx, id: string, status: DevStatus) {
  if (!['new', 'in_progress', 'done', 'declined', 'info'].includes(status)) throw new GateError('סטטוס לא תקין', 400);
  const r = ctx.db.prepare('UPDATE dev_messages SET status = ?, updated_at = ? WHERE id = ?').run(status, ctx.now().toISOString(), id);
  if (!r.changes) throw new NotFoundError('הודעה');
  return getDevMessage(ctx, id)!;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

export function saveDevAttachment(ctx: Ctx, data: Buffer, mime: string) {
  const ext = Object.entries(MIME).find(([, m]) => m === mime)?.[0];
  if (!ext) throw new GateError('אפשר לצרף רק תמונות', 400);
  fs.mkdirSync(dir(ctx), { recursive: true });
  const name = `${uid()}.${ext}`;
  fs.writeFileSync(path.join(dir(ctx), name), data);
  return name;
}

export function devAttachmentPath(ctx: Ctx, name: string) {
  if (!/^[a-z0-9-]+\.(png|jpe?g|webp|gif)$/i.test(name)) return null;
  const p = path.join(dir(ctx), name);
  return fs.existsSync(p) ? { path: p, mime: MIME[name.split('.').pop()!.toLowerCase()] } : null;
}
