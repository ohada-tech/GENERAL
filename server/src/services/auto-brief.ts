/**
 * מילוי אפיון אוטומטי: מסיכום / צ'אט / קבצים / אתר הלקוח ← כל שדות האפיון.
 * ממלא רק שדות ריקים (אלא אם ביקשו לדרוס), מסמן מה מילא ה-AI, ומחזיר מה עוד חסר — כשאלות קצרות לאוהד.
 */
import { briefSchema, type Brief } from '@apos/shared';
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { getProject } from '../db/repo.js';
import { ProviderError } from '../providers/types.js';
import { updateBrief } from '../workflow/commands.js';
import { lessonsFor } from './learning.js';

const TEXT_LIMIT = 40_000;
const SITE_LIMIT = 14_000;

/** השדות שה-AI ממלא (בלי קבצים, קישורים ומטא-דאטה) */
const FIELDS = [
  'videoType', 'goal', 'productOrService', 'website', 'targetAudience', 'targetMarket', 'keyMessage', 'cta',
  'aspectRatio', 'visualStyle', 'inspirations', 'brandLogo', 'brandFonts', 'brandColors', 'brandImages',
  'language', 'tone', 'voiceNotes', 'budget', 'constraints', 'dueDate', 'notes',
] as const;
type TextField = (typeof FIELDS)[number];

const str = { type: 'string' } as const;
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['brief', 'missing'],
  properties: {
    brief: {
      type: 'object',
      additionalProperties: false,
      required: [...FIELDS, 'platforms', 'durationSec', 'voiceoverNeeded', 'characters'],
      properties: {
        ...Object.fromEntries(FIELDS.map((f) => [f, str])),
        platforms: { type: 'array', items: str },
        durationSec: { type: ['integer', 'null'] },
        voiceoverNeeded: { type: ['boolean', 'null'] },
        characters: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['name', 'description'], properties: { name: str, description: str } },
        },
      },
    },
    missing: { type: 'array', items: str },
  },
} as const;

type Extracted = {
  brief: Record<TextField, string> & { platforms: string[]; durationSec: number | null; voiceoverNeeded: boolean | null; characters: Array<{ name: string; description: string }> };
  missing: string[];
};

/** כתובת שמותר לשרת לקרוא: http(s) לאתר ציבורי בלבד */
function safeUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
  return u;
}

