/** נתיבים שבענן מתנהגים אחרת: בריאות/מנוע, העלאת קבצים לנכסי ה-Artifact, והגדרות OpenAI. */
import { registerRoutes } from '../../../server/src/api/routes';
import { GateError, NotFoundError, type Ctx } from '../../../server/src/context';
import { now, tx } from '../../../server/src/db/db';
import { getProject } from '../../../server/src/db/repo';
import { emit } from '../../../server/src/workflow/events';
import type { MiniApp } from './router';

type Assets = ClaudeCapabilityMap['assets'];

export async function registerCloudRoutes(app: MiniApp, ctx: Ctx, opts: { assets: Assets | null; aiAvailable: boolean }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await registerRoutes(app as any, ctx);

  const status = () => ({
    configured: opts.aiAvailable,
    source: null,
    last4: null,
    model: 'Claude',
    verified: opts.aiAvailable,
    verifiedAt: null,
    lastError: opts.aiAvailable ? null : 'Claude לא זמין בתצוגה הזו — פתח את הקישור ב-claude.ai כשאתה מחובר',
  });

  app.get('/api/health', async () => ({
    ok: true,
    engine: 'claude',
    owner: ctx.config.ownerName,
    openai: { ...status(), defaultModel: 'Claude' },
    providers: [
      { id: 'openai', label: 'Claude (claude.ai)', configured: opts.aiAvailable, demo: false },
      { id: 'demo', label: 'הדגמה', configured: true, demo: true },
    ],
  }));

  app.get('/api/settings/openai', async () => status());
  const noKeys = async () => {
    throw new GateError('בגרסת הענן אין צורך במפתח — ה-AI הוא Claude דרך חשבון claude.ai שלך', 400);
  };
  app.post('/api/settings/openai', noKeys);
  app.post('/api/settings/openai/test', async () => status());
  app.delete('/api/settings/openai', noKeys);

  app.post('/api/projects/:id/assets', async (req, reply) => {
    const { id } = req.params;
    if (!getProject(ctx.db, id)) throw new NotFoundError('פרויקט');
    if (!opts.assets) throw new GateError('העלאת קבצים זמינה רק לבעלים של המערכת ב-claude.ai', 403);
    const file = await req.file();
    if (!file) throw new GateError('לא נשלח קובץ', 400);
    const kind = String(req.query.kind ?? 'file');
    let up: { id: string; url: string; sizeBytes: number; contentType: string };
    try {
      up = await opts.assets.upload(file.blob, file.blob.type ? undefined : { type: guessType(file.filename) });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const msg =
        err.code === 'quota_or_state'
          ? 'נגמר מקום האחסון לקבצים'
          : err.code === 'too_large'
            ? 'הקובץ גדול מהמותר (עד 20MB)'
            : err.code === 'unsupported_type'
              ? 'סוג הקובץ לא נתמך (תמונה, וידאו, PDF או טקסט)'
              : `ההעלאה נכשלה: ${err.message ?? err.code ?? ''}`;
      throw new GateError(msg, 422);
    }
    tx(ctx.db, () => {
      ctx.db
        .prepare(
          'INSERT INTO assets (id, project_id, filename, stored_path, mime, size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(up.id, id, file.filename, up.url, up.contentType || file.mimetype, up.sizeBytes, kind, now());
      emit(ctx, {
        projectId: id,
        type: 'asset.uploaded',
        actor: ctx.config.ownerName,
        message: `הועלה קובץ: ${file.filename}`,
        payload: { assetId: up.id, kind },
      });
    });
    reply.code(201);
    return { id: up.id, filename: file.filename, mime: up.contentType || file.mimetype, size: up.sizeBytes, kind };
  });
}

const EXT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
  csv: 'text/csv', json: 'application/json',
};
const guessType = (name: string) => EXT_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
