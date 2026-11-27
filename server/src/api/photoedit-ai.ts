/**
 * PHOTOEDIT · Generative Fill — מילוי גנרטיבי של אזור בחירה, בשני מנועים:
 *  - openai: OpenAI Images Edit עם מסכה (gpt-image), רץ מכאן ישירות, בתשלום לפי תמונה — הלחיצה עם העלות היא האישור.
 *  - higgsfield: Nano Banana Pro ב-2K בקרדיטים, דרך העובד המקומי במחשב של אוהד (~/.apos/hf-worker.cjs)
 *    שמושך ג'ובים מ-/api/photoedit/ai/next ומדווח בסוף. אין שם מסכה — האזור מסומן באדום בתמונת עזר,
 *    והעורך ממילא מרכיב חזרה רק את מה שבתוך הבחירה.
 * העורך שולח את החיתוך (image), מסכה בפורמט של OpenAI (mask: שקוף = לערוך) ותמונת עזר עם האזור באדום (hint).
 * הקבצים נשמרים ב-DATA_DIR/photoedit/ai/<id>/.
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { HF_USD_PER_CREDIT, hfImageCredits } from '@apos/shared';
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { now, uid } from '../db/db.js';

export type FillEngine = 'openai' | 'higgsfield';
type Status = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

interface JobRow {
  id: string;
  engine: FillEngine;
  prompt: string;
  status: Status;
  n: number;
  size: string;
  quality: string;
  outputs: number;
  cost: string;
  error: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const ID_RE = /^[a-zA-Z0-9-]{8,64}$/;
const OPENAI_SIZES = ['1024x1024', '1536x1024', '1024x1536'];
const HF_ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '4:5', '5:4', '21:9'];
/** מחיר משוער ל-gpt-image-1 בתמונה אחת (פלט; הקלט מוסיף מעט) — לתצוגה על הכפתור בלבד */
const OPENAI_USD: Record<string, number> = { low: 0.02, medium: 0.06, high: 0.19 };
/** ג'וב שרץ יותר מזה — נחשב תקוע */
const STUCK_MS = 25 * 60_000;
/** העובד המקומי נחשב מחובר אם משך ג'ובים בזמן הזה */
const WORKER_ONLINE_MS = 60_000;

export function fillCost(engine: FillEngine, n: number, quality = 'medium') {
  if (engine === 'openai') {
    const usd = (OPENAI_USD[quality] ?? OPENAI_USD.medium) * n;
    return { usd, label: `כ-$${usd.toFixed(2)}` };
  }
  const credits = hfImageCredits('nano-banana-pro') * n;
  const usd = credits * HF_USD_PER_CREDIT;
  return { usd, label: `${credits} קרדיטים ($${usd.toFixed(2)})` };
}

/** ההוראה למודל. פרומפט ריק = הסרה ומילוי מהסביבה (כמו בפוטושופ) */
export function fillPrompt(engine: FillEngine, prompt: string) {
  const p = prompt.trim();
  if (engine === 'openai') {
    return p
      ? `Generative fill. In the transparent (masked) area of the image, add: ${p}\nBlend it seamlessly into the surrounding photo: match the lighting direction, perspective, scale, color grading, depth of field, grain and sharpness. Keep everything outside the masked area unchanged.`
      : 'Generative fill. Remove whatever is inside the transparent (masked) area and fill it with what would naturally be behind it, continuing the surrounding background seamlessly: same lighting, perspective, texture, color, grain and sharpness. Add no new objects. Keep everything outside the masked area unchanged.';
  }
  const task = p
    ? `inside that region add: ${p}. Blend it seamlessly with the rest of the photo: same lighting direction, perspective, scale, color grading, depth of field, grain and sharpness.`
    : 'remove whatever is inside that region and fill it with what would naturally be behind it, continuing the surrounding background seamlessly (same lighting, perspective, texture, grain). Add no new objects.';
  return `Edit image 1. Image 2 is the same picture with the region to edit highlighted in semi-transparent red. Only ${task}\nThe output must be image 1 with that change only: no red tint or highlight anywhere, identical framing, composition and aspect ratio, and every pixel outside the region exactly as in image 1.`;
}

