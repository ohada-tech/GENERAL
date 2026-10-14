/**
 * ייבוא פרויקטים קיימים (שהתחילו מחוץ למערכת) במצב האמיתי שלהם:
 * אפיון, תסריט וסטורי בורד נכנסים כנתונים "ידניים" — בלי להפעיל AI ובלי יצירה בתשלום.
 * פרויקט שכבר קיים באותו שם ולקוח מדולג (ייבוא חוזר לא יוצר כפילויות).
 */
import { briefSchema, projectSettingsSchema, shotFieldsSchema, type ScriptContent } from '@apos/shared';
import { z } from 'zod';
import { GateError, type Ctx } from '../context.js';
import { json, tx, uid } from '../db/db.js';
import { emit } from './events.js';

const sceneIn = z.object({
  storyRole: z.string().default('other'),
  narration: z.string().default(''),
  onScreenText: z.string().default(''),
  visualAction: z.string().default(''),
  estDurationSec: z.number().nonnegative().default(0),
  notes: z.string().default(''),
});

const projectIn = z.object({
  name: z.string().min(1),
  clientName: z.string().default(''),
  brief: z.record(z.unknown()).default({}),
  /** האפיון כבר הושלם (נכנס בלי להפעיל כתיבת תסריט אוטומטית) */
  briefCompleted: z.boolean().default(false),
  settings: z.record(z.unknown()).default({}),
  script: z
    .object({
      title: z.string().default(''),
      logline: z.string().default(''),
      scenes: z.array(sceneIn).min(1),
      status: z.enum(['draft', 'internal_approved', 'client_approved']).default('draft'),
      note: z.string().default('יובא מעבודה קודמת'),
      approvedBy: z.string().default(''),
    })
    .optional(),
  storyboard: z
    .object({
      shots: z.array(z.record(z.unknown())).min(1),
      approved: z.boolean().default(false),
      /** שוטים שכבר אושרו (מספרים, מ-1) — ברירת מחדל: כולם אם הסטורי בורד אושר */
      approvedShots: z.array(z.number().int().positive()).optional(),
    })
    .optional(),
  /** שלבי הפקה (05–09) שכבר בוצעו מחוץ למערכת — מסומנים כמאושרים */
  stagesDone: z.array(z.enum(['images', 'animation', 'audio', 'editing', 'delivery'])).default([]),
  /** הערה שתופיע בהיסטוריה (מה המצב ומה הצעד הבא) */
  statusNote: z.string().default(''),
});

export const importSchema = z.object({ projects: z.array(projectIn).min(1).max(50) });

export function importProjects(ctx: Ctx, input: unknown) {
  const { projects } = importSchema.parse(input);
  const owner = ctx.config.ownerName;
  const results: Array<{ name: string; id?: string; skipped?: string }> = [];
  for (const p of projects) {
    const existing = ctx.db
      .prepare('SELECT id FROM projects WHERE name = ? AND client_name = ?')
      .get(p.name.trim(), p.clientName.trim()) as { id: string } | undefined;
    if (existing) {
      results.push({ name: p.name, id: existing.id, skipped: 'כבר קיים' });
      continue;
    }
    if (p.storyboard && !p.script) throw new GateError(`"${p.name}": אי אפשר לייבא סטורי בורד בלי תסריט`, 400);
    const id = tx(ctx.db, () => {
      const id = uid();
      const t = ctx.now().toISOString();
      const brief = briefSchema.parse(p.brief);
      ctx.db
        .prepare(
          'INSERT INTO projects (id, name, client_name, brief, brief_completed_at, settings, pipeline_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, p.name.trim(), p.clientName.trim(), json(brief), p.briefCompleted ? t : null, json(projectSettingsSchema.parse(p.settings)), 'active', t, t);

      let scriptId: string | null = null;
      if (p.script) {
        scriptId = uid();
        const content: ScriptContent = {
          title: p.script.title,
          logline: p.script.logline,
          scenes: p.script.scenes.map((s) => ({ id: uid(), ...s })),
        };
        ctx.db
          .prepare(
            `INSERT INTO script_versions (id, project_id, version, major, minor, parent_id, source, provider, model, status, content, change_note, created_by, created_at)
             VALUES (?, ?, 1, 1, 0, NULL, 'manual', NULL, NULL, ?, ?, ?, ?, ?)`,
          )
          .run(scriptId, id, p.script.status, json(content), p.script.note, owner, t);
        if (p.script.status !== 'draft') {
          ctx.db
            .prepare('INSERT INTO approvals (id, project_id, subject_type, subject_id, kind, decision, by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(uid(), id, 'script_version', scriptId, 'internal', 'approved', owner, 'יובא', t);
        }
        if (p.script.status === 'client_approved') {
          ctx.db
            .prepare('INSERT INTO approvals (id, project_id, subject_type, subject_id, kind, decision, by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(uid(), id, 'script_version', scriptId, 'client', 'approved', p.script.approvedBy || 'הלקוח', 'יובא', t);
        }
      }

      if (p.storyboard && scriptId) {
        const sbId = uid();
        ctx.db
          .prepare(
            `INSERT INTO storyboards (id, project_id, version, script_version_id, source, provider, model, status, created_at, approved_at, approved_by)
             VALUES (?, ?, 1, ?, 'manual', NULL, NULL, ?, ?, ?, ?)`,
          )
          .run(sbId, id, scriptId, p.storyboard.approved ? 'approved' : 'draft', t, p.storyboard.approved ? t : null, p.storyboard.approved ? owner : null);
        const approvedSet = new Set(p.storyboard.approvedShots ?? (p.storyboard.approved ? p.storyboard.shots.map((_, i) => i + 1) : []));
        const ins = ctx.db.prepare('INSERT INTO shots (id, storyboard_id, project_id, number, fields, approval, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        p.storyboard.shots.forEach((s, i) => ins.run(uid(), sbId, id, i + 1, json(shotFieldsSchema.parse(s)), approvedSet.has(i + 1) ? 'approved' : 'pending', t));
      }

      const gate = ctx.db.prepare('INSERT OR REPLACE INTO stage_gates (project_id, stage, approved_at, approved_by, note) VALUES (?, ?, ?, ?, ?)');
      for (const st of p.stagesDone) gate.run(id, st, t, owner, 'בוצע מחוץ למערכת (יובא)');

      // אירוע ייבוא בלבד — לא brief.completed, כדי שלא יופעלו אוטומציות בתשלום
      emit(ctx, {
        projectId: id,
        type: 'project.imported',
        actor: owner,
        message: `פרויקט יובא${p.statusNote ? `: ${p.statusNote}` : ''}`,
        payload: { hasScript: !!p.script, hasStoryboard: !!p.storyboard },
      });
      return id;
    });
    results.push({ name: p.name, id });
  }
  return { imported: results.filter((r) => !r.skipped).length, results };
}
