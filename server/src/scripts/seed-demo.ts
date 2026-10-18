/**
 * יוצר פרויקט הדגמה מסומן בבירור ("[DEMO]") עם ספק demo — ללא קריאות AI וללא עלות.
 * נועד להכרת המערכת בלבד; לא משפיע על פרויקטים אמיתיים.
 *   npm run seed:demo
 */
import path from 'node:path';
import { loadConfig } from '../config.js';
import type { Ctx } from '../context.js';
import { openDb } from '../db/db.js';
import { drain } from '../jobs/worker.js';
import { createProviders } from '../providers/registry.js';
import * as cmd from '../workflow/commands.js';

const config = loadConfig();
const ctx: Ctx = {
  db: openDb(path.join(config.dataDir, 'production.db')),
  config,
  providers: createProviders(config),
  now: () => new Date(),
};

const p = cmd.createProject(ctx, {
  name: '[DEMO] פרויקט הדגמה',
  clientName: 'לקוח הדגמה',
  settings: { textProvider: 'demo' },
});
cmd.updateBrief(ctx, p.id, {
  videoType: 'פרסומת לרשתות',
  goal: 'הגדלת הרשמות לאפליקציה',
  productOrService: 'אפליקציית כושר ביתית',
  targetAudience: 'נשים וגברים 25–40, עובדים, מעט זמן פנוי',
  targetMarket: 'ישראל',
  keyMessage: '10 דקות ביום מספיקות',
  platforms: ['Instagram Reels', 'TikTok'],
  aspectRatio: '9:16',
  durationSec: 20,
  visualStyle: 'ריאליסטי, אור טבעי, בית מודרני',
  language: 'עברית',
  tone: 'אנרגטי וחם',
  dueDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
});
cmd.completeBrief(ctx, p.id);
await drain(ctx);
console.log(`נוצר פרויקט הדגמה: ${p.id}\nהתסריט (DEMO) ממתין לאישור במסך הפרויקט.`);
ctx.db.close();
