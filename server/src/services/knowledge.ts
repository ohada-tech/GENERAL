/**
 * ספר הידע: הסקילים שלימדת את Claude (קובצי SKILL.md) נטענים למערכת. Claude מזקק כל סקיל להנחיות הפקה
 * קצרות וממוקדות (בלי הוראות הפעלה של כלים), ומסמן לאילו תחומים ולקוחות הוא שייך.
 * ההנחיות נכנסות לפרומפטים של התסריט והסטורי בורד — לצד הכללים שהמערכת לומדת מההערות שלך.
 */
import { z } from 'zod';
import { GateError, type Ctx } from '../context.js';
import { uid } from '../db/db.js';
import type { LessonArea } from './learning.js';

/** "operations" = נהלי עבודה למפעיל (Higgsfield, אישורי תשלום) — נשמרים אבל לא נכנסים לפרומפטים */
export const SKILL_AREAS = ['script', 'storyboard', 'image', 'motion', 'audio', 'editing', 'general', 'operations'] as const;
export type SkillArea = (typeof SKILL_AREAS)[number];

/** תקרות כדי שהפרומפט לא יתנפח */
const MAX_SKILL_CHARS = 6000;
const MAX_TOTAL_CHARS = 24000;

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  digest: string;
  areas: SkillArea[];
  clients: string;
  priority: number;
  active: boolean;
  source: string;
  digestStatus: 'pending' | 'running' | 'done' | 'failed';
  digestError: string | null;
  createdAt: string;
  updatedAt: string;
}

const mapSkill = (r: any): Skill => ({
  id: r.id,
  name: r.name,
  description: r.description,
  body: r.body,
  digest: r.digest,
  areas: JSON.parse(r.areas || '[]'),
  clients: r.clients,
  priority: Number(r.priority),
  active: !!r.active,
  source: r.source,
  digestStatus: r.digest_status,
  digestError: r.digest_error ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const areaSchema = z.enum(SKILL_AREAS);
export const skillInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(''),
  body: z.string().min(1).max(200_000),
  areas: z.array(areaSchema).default([]),
  clients: z.string().max(500).default(''),
  priority: z.number().int().min(0).max(100).default(50),
  digest: z.string().max(20_000).optional(),
  source: z.string().max(40).default('claude'),
});
export type SkillInput = z.input<typeof skillInputSchema>;

