/**
 * קיצור הערות גרסה ישנות (מלפני שהן נכתבו קצרות): "תיקון ל-v2: <מה שונה, עד ~12 מילים>".
 * רץ פעם אחת ברקע בהפעלת השרת, רק על הערות ארוכות. בלי מנוע כתיבה — קיצור מכני.
 */
import type { Ctx } from '../context.js';

export const LONG_NOTE = 90;

type JsonProvider = { isConfigured(): boolean; json?: <T>(n: string, s: object, sys: string, user: string) => Promise<{ data: T }> };

/** הקידומת הקבועה: "תיקון ל-vN" / "טיוטה ראשונה מהאפיון" */
export function notePrefix(note: string): string {
  const m = /^תיקון(?: AI)? ל-v(\d+)( \([^)]*בלבד\))?/.exec(note);
  if (m) return `תיקון ל-v${m[1]}${m[2] ?? ''}`;
  if (note.startsWith('טיוטה ראשונה')) return 'טיוטה ראשונה';
  return '';
}

export function mechanicalShort(note: string): string {
  const prefix = notePrefix(note);
  const rest = note
    .replace(/^תיקון(?: AI)? ל-v\d+ לפי משוב:[\s\S]*?(?= · |$)/, '')
    .replace(/^טיוטה ראשונה מהאפיון/, '')
    .replace(/^\s*·\s*[^:]{0,20}שיפר:\s*/, '')
    .trim();
  const first = rest.split(' · ')[0]?.trim() ?? '';
  const words = first.split(/\s+/).filter(Boolean).slice(0, 12).join(' ');
  return [prefix, words].filter(Boolean).join(': ') || note.slice(0, LONG_NOTE);
}

export async function compactChangeNotes(ctx: Ctx): Promise<number> {
  const rows = ctx.db
    .prepare("SELECT id, change_note AS note FROM script_versions WHERE source IN ('ai', 'ai_revision') AND length(change_note) > ?")
    .all(LONG_NOTE) as Array<{ id: string; note: string }>;
  if (!rows.length) return 0;
  const p = [ctx.providers.text.claude, ctx.providers.text.openai].find((x) => x?.isConfigured()) as JsonProvider | undefined;
  const upd = ctx.db.prepare('UPDATE script_versions SET change_note = ? WHERE id = ?');
  for (const r of rows) {
    let short = '';
    if (p?.json) {
      try {
        const out = await p.json<{ summary: string }>(
          'change_note',
          { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string' } } },
          'You shorten version notes of a video script. Return in Hebrew only WHAT CHANGED in this version, at most 12 words, no praise, no explanations, no restating the owner\'s feedback. Example: "סצנה 6: תוקנה שגיאת כתיב, קוצרו שתי השורות האחרונות".',
          `VERSION NOTE:\n${r.note}`,
        );
        short = String(out.data?.summary ?? '').trim().split(/\s+/).slice(0, 14).join(' ');
      } catch {
        /* קיצור מכני */
      }
    }
    const prefix = notePrefix(r.note);
    upd.run(short ? [prefix, short].filter(Boolean).join(': ') : mechanicalShort(r.note), r.id);
  }
  return rows.length;
}
