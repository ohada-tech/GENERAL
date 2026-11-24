/**
 * הלוגו של הלקוח — לכרטיס בדשבורד ולראש עמוד הפרויקט.
 * סדר: לוגו שהועלה לפרויקט ← לוגו של אותו לקוח בפרויקט אחר ← (ריק: התמונה מהסרטון).
 * אם אין לוגו ויש אתר (או קישור ללוגו באפיון) — השרת מנסה פעם אחת להביא אותו מהאתר, בלי AI ובלי עלות.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../context.js';
import { now, uid } from '../db/db.js';
import { getProject } from '../db/repo.js';
import { safeUrl } from './auto-brief.js';

const MAX_BYTES = 3_000_000;
const UA = { 'user-agent': 'Mozilla/5.0 AI-Production-AP logo reader' };

const norm = (s: string) => s.replace(/\(.*?\)/g, '').trim().toLowerCase();

/** מזהה הקובץ של הלוגו לפרויקט (או לאותו לקוח), או null */
export function projectLogo(ctx: Ctx, projectId: string, clientName = ''): string | null {
  const own = ctx.db
    .prepare(`SELECT id FROM assets WHERE project_id = ? AND kind = 'logo' ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(projectId) as { id: string } | undefined;
  if (own) return own.id;
  const client = norm(clientName);
  if (!client) return null;
  const rows = ctx.db
    .prepare(`SELECT a.id, p.client_name AS c FROM assets a JOIN projects p ON p.id = a.project_id WHERE a.kind = 'logo' ORDER BY a.created_at DESC, a.rowid DESC`)
    .all() as Array<{ id: string; c: string }>;
  return rows.find((r) => norm(r.c) === client)?.id ?? null;
}

/** ניסיונות שכבר נעשו בתהליך הזה (פרויקט + אתר) — כדי לא לחזור על אתר שאין בו לוגו */
const tried = new Set<string>();

function sourceOf(ctx: Ctx, projectId: string) {
  const p = getProject(ctx.db, projectId);
  if (!p) return null;
  const logoUrl = /^https?:\/\//i.test(p.brief.brandLogo.trim()) ? p.brief.brandLogo.trim() : '';
  const site = p.brief.website.trim();
  if (!logoUrl && !site) return null;
  return { p, key: `${projectId}|${logoUrl}|${site}`, logoUrl, site };
}

/** האם כדאי לנסות להביא לוגו אוטומטית (אין לוגו, יש מקור, ועוד לא ניסינו) */
export function canAutoLogo(ctx: Ctx, projectId: string, clientName: string) {
  if (projectLogo(ctx, projectId, clientName)) return false;
  const s = sourceOf(ctx, projectId);
  return !!s && !tried.has(s.key);
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] ?? '';
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x2F;|&#47;/gi, '/').trim();

/** מועמדים ללוגו מתוך ה-HTML של האתר, מהטוב לפחות טוב */
export function logoCandidates(html: string, base: string): string[] {
  const out: string[] = [];
  const add = (u: string) => {
    if (!u || u.startsWith('data:')) return;
    try {
      const abs = new URL(decode(u), base).toString();
      if (!out.includes(abs)) out.push(abs);
    } catch {
      /* כתובת לא תקינה */
    }
  };
  // 1. JSON-LD של הארגון: "logo": "..." או "logo": {"url": "..."}
  for (const m of html.matchAll(/"logo"\s*:\s*(?:"([^"]+)"|\{[^}]*?"url"\s*:\s*"([^"]+)")/gi)) add((m[1] || m[2] || '').replace(/\\\//g, '/'));
  // 2. תמונה שמסומנת כלוגו (class / id / alt / src), עדיפות לראש העמוד
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-lazy-src');
    if (/logo/i.test(`${attr(tag, 'class')} ${attr(tag, 'id')} ${attr(tag, 'alt')} ${src}`)) add(src);
  }
  // 3. אייקונים של האתר — הגדול קודם
  const icons: Array<{ href: string; size: number }> = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = attr(tag, 'rel').toLowerCase();
    if (!/apple-touch-icon|(^|\s)icon/.test(rel)) continue;
    const size = Number(attr(tag, 'sizes').split('x')[0]) || (rel.includes('apple') ? 180 : /\.svg/i.test(attr(tag, 'href')) ? 512 : 32);
    icons.push({ href: attr(tag, 'href'), size });
  }
  icons.sort((a, b) => b.size - a.size).filter((i) => i.size >= 64).forEach((i) => add(i.href));
  return out.slice(0, 8);
}

async function download(url: string, fetcher: typeof fetch) {
  const u = safeUrl(url);
  if (!u) return null;
  try {
    const res = await fetcher(u.toString(), { redirect: 'follow', signal: AbortSignal.timeout(12_000), headers: UA });
    const mime = String(res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!res.ok || !mime.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100 || buf.length > MAX_BYTES) return null;
    return { buf, mime, name: path.basename(u.pathname) || 'logo' };
  } catch {
    return null;
  }
}

/** שמירת לוגו כקובץ של הפרויקט (kind=logo) */
export function saveLogo(ctx: Ctx, projectId: string, file: { buf: Buffer; mime: string; name: string }) {
  const id = uid();
  const dir = path.join(ctx.config.dataDir, 'uploads', projectId);
  fs.mkdirSync(dir, { recursive: true });
  const safe = file.name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-80) || 'logo';
  const stored = path.join(dir, `${id}-${safe}`);
  fs.writeFileSync(stored, file.buf);
  ctx.db
    .prepare('INSERT INTO assets (id, project_id, filename, stored_path, mime, size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, file.name, stored, file.mime, file.buf.length, 'logo', now());
  return id;
}

/** ניסיון אחד להביא את הלוגו: קישור ללוגו מהאפיון, ואז האתר של הלקוח */
export async function autoLogo(ctx: Ctx, projectId: string, opts: { force?: boolean; fetcher?: typeof fetch } = {}): Promise<string | null> {
  const fetcher = opts.fetcher ?? fetch;
  const s = sourceOf(ctx, projectId);
  if (!s) return null;
  const existing = projectLogo(ctx, projectId, s.p.clientName);
  if (existing || (tried.has(s.key) && !opts.force)) return existing;
  tried.add(s.key);
  const candidates: string[] = [];
  if (s.logoUrl) candidates.push(s.logoUrl);
  const site = s.site ? safeUrl(s.site) : null;
  if (site) {
    try {
      const res = await fetcher(site.toString(), { redirect: 'follow', signal: AbortSignal.timeout(15_000), headers: UA });
      if (res.ok && String(res.headers.get('content-type') ?? '').includes('html')) {
        const html = (await res.text()).slice(0, 1_500_000);
        candidates.push(...logoCandidates(html, res.url || site.toString()));
      }
    } catch {
      /* האתר לא זמין — נשארים עם התמונה מהסרטון */
    }
  }
  for (const c of candidates) {
    const f = await download(c, fetcher);
    if (f) return saveLogo(ctx, projectId, f);
  }
  return null;
}