export function ensureFillTable(ctx: Ctx) {
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS photoedit_ai_jobs (
      id TEXT PRIMARY KEY,
      engine TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      n INTEGER NOT NULL DEFAULT 1,
      size TEXT NOT NULL DEFAULT '',
      quality TEXT NOT NULL DEFAULT '',
      outputs INTEGER NOT NULL DEFAULT 0,
      cost TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_photoedit_ai_status ON photoedit_ai_jobs(status, created_at);
  `);
}

type FetchFn = typeof fetch;

export function registerPhotoeditAiRoutes(app: FastifyInstance, ctx: Ctx, fetchFn: FetchFn = fetch) {
  ensureFillTable(ctx);
  const root = path.join(ctx.config.dataDir, 'photoedit', 'ai');
  const jobDir = (id: string) => path.join(root, id);
  const row = (id: string) => ctx.db.prepare('SELECT * FROM photoedit_ai_jobs WHERE id = ?').get(id) as JobRow | undefined;
  const set = (id: string, patch: Partial<JobRow>) => {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    ctx.db.prepare(`UPDATE photoedit_ai_jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => (patch as Record<string, string | number | null>)[k]), id);
  };
  let workerSeen = 0;

  const dto = (r: JobRow) => {
    // ג'וב שנתקע (העובד נפל באמצע / OpenAI לא ענה) — מסמנים כנכשל כדי שהעורך לא יחכה לנצח
    if ((r.status === 'running' || r.status === 'queued') && Date.now() - Date.parse(r.started_at || r.created_at) > (r.status === 'queued' ? 6 * 60 * 60_000 : STUCK_MS)) {
      set(r.id, { status: 'failed', error: r.status === 'queued' ? 'הג׳וב חיכה יותר מדי זמן לעובד' : 'הג׳וב לא הסתיים בזמן', finished_at: now() });
      r = row(r.id)!;
    }
    return {
      id: r.id,
      engine: r.engine,
      prompt: r.prompt,
      status: r.status,
      n: r.n,
      cost: r.cost,
      error: r.error,
      outputs: Array.from({ length: r.outputs }, (_, i) => `/api/photoedit/ai/jobs/${r.id}/out-${i}.png`),
      createdAt: r.created_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    };
  };

  app.get('/api/photoedit/ai/engines', async () => ({
    openai: {
      ready: !!ctx.config.openai.apiKey,
      model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
      note: ctx.config.openai.apiKey ? 'שניות · בתשלום לפי תמונה מחשבון ה-API' : 'אין מפתח OpenAI בשרת',
      cost: { low: fillCost('openai', 1, 'low').label, medium: fillCost('openai', 1, 'medium').label, high: fillCost('openai', 1, 'high').label },
      usd: OPENAI_USD,
    },
    higgsfield: {
      ready: Date.now() - workerSeen < WORKER_ONLINE_MS,
      model: 'Nano Banana Pro · 2K',
      note: Date.now() - workerSeen < WORKER_ONLINE_MS ? 'העובד במחשב מחובר' : 'העובד במחשב לא מחובר — הג׳וב יחכה עד שיעלה',
      cost: fillCost('higgsfield', 1).label,
      credits: hfImageCredits('nano-banana-pro'),
      usdPerCredit: HF_USD_PER_CREDIT,
    },
  }));

  /** ג'וב חדש. multipart: engine, prompt, n, size (openai) / aspect (higgsfield), quality; קבצים image, mask, hint */
  app.post('/api/photoedit/ai/fill', async (req, reply) => {
    const fields: Record<string, string> = {};
    const files: Record<string, Buffer> = {};
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (['image', 'mask', 'hint'].includes(part.fieldname)) files[part.fieldname] = await part.toBuffer();
        else await part.toBuffer();
      } else fields[part.fieldname] = String(part.value ?? '');
    }
    const engine: FillEngine = fields.engine === 'higgsfield' ? 'higgsfield' : 'openai';
    const prompt = (fields.prompt || '').slice(0, 2000);
    const n = Math.max(1, Math.min(3, Math.round(Number(fields.n) || 1)));
    const quality = ['low', 'medium', 'high'].includes(fields.quality) ? fields.quality : 'medium';
    if (!files.image) throw new GateError('לא נשלחה תמונה', 400);
    let size = '';
    if (engine === 'openai') {
      if (!ctx.config.openai.apiKey) throw new GateError('אין מפתח OpenAI בשרת — בחר היגספילד', 409);
      if (!files.mask) throw new GateError('לא נשלחה מסכה', 400);
      size = OPENAI_SIZES.includes(fields.size) ? fields.size : '1024x1024';
    } else {
      if (!files.hint) throw new GateError('לא נשלחה תמונת עזר', 400);
      size = HF_ASPECTS.includes(fields.aspect) ? fields.aspect : '1:1';
    }
    const id = uid();
    fs.mkdirSync(jobDir(id), { recursive: true });
    for (const [k, b] of Object.entries(files)) fs.writeFileSync(path.join(jobDir(id), `${k}.png`), b);
    const t = now();
    ctx.db
      .prepare('INSERT INTO photoedit_ai_jobs (id, engine, prompt, status, n, size, quality, cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, engine, prompt, 'queued', n, size, quality, fillCost(engine, n, quality).label, t);
    if (engine === 'openai') void runOpenAI(id);
    reply.code(201);
    return dto(row(id)!);
  });

  app.get('/api/photoedit/ai/jobs/:jid', async (req) => {
    const r = row((req.params as { jid: string }).jid);
    if (!r) throw new NotFoundError('ג׳וב');
    return dto(r);
  });

  app.get('/api/photoedit/ai/jobs/:jid/:file', async (req, reply) => {
    const { jid, file } = req.params as { jid: string; file: string };
    if (!ID_RE.test(jid) || !/^(image|mask|hint|out-\d)\.png$/.test(file)) throw new NotFoundError('קובץ');
    const f = path.join(jobDir(jid), file);
    if (!fs.existsSync(f)) throw new NotFoundError('קובץ');
    reply.header('content-type', 'image/png').header('cache-control', 'private, max-age=31536000');
    return reply.send(fs.createReadStream(f));
  });

  /** ביטול: רק ג'וב שעוד לא התחיל (ג'וב שרץ כבר עולה כסף — רק מתעלמים מהתוצאה) */
  app.delete('/api/photoedit/ai/jobs/:jid', async (req) => {
    const r = row((req.params as { jid: string }).jid);
    if (!r) throw new NotFoundError('ג׳וב');
    if (r.status === 'queued') set(r.id, { status: 'canceled', finished_at: now() });
    return dto(row(r.id)!);
  });

  /* ---------- העובד המקומי (היגספילד) ---------- */

  app.get('/api/photoedit/ai/next', async (_req, reply) => {
    workerSeen = Date.now();
    const r = ctx.db.prepare("SELECT * FROM photoedit_ai_jobs WHERE status = 'queued' AND engine = 'higgsfield' ORDER BY created_at, rowid LIMIT 1").get() as JobRow | undefined;
    if (!r) return reply.code(204).send();
    set(r.id, { status: 'running', started_at: now() });
    return {
      id: r.id,
      n: r.n,
      job: 'nano_banana_pro',
      prompt: fillPrompt('higgsfield', r.prompt),
      params: { aspect_ratio: r.size, resolution: '2k' },
      credits: hfImageCredits('nano-banana-pro'),
      images: [`/api/photoedit/ai/jobs/${r.id}/image.png`, `/api/photoedit/ai/jobs/${r.id}/hint.png`],
    };
  });

  /** דיווח מהעובד: urls = התוצאות (השרת מוריד אותן), או error */
  app.post('/api/photoedit/ai/jobs/:jid/report', async (req) => {
    const r = row((req.params as { jid: string }).jid);
    if (!r) throw new NotFoundError('ג׳וב');
    const b = (req.body ?? {}) as { urls?: string[]; error?: string };
    const urls = (Array.isArray(b.urls) ? b.urls : []).filter((u) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 3);
    let k = 0;
    const errs: string[] = b.error ? [String(b.error).slice(0, 300)] : [];
    for (const u of urls) {
      try {
        const res = await fetchFn(u, { headers: { 'User-Agent': 'AI-Production-AP/1.0' }, signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fs.writeFileSync(path.join(jobDir(r.id), `out-${k}.png`), Buffer.from(await res.arrayBuffer()));
        k++;
      } catch (e) {
        errs.push(`הורדת תוצאה נכשלה: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    set(r.id, { status: k > 0 ? 'done' : 'failed', outputs: k, error: errs.join(' · '), finished_at: now() });
    return dto(row(r.id)!);
  });

  /* ---------- OpenAI Images Edit ---------- */

  async function runOpenAI(id: string) {
    const r = row(id)!;
    set(id, { status: 'running', started_at: now() });
    try {
      const fd = new FormData();
      fd.append('model', process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1');
      fd.append('prompt', fillPrompt('openai', r.prompt));
      fd.append('n', String(r.n));
      fd.append('size', r.size);
      fd.append('quality', r.quality);
      fd.append('image', new Blob([fs.readFileSync(path.join(jobDir(id), 'image.png'))], { type: 'image/png' }), 'image.png');
      fd.append('mask', new Blob([fs.readFileSync(path.join(jobDir(id), 'mask.png'))], { type: 'image/png' }), 'mask.png');
      const res = await fetchFn(`${ctx.config.openai.baseUrl}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.config.openai.apiKey}` },
        body: fd,
        signal: AbortSignal.timeout(10 * 60_000),
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text.slice(0, 300);
        try {
          msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message || msg;
        } catch {}
        const quota = res.status === 429 || /quota|billing|credit/i.test(msg);
        throw new Error(quota ? `אין קרדיט בחשבון ה-API של OpenAI (${msg.slice(0, 160)})` : `OpenAI: ${msg}`);
      }
      const data = (JSON.parse(text) as { data?: Array<{ b64_json?: string }> }).data ?? [];
      let k = 0;
      for (const d of data) {
        if (!d.b64_json) continue;
        fs.writeFileSync(path.join(jobDir(id), `out-${k}.png`), Buffer.from(d.b64_json, 'base64'));
        k++;
      }
      if (!k) throw new Error('OpenAI לא החזיר תמונה');
      set(id, { status: 'done', outputs: k, finished_at: now() });
    } catch (e) {
      set(id, { status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 400), finished_at: now() });
    }
  }
}