/** קורא SKILL.md עם frontmatter (name/description) */
export function parseSkillMd(md: string, fallbackName = 'skill'): { name: string; description: string; body: string } {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(md);
  const field = (k: string) => {
    const r = m ? new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(m[1]) : null;
    return r ? r[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  return { name: field('name') || fallbackName, description: field('description'), body: m ? md.slice(m[0].length).trim() : md.trim() };
}

export function listSkills(ctx: Ctx): Skill[] {
  return (ctx.db.prepare('SELECT * FROM skills ORDER BY priority DESC, name').all() as any[]).map(mapSkill);
}

export function getSkill(ctx: Ctx, id: string): Skill | null {
  const r = ctx.db.prepare('SELECT * FROM skills WHERE id = ?').get(id);
  return r ? mapSkill(r) : null;
}

/** הוספה או עדכון לפי שם (ייבוא חוזר מעדכן ולא משכפל). אם הגוף השתנה — הזיקוק נעשה מחדש. */
export function upsertSkill(ctx: Ctx, raw: SkillInput): Skill {
  const input = skillInputSchema.parse(raw);
  const now = ctx.now().toISOString();
  const cur = ctx.db.prepare('SELECT * FROM skills WHERE name = ?').get(input.name) as any;
  const digest = input.digest?.trim() ?? '';
  if (cur) {
    const changed = cur.body !== input.body;
    ctx.db
      .prepare(
        `UPDATE skills SET description = ?, body = ?, areas = ?, clients = ?, priority = ?, source = ?,
           digest = CASE WHEN ? != '' THEN ? WHEN ? THEN '' ELSE digest END,
           digest_status = CASE WHEN ? != '' THEN 'done' WHEN ? THEN 'pending' ELSE digest_status END,
           updated_at = ? WHERE id = ?`,
      )
      .run(
        input.description,
        input.body,
        JSON.stringify(input.areas.length ? input.areas : JSON.parse(cur.areas)),
        input.clients || cur.clients,
        input.priority,
        input.source,
        digest,
        digest,
        changed ? 1 : 0,
        digest,
        changed ? 1 : 0,
        now,
        cur.id,
      );
    return getSkill(ctx, cur.id)!;
  }
  const id = uid();
  ctx.db
    .prepare(
      `INSERT INTO skills (id, name, description, body, digest, areas, clients, priority, active, source, digest_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .run(id, input.name, input.description, input.body, digest, JSON.stringify(input.areas), input.clients, input.priority, input.source, digest ? 'done' : 'pending', now, now);
  return getSkill(ctx, id)!;
}

export function updateSkill(ctx: Ctx, id: string, patch: { active?: boolean; digest?: string; areas?: string[]; clients?: string; priority?: number }) {
  const cur = getSkill(ctx, id);
  if (!cur) return null;
  const areas = patch.areas ? z.array(areaSchema).parse(patch.areas) : cur.areas;
  ctx.db
    .prepare('UPDATE skills SET active = ?, digest = ?, areas = ?, clients = ?, priority = ?, digest_status = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.active === undefined ? (cur.active ? 1 : 0) : patch.active ? 1 : 0,
      patch.digest ?? cur.digest,
      JSON.stringify(areas),
      patch.clients ?? cur.clients,
      patch.priority ?? cur.priority,
      patch.digest !== undefined ? 'done' : cur.digestStatus,
      ctx.now().toISOString(),
      id,
    );
  return getSkill(ctx, id);
}

export function deleteSkill(ctx: Ctx, id: string) {
  ctx.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** האם הסקיל שייך ללקוח: רשימת שמות מופרדת בפסיקים, התאמה גמישה (GO&GO ≈ gogo ≈ "GO&GO Retail") */
export function skillMatchesClient(clients: string, clientName: string): boolean {
  const aliases = clients.split(',').map(norm).filter(Boolean);
  if (!aliases.length) return true; // סקיל כללי
  const c = norm(clientName);
  return !!c && aliases.some((a) => c.includes(a) || a.includes(c));
}

/** ספר ההפקה לפרויקט: סקילים של הלקוח קודם, אחר כך כלליים לפי עדיפות — עד התקרה */
export function playbookFor(ctx: Ctx, clientName: string, areas: LessonArea[]): string {
  const want = new Set<string>(areas);
  const rows = listSkills(ctx).filter((s) => s.active && s.areas.some((a) => want.has(a)) && skillMatchesClient(s.clients, clientName));
  rows.sort((a, b) => Number(!!b.clients) - Number(!!a.clients) || b.priority - a.priority);
  const parts: string[] = [];
  let total = 0;
  for (const s of rows) {
    const text = (s.digest || s.body).trim().slice(0, s.clients ? MAX_SKILL_CHARS * 2 : MAX_SKILL_CHARS);
    if (total + text.length > MAX_TOTAL_CHARS && parts.length) continue;
    parts.push(`### ${s.name}${s.clients ? ` (client: ${s.clients})` : ''}\n${text}`);
    total += text.length;
  }
  return parts.join('\n\n');
}

export const DIGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['areas', 'clients', 'digest'],
  properties: {
    areas: { type: 'array', items: { type: 'string', enum: [...SKILL_AREAS] } },
    clients: { type: 'string', description: 'comma-separated client/brand names this skill is specific to, or empty if general' },
    digest: { type: 'string' },
  },
} as const;

export function digestPrompts(s: Skill) {
  const system = [
    'You convert a skill document (written for an AI assistant) into a production playbook for an automated AI video production system.',
    'The system writes ad/marketing video scripts, storyboards (shot lists with image and animation prompts), voice-over and music briefs, and edits short videos (mostly 9:16 reels for Israeli brands).',
    'Keep ONLY knowledge that improves those outputs: creative rules, client/product specs, brand do\'s and don\'ts, visual language, prompt recipes, camera/lighting recipes, character-consistency rules, hook/copy principles, typical mistakes to avoid, pacing and audio rules.',
    'DROP tool-operation instructions (browser clicks, JS snippets, MCP calls, file paths, download steps, folder names) and generic web-marketing material that does not affect video production.',
    'Keep every concrete fact exactly (dimensions, colors, model names, numbers, wording rules). Do not invent anything.',
    'Write in Hebrew (keep English prompt fragments in English). Use short bullet points grouped under short headings. Up to ~4000 characters; up to ~8000 when the skill is about a specific client or product.',
    'areas: which production areas the playbook informs (script, storyboard, image, motion, audio, editing, general). Use ["operations"] only if nothing in it affects the creative output.',
    'clients: comma-separated names of the client/brand/products it is specific to (all spellings that might appear as a client name), or "" if it applies to every client.',
  ].join('\n');
  const user = `SKILL NAME: ${s.name}\nDESCRIPTION: ${s.description}\n\nSKILL DOCUMENT:\n${s.body}`;
  return { system, user };
}

type JsonProvider = { json?: <T>(n: string, s: object, sys: string, user: string) => Promise<{ data: T }> };

/** זיקוק סקיל אחד (רץ ברקע). מחזיר את הסקיל המעודכן. */
export async function digestSkill(ctx: Ctx, id: string): Promise<Skill | null> {
  const s = getSkill(ctx, id);
  if (!s) return null;
  const p = [ctx.providers.text.claude, ctx.providers.text.openai].find((x) => x?.isConfigured()) as (JsonProvider & { isConfigured(): boolean }) | undefined;
  if (!p?.json) {
    ctx.db.prepare("UPDATE skills SET digest_status = 'failed', digest_error = ? WHERE id = ?").run('אין מנוע כתיבה מחובר (Claude או ChatGPT)', id);
    return getSkill(ctx, id);
  }
  ctx.db.prepare("UPDATE skills SET digest_status = 'running', digest_error = NULL WHERE id = ?").run(id);
  try {
    const { system, user } = digestPrompts(s);
    const r = await p.json<{ areas: string[]; clients: string; digest: string }>('skill_digest', DIGEST_SCHEMA, system, user);
    const areas = (r.data.areas ?? []).filter((a) => (SKILL_AREAS as readonly string[]).includes(a));
    const cur = getSkill(ctx, id);
    if (!cur || cur.body !== s.body) return cur; // השתנה בזמן הזיקוק — הסבב הבא יטפל
    ctx.db
      .prepare("UPDATE skills SET digest = ?, areas = ?, clients = ?, digest_status = 'done', digest_error = NULL, updated_at = ? WHERE id = ?")
      .run(
        String(r.data.digest ?? '').trim().slice(0, 20_000),
        JSON.stringify(s.areas.length ? s.areas : areas),
        s.clients || String(r.data.clients ?? '').trim(),
        ctx.now().toISOString(),
        id,
      );
  } catch (e) {
    ctx.db.prepare("UPDATE skills SET digest_status = 'failed', digest_error = ? WHERE id = ?").run(e instanceof Error ? e.message.slice(0, 500) : String(e), id);
  }
  return getSkill(ctx, id);
}

let running: Promise<void> | null = null;

/** מזקק ברקע את כל הסקילים שממתינים, אחד אחרי השני */
export function digestPending(ctx: Ctx): Promise<void> {
  if (running) return running;
  const loop = async () => {
    // await ראשון לפני כל עבודה — כדי שהאיפוס של running לא יקרה לפני ההשמה (כשאין מה לזקק)
    await Promise.resolve();
    for (;;) {
      const r = ctx.db.prepare("SELECT id FROM skills WHERE digest_status = 'pending' ORDER BY priority DESC LIMIT 1").get() as { id: string } | undefined;
      if (!r) break;
      await digestSkill(ctx, r.id);
    }
  };
  const p: Promise<void> = loop().finally(() => {
    if (running === p) running = null;
  });
  running = p;
  return p;
}

export function redigest(ctx: Ctx, id: string) {
  if (!getSkill(ctx, id)) throw new GateError('הסקיל לא נמצא', 404);
  ctx.db.prepare("UPDATE skills SET digest_status = 'pending', digest_error = NULL WHERE id = ?").run(id);
  void digestPending(ctx);
}

/** סקילים שנתקעו באמצע זיקוק (השרת הופעל מחדש) חוזרים לתור */
export function resumeDigests(ctx: Ctx) {
  ctx.db.prepare("UPDATE skills SET digest_status = 'pending' WHERE digest_status = 'running'").run();
  void digestPending(ctx);
}
