/**
 * "הבא" שמבצע: הכפתור בכרטיס הפרויקט מריץ את הצעד הבא בעצמו כשהוא לא עולה כסף ולא דורש בדיקה שלך —
 * כתיבת תסריט, יצירת סטורי בורד, פיילוט תמונות באנלימיטד, הפעלת Pipeline מושהה.
 * צעד שמחכה לאישור / הערה שלך (או שעולה קרדיטים) — פותח את המקום הנכון בפרויקט.
 */
import type { Ctx } from '../context.js';
import { NotFoundError } from '../context.js';
import { getProject } from '../db/repo.js';
import { externalRequests } from '../workflow/production.js';
import * as cmd from '../workflow/commands.js';
import { projectState } from './views.js';
import { requestAgentTask } from './agent-tasks.js';

export type NextResult = { done: string } | { navigate: string; label: string };

export function runNextStep(ctx: Ctx, projectId: string): NextResult {
  const p = getProject(ctx.db, projectId);
  if (!p) throw new NotFoundError('פרויקט');
  const a = projectState(ctx, p).nextAction;
  if (!a) return { navigate: 'overview', label: 'אין צעד פתוח' };
  const go = (): NextResult => ({ navigate: a.tab, label: a.label });
  if (a.kind !== 'task') return go(); // אישור / תיקון — שלך

  if (p.pipelineState === 'paused' && a.stage === 'brief') {
    cmd.setPipelineState(ctx, projectId, 'resume');
    return { done: 'ה-Pipeline הופעל מחדש' };
  }
  if (a.stage === 'script' && a.label.startsWith('צור טיוטת')) {
    cmd.requestScriptGeneration(ctx, projectId);
    return { done: 'ChatGPT מתחיל לכתוב את התסריט' };
  }
  if (a.stage === 'storyboard' && a.label.startsWith('צור סטורי בורד')) {
    cmd.requestStoryboardGeneration(ctx, projectId);
    return { done: 'Claude מתחיל לבנות את הסטורי בורד' };
  }
  // תמונות בהיגספילד באנלימיטד: פיילוט של שוט אחד (חינם). בקרדיטים — פותחים, כדי שתראה את העלות
  if (a.stage === 'images' && p.settings.generator === 'higgsfield' && p.settings.hfRoute === 'unlimited' && externalRequests(ctx, projectId).images.length) {
    requestAgentTask(ctx, projectId, { kind: 'hf_unlimited', stage: 'images', scope: 'pilot' });
    return { done: 'Claude מריץ פיילוט תמונה אחת באנלימיטד' };
  }
  return go();
}