/** הטקסט של אתר הלקוח (כותרת, תיאור, תוכן) — בלי סקריפטים ועיצוב */
export async function siteText(raw: string, fetcher: typeof fetch = fetch): Promise<string> {
  const u = safeUrl(raw.trim());
  if (!u) return '';
  try {
    const res = await fetcher(u.toString(), { redirect: 'follow', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'Mozilla/5.0 AI-Production-AP brief reader' } });
    if (!res.ok || !String(res.headers.get('content-type') ?? '').includes('html')) return '';
    const html = (await res.text()).slice(0, 1_500_000);
    const meta = (name: string) => html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)`, 'i'))?.[1] ?? '';
    const title = html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? '';
    const body = html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|section|article|header|footer)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();
    return [`כתובת: ${u}`, title && `כותרת: ${title.trim()}`, meta('description') && `תיאור: ${meta('description')}`, meta('og:description') && `תיאור לשיתוף: ${meta('og:description')}`, body]
      .filter(Boolean)
      .join('\n')
      .slice(0, SITE_LIMIT);
  } catch {
    return '';
  }
}

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);

export async function autofillBrief(
  ctx: Ctx,
  projectId: string,
  input: { text?: string; url?: string; files?: Array<{ name: string; text: string }>; overwrite?: boolean },
  fetcher?: typeof fetch,
) {
  const p = getProject(ctx.db, projectId);
  if (!p) throw new NotFoundError('פרויקט');
  const url = (input.url ?? '').trim() || p.brief.website;
  const site = url ? await siteText(url, fetcher) : '';
  const parts = [
    input.text?.trim() && `### סיכום / שיחה / הערות שאוהד שלח\n${input.text.trim()}`,
    ...(input.files ?? []).filter((f) => f.text.trim()).map((f) => `### קובץ: ${f.name}\n${f.text.trim()}`),
    site && `### אתר הלקוח\n${site}`,
  ].filter(Boolean) as string[];
  if (!parts.length) throw new GateError('אין ממה למלא: הדבק סיכום, צרף קובץ או הוסף את אתר הלקוח', 400);
  const sources = parts.join('\n\n').slice(0, TEXT_LIMIT);

  const prov = [ctx.providers.text.claude, ctx.providers.text.openai].find((x) => x?.isConfigured()) as
    | { json?: <T>(n: string, s: object, sys: string, user: string) => Promise<{ data: T }> }
    | undefined;
  if (!prov?.json) throw new ProviderError('אין מנוע מחובר (Claude או ChatGPT) למילוי האפיון', false, 'not_configured');

  const current = Object.fromEntries(Object.entries(p.brief).filter(([k, v]) => !isEmpty(v) && !['attachmentIds', 'aiFilled', 'aiQuestions'].includes(k)));
  const r = await prov.json<Extracted>(
    'brief_autofill',
    SCHEMA,
    [
      'You fill a video production brief for an AI video studio, from the sources the owner (Ohad) collected: chat summaries, client notes, files and the client website.',
      'Fill every field you can support from the sources. Write field values in Hebrew (keep brand names, product names, URLs and English terms exactly as written; the brand name exactly as the brand writes it).',
      'Never invent facts: if the sources do not say it, return an empty string (or null / empty array). Prefer concrete wording from the sources over generic phrasing.',
      'videoType: the kind of video (e.g. סרטון תדמית, סרטון מוצר, רילס, פרסומת). durationSec: total seconds if stated. aspectRatio: 9:16 / 16:9 / 1:1 / 4:5 if stated or clearly implied by the platform. dueDate: YYYY-MM-DD only if an explicit date is given. platforms: where it will be shown.',
      'targetMarket: the country/market of the audience — never assume Israel unless the sources say so. language: the voice-over language.',
      'missing: up to 6 short Hebrew questions for Ohad about what is still unknown and matters most for the script (only things the sources do not answer).',
    ].join('\n'),
    `PROJECT: ${p.name}\nCLIENT: ${p.clientName}\n\nALREADY FILLED (keep consistent):\n${JSON.stringify(current, null, 1).slice(0, 4000)}\n\nKNOWN RULES FOR THIS CLIENT:\n${lessonsFor(ctx, p.clientName, ['general', 'script']).slice(0, 12).join('\n') || '(none)'}\n\nSOURCES:\n${sources}`,
  );

  const got = r.data?.brief;
  if (!got) throw new ProviderError('המילוי חזר ריק — נסה שוב', true, 'empty_output');
  const patch: Partial<Brief> = {};
  const filled: string[] = [];
  const consider = (key: keyof Brief, value: unknown) => {
    if (isEmpty(value)) return;
    if (!input.overwrite && !isEmpty(p.brief[key])) return;
    (patch as Record<string, unknown>)[key] = value;
    filled.push(key);
  };
  for (const f of FIELDS) consider(f, String(got[f] ?? '').trim());
  consider('platforms', (got.platforms ?? []).map((x) => String(x).trim()).filter(Boolean));
  if (typeof got.durationSec === 'number' && got.durationSec > 0) consider('durationSec', Math.round(got.durationSec));
  if (typeof got.voiceoverNeeded === 'boolean' && (input.overwrite || p.brief.voiceoverNeeded === briefSchema.parse({}).voiceoverNeeded)) {
    if (got.voiceoverNeeded !== p.brief.voiceoverNeeded) {
      patch.voiceoverNeeded = got.voiceoverNeeded;
      filled.push('voiceoverNeeded');
    }
  }
  consider('characters', (got.characters ?? []).filter((c) => c.name?.trim() || c.description?.trim()));
  if (url && !p.brief.website) {
    patch.website = url;
    if (!filled.includes('website')) filled.push('website');
  }

  const questions = (r.data?.missing ?? []).map((q) => String(q).trim()).filter(Boolean).slice(0, 6);
  const aiFilled = [...new Set([...(input.overwrite ? [] : p.brief.aiFilled ?? []), ...filled])];
  const project = updateBrief(ctx, projectId, { ...patch, aiFilled, aiQuestions: questions }, { by: 'Claude', note: `מולא אוטומטית: ${filled.length} שדות` });
  return { brief: project.brief, filled, questions, usedSite: Boolean(site) };
}
