import type { NotificationKind } from '@apos/shared';
import type { Ctx } from '../context.js';
import { uid } from '../db/db.js';
import { pushAll } from './push.js';

export interface NotifyInput {
  projectId: string | null;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  /** מונע התראות כפולות על אותו אירוע */
  dedupeKey?: string;
}

export function notify(ctx: Ctx, n: NotifyInput): boolean {
  const res = ctx.db
    .prepare(
      `INSERT OR IGNORE INTO notifications (id, project_id, kind, title, body, link, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uid(),
      n.projectId,
      n.kind,
      n.title,
      n.body ?? '',
      n.link ?? '',
      n.dedupeKey ?? null,
      ctx.now().toISOString(),
    );
  const added = Number(res.changes) > 0;
  // מה שמחכה לאוהד קופץ גם כהתראה במחשב / בטלפון, גם כשהמערכת סגורה
  if (added && n.kind === 'approval_needed') {
    void pushAll(ctx, { title: n.title, body: n.body, link: n.link, tag: n.dedupeKey ?? undefined }).catch((e) => console.warn('[push]', (e as Error).message));
  }
  return added;
}
