/**
 * PHOTOEDIT — שמירת מסמכי עריכה בענן של המערכת.
 * המסמך (שכבות, טקסטים, מסכות, פונטים) נשמר כקובץ JSON על הדיסק הקבוע, עם תמונה ממוזערת לרשימה.
 * תוצאה סופית חוזרת לפרויקט דרך נתיב הנכסים הקיים (POST /api/projects/:id/assets?kind=photoedit).
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { now, uid } from '../db/db.js';
import { registerPhotoeditAiRoutes } from './photoedit-ai.js';

interface DocRow {
  id: string;
  project_id: string | null;
  name: string;
  width: number;
  height: number;
  size: number;
  created_at: string;
  updated_at: string;
}

const ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

export function ensurePhotoeditTable(ctx: Ctx) {
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS photoedit_docs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photoedit_project ON photoedit_docs(project_id, updated_at);
  `);
}

const toDto = (r: DocRow) => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  width: r.width,
  height: r.height,
  size: r.size,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  thumbUrl: `/api/photoedit/docs/${r.id}/thumb?v=${encodeURIComponent(r.updated_at)}`,
});

export function registerPhotoeditRoutes(app: FastifyInstance, ctx: Ctx) {
  ensurePhotoeditTable(ctx);
  registerPhotoeditAiRoutes(app, ctx);
  const dir = path.join(ctx.config.dataDir, 'photoedit');
  const docPath = (id: string) => path.join(dir, `${id}.json`);
  const thumbPath = (id: string) => path.join(dir, `${id}.png`);
  const row = (id: string) => ctx.db.prepare('SELECT * FROM photoedit_docs WHERE id = ?').get(id) as DocRow | undefined;

  /** רשימת מסמכים: של פרויקט אחד (?projectId=) או הכול */
  app.get('/api/photoedit/docs', async (req) => {
    const pid = (req.query as { projectId?: string }).projectId;
    const rows = (
      pid
        ? ctx.db.prepare('SELECT * FROM photoedit_docs WHERE project_id = ? ORDER BY updated_at DESC').all(pid)
        : ctx.db.prepare('SELECT * FROM photoedit_docs ORDER BY updated_at DESC LIMIT 200').all()
    ) as unknown as DocRow[];
    return { docs: rows.map(toDto) };
  });

  app.get('/api/photoedit/docs/:did', async (req, reply) => {
    const { did } = req.params as { did: string };
    const r = row(did);
    if (!r || !fs.existsSync(docPath(did))) throw new NotFoundError('מסמך');
    reply.header('content-type', 'application/json; charset=utf-8').header('cache-control', 'no-store');
    return reply.send(fs.createReadStream(docPath(did)));
  });

  app.get('/api/photoedit/docs/:did/thumb', async (req, reply) => {
    const { did } = req.params as { did: string };
    if (!ID_RE.test(did) || !fs.existsSync(thumbPath(did))) throw new NotFoundError('תמונה');
    reply.header('content-type', 'image/png').header('cache-control', 'private, max-age=31536000');
    return reply.send(fs.createReadStream(thumbPath(did)));
  });

  /**
   * שמירה (חדש או עדכון). multipart: שדות id?, name, projectId?, width, height, ואז הקבצים doc (JSON) ו-thumb (PNG).
   * מחזיר את רשומת המסמך.
   */
  app.post('/api/photoedit/docs', async (req, reply) => {
    const fields: Record<string, string> = {};
    let docBuf: Buffer | null = null;
    let thumbBuf: Buffer | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        if (part.fieldname === 'doc') docBuf = buf;
        else if (part.fieldname === 'thumb') thumbBuf = buf;
      } else fields[part.fieldname] = String(part.value ?? '');
    }
    if (!docBuf) throw new GateError('לא נשלח מסמך', 400);
    let parsed: { format?: string };
    try {
      parsed = JSON.parse(docBuf.toString('utf8'));
    } catch {
      throw new GateError('קובץ המסמך פגום', 400);
    }
    if (parsed.format !== 'photoedit') throw new GateError('זה לא קובץ PHOTOEDIT', 400);
    const id = fields.id && ID_RE.test(fields.id) ? fields.id : uid();
    const name = (fields.name || 'ללא שם').slice(0, 200);
    const width = Math.max(1, Math.round(Number(fields.width) || 0));
    const height = Math.max(1, Math.round(Number(fields.height) || 0));
    const projectId = fields.projectId || null;
    if (projectId && !ctx.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw new NotFoundError('פרויקט');
    fs.mkdirSync(dir, { recursive: true });
    // כתיבה אטומית: קובץ זמני ואז החלפה, כדי שנפילה באמצע לא תשאיר מסמך חצוי
    const tmp = `${docPath(id)}.tmp`;
    fs.writeFileSync(tmp, docBuf);
    fs.renameSync(tmp, docPath(id));
    if (thumbBuf) fs.writeFileSync(thumbPath(id), thumbBuf);
    const t = now();
    const existing = row(id);
    if (existing) {
      ctx.db
        .prepare('UPDATE photoedit_docs SET name = ?, width = ?, height = ?, size = ?, project_id = COALESCE(?, project_id), updated_at = ? WHERE id = ?')
        .run(name, width, height, docBuf.length, projectId, t, id);
    } else {
      ctx.db
        .prepare('INSERT INTO photoedit_docs (id, project_id, name, width, height, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, projectId, name, width, height, docBuf.length, t, t);
      reply.code(201);
    }
    return toDto(row(id)!);
  });

  app.patch('/api/photoedit/docs/:did', async (req) => {
    const { did } = req.params as { did: string };
    const r = row(did);
    if (!r) throw new NotFoundError('מסמך');
    const b = (req.body ?? {}) as { name?: string; projectId?: string | null };
    if (typeof b.name === 'string' && b.name.trim()) ctx.db.prepare('UPDATE photoedit_docs SET name = ? WHERE id = ?').run(b.name.trim().slice(0, 200), did);
    if (b.projectId !== undefined) ctx.db.prepare('UPDATE photoedit_docs SET project_id = ? WHERE id = ?').run(b.projectId || null, did);
    return toDto(row(did)!);
  });

  app.delete('/api/photoedit/docs/:did', async (req) => {
    const { did } = req.params as { did: string };
    if (!row(did)) throw new NotFoundError('מסמך');
    ctx.db.prepare('DELETE FROM photoedit_docs WHERE id = ?').run(did);
    fs.rmSync(docPath(did), { force: true });
    fs.rmSync(thumbPath(did), { force: true });
    return { ok: true };
  });

  /** כל התמונות של פרויקט: קבצים שהועלו ותוצרי הפקה — כדי לשלוף אותן לעורך */
  app.get('/api/photoedit/sources/:pid', async (req) => {
    const { pid } = req.params as { pid: string };
    const p = ctx.db.prepare('SELECT id, name FROM projects WHERE id = ?').get(pid) as { id: string; name: string } | undefined;
    if (!p) throw new NotFoundError('פרויקט');
    const assets = ctx.db
      .prepare("SELECT id, filename, kind, created_at FROM assets WHERE project_id = ? AND mime LIKE 'image/%' ORDER BY created_at DESC LIMIT 400")
      .all(pid) as Array<{ id: string; filename: string; kind: string; created_at: string }>;
    const media = ctx.db
      .prepare(
        `SELECT m.id, m.kind, m.version, m.status, s.number AS shot, m.created_at FROM media m
         JOIN assets a ON a.id = m.asset_id LEFT JOIN shots s ON s.id = m.shot_id
         WHERE m.project_id = ? AND a.mime LIKE 'image/%' ORDER BY m.created_at DESC LIMIT 400`,
      )
      .all(pid) as Array<{ id: string; kind: string; version: number; status: string; shot: number | null; created_at: string }>;
    const mediaAssetIds = new Set(
      (ctx.db.prepare('SELECT asset_id FROM media WHERE project_id = ? AND asset_id IS NOT NULL').all(pid) as Array<{ asset_id: string }>).map((r) => r.asset_id),
    );
    return {
      project: p,
      images: [
        ...media.map((m) => ({
          id: `m:${m.id}`,
          label: m.shot != null ? `שוט ${m.shot} · v${m.version}` : `${m.kind} v${m.version}`,
          group: 'הפקה',
          url: `/api/media/${m.id}/file`,
          createdAt: m.created_at,
        })),
        ...assets
          .filter((a) => !mediaAssetIds.has(a.id))
          .map((a) => ({ id: `a:${a.id}`, label: a.filename, group: a.kind === 'photoedit' ? 'PHOTOEDIT' : 'קבצים', url: `/api/assets/${a.id}/file`, createdAt: a.created_at })),
      ],
    };
  });
}
