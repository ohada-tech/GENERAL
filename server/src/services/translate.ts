/**
 * תרגום תסריט לתצוגה בלבד: מה שנשלח ללקוח (Word) תמיד בשפת המקור.
 * תרגום של גרסה נשמר לפי שפה, כך שלחיצה חוזרת לא עולה שוב.
 */
import type { ScriptContent } from '@apos/shared';
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { json } from '../db/db.js';
import { getScript } from '../db/repo.js';
import { ProviderError } from '../providers/types.js';

export type TranslateLang = 'he' | 'en';
const LANG_NAME: Record<TranslateLang, string> = { he: 'Hebrew', en: 'English' };

type JsonProvider = { isConfigured(): boolean; json?: <T>(n: string, s: object, sys: string, user: string) => Promise<{ data: T }> };

const str = { type: 'string' } as const;
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'logline', 'scenes'],
  properties: {
    title: str,
    logline: str,
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['narration', 'onScreenText', 'visualAction', 'notes'],
        properties: { narration: str, onScreenText: str, visualAction: str, notes: str },
      },
    },
  },
} as const;

type Translated = { title: string; logline: string; scenes: Array<{ narration: string; onScreenText: string; visualAction: string; notes: string }> };

export function cachedTranslation(ctx: Ctx, versionId: string, lang: TranslateLang): ScriptContent | null {
  const r = ctx.db.prepare('SELECT content FROM script_translations WHERE version_id = ? AND lang = ?').get(versionId, lang) as { content: string } | undefined;
  return r ? (JSON.parse(r.content) as ScriptContent) : null;
}

export async function translateScript(ctx: Ctx, versionId: string, lang: TranslateLang) {
  if (lang !== 'he' && lang !== 'en') throw new GateError('שפה לא נתמכת', 400);
  const v = getScript(ctx.db, versionId);
  if (!v) throw new NotFoundError('גרסת תסריט');
  const hit = cachedTranslation(ctx, versionId, lang);
  if (hit) return { content: hit, cached: true };

  const prov = [ctx.providers.text.claude, ctx.providers.text.openai].find((x) => x?.isConfigured()) as JsonProvider | undefined;
  if (!prov?.json) throw new ProviderError('אין מנוע מחובר לתרגום (Claude או ChatGPT)', false, 'not_configured');
  const src = v.content;
  const r = await prov.json<Translated>(
    'script_translation',
    SCHEMA,
    [
      `Translate this video script into natural ${LANG_NAME[lang]} so the producer can read it. It is for reading only and is never sent to the client.`,
      'Translate every field faithfully: same meaning, same tone, nothing added or removed, same number of scenes in the same order. Empty fields stay empty.',
      'Keep brand and product names, app UI labels and poker/industry terms of art exactly as written in the source (for example rivr+, Home Game, flop, turn, river).',
    ].join('\n'),
    JSON.stringify({ title: src.title, logline: src.logline, scenes: src.scenes.map((s) => ({ narration: s.narration, onScreenText: s.onScreenText, visualAction: s.visualAction, notes: s.notes })) }),
  );
  const t = r.data;
  if (!t || !Array.isArray(t.scenes) || t.scenes.length !== src.scenes.length) {
    throw new ProviderError('התרגום חזר חלקי — נסה שוב', true, 'empty_output');
  }
  // רק הטקסט מתורגם; מזהים, תפקידים ומשכים נשארים מהמקור
  const content: ScriptContent = {
    title: t.title ?? '',
    logline: t.logline ?? '',
    scenes: src.scenes.map((s, i) => ({ ...s, ...t.scenes[i] })),
  };
  ctx.db
    .prepare('INSERT OR REPLACE INTO script_translations (version_id, lang, content, created_at) VALUES (?, ?, ?, ?)')
    .run(versionId, lang, json(content), ctx.now().toISOString());
  return { content, cached: false };
}
