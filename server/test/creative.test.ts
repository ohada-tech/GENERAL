/**
 * Regression לתהליך הקריאייטיבי: מקרה הכשל ("קבע לי תור" v5.2, סינתטי), שלושה בריפים מסוגים שונים,
 * שער ה-QA, חזרה לשלב הנכון, עצירה ובקשת החלטה, ו"כתוב מחדש" שלא נוגע בגרסה שאושרה.
 * ChatGPT ו-Claude מזויפים — בודקים את המנגנון, לא את הטעם של המודל (את זה בודקים בהרצה חיה).
 */
import { QA_RUBRIC, type QaCriterion } from '@apos/shared';
import { describe, expect, it } from 'vitest';
import { getProject, listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { gate, runCreativePipeline } from '../src/services/creative.js';
import { scriptChecks } from '../src/services/creative-checks.js';
import * as cmd from '../src/workflow/commands.js';
import { BRIEFS, FEATURE_TOUR_FAIL, TIGHT_SCRIPT } from './fixtures/creative-cases.js';
import { makeCtx } from './helpers.js';

type Call = { name: string; system: string; user: string };
const CRIT = ['originality', 'relevance', 'stopScroll', 'persuasion', 'differentiation', 'feasibility'];

const qaPass = () => ({
  scores: Object.fromEntries((Object.keys(QA_RUBRIC) as QaCriterion[]).map((k) => [k, { score: Math.ceil(QA_RUBRIC[k].max * 0.9), evidence: 'ציטוט מהתסריט' }])),
  detectors: {},
  critical: [],
  unsupportedClaims: [],
  failStage: 'none',
  fixes: [],
});
const qaFail = (failStage: string, extra: Record<string, unknown> = {}) => ({
  ...qaPass(),
  scores: { ...qaPass().scores, idea: { score: 9, evidence: 'רעיון גנרי: "שלוש שיחות שלא נענו"' } },
  detectors: { swappableHook: { found: true, evidence: 'ההוק מתאים לכל מערכת תורים' } },
  failStage,
  fixes: ['לפתוח ברגע שרק המוצר הזה יכול לפתוח בו'],
  ...extra,
});

/** ChatGPT מזויף: מתעד כל קריאה; ציוני כיוונים ו-QA לפי תור */
function fakeGpt(script: { qa?: unknown[]; selection?: number[][] } = {}) {
  const calls: Call[] = [];
  let conceptRound = 0;
  const gpt = {
    id: 'openai',
    label: 'ChatGPT',
    isDemo: false,
    calls,
    isConfigured: () => true,
    generateScript: async () => {
      throw new Error('לא אמור להיקרא — הכתיבה עוברת בתהליך');
    },
    reviseScript: async () => {
      throw new Error('לא אמור להיקרא');
    },
    generateStoryboard: async () => {
      throw new Error('לא אמור להיקרא');
    },
    async text(system: string, user: string) {
      calls.push({ name: 'text', system, user });
      return { text: 'כותרת: המספריים לא עוצרים\nהרעיון: ...\nסצנה 1\nקריינות: ...', model: 'gpt-fake' };
    },
    async json<T>(name: string, _schema: object, system: string, user: string) {
      calls.push({ name, system, user });
      const r = (data: unknown) => ({ data: data as T, model: 'gpt-fake' });
      switch (name) {
        case 'product_intel':
          return r({ audience: 'בעלי עסקים', problem: 'p', desire: 'd', whatItDoes: 'w', advantage: 'a', proofs: [], offer: 'o', action: 'x', limits: '', facts: ['עובדה'], assumptions: ['הנחה'], openQuestions: ['שאלה'] });
        case 'concepts': {
          conceptRound++;
          const c = (t: string) => ({ title: `${t}${conceptRound}`, idea: `רעיון ${t}${conceptRound}`, insight: 'i', hook: 'h', tension: 't', productRole: 'p', promise: 'pr', standout: 's' });
          return r({ concepts: [c('A'), c('B'), c('C')] });
        }
        case 'concept_selection': {
          const sc = script.selection?.shift() ?? [6, 8, 7];
          return r({ evaluations: sc.map((v, index) => ({ index, scores: Object.fromEntries(CRIT.map((k) => [k, v])), verdict: 'נימוק' })) });
        }
        case 'script':
          return r(structuredClone(TIGHT_SCRIPT));
        case 'script_qa':
          return r(script.qa?.shift() ?? qaPass());
        default:
          throw new Error(`קריאה לא צפויה: ${name}`);
      }
    },
  };
  return gpt;
}

/** Claude מזויף: מנסה לשנות גם קריינות — חייב להיזרק; רק הוויזואל נשאר */
function fakeClaude() {
  return {
    id: 'claude',
    label: 'Claude',
    isDemo: false,
    reviews: 0,
    isConfigured: () => true,
    async json<T>(_n: string, _s: object, _sys: string, user: string) {
      this.reviews++;
      const draft = JSON.parse(user.split('DRAFT SCRIPT (JSON):\n')[1].split('\n\nReturn')[0]);
      const scenes = draft.scenes.map((s: any) => ({ ...s, narration: 'Claude שכתב', visualAction: `${s.visualAction} [ויזואל]` }));
      return { data: { reviewNotes: ['ויזואל'], script: { ...draft, scenes } } as T, model: 'claude-fake' };
    },
  };
}

function setup(kind: keyof typeof BRIEFS = 'booking', gptScript: Parameters<typeof fakeGpt>[0] = {}) {
  const ctx = makeCtx();
  const gpt = fakeGpt(gptScript);
  (ctx.providers.text as any).openai = gpt;
  const b = BRIEFS[kind];
  const p = cmd.createProject(ctx, { name: b.name, clientName: b.client });
  cmd.updateBrief(ctx, p.id, b.brief as never);
  return { ctx, gpt, p };
}
const creativeCalls = (gpt: ReturnType<typeof fakeGpt>) => gpt.calls.filter((c) => c.name === 'text');

describe('בדיקות קוד: מזהות את מקרה הכשל לפני כל שכתוב', () => {
  it('v5.2 (סינתטי): קריינות ארוכה מהסרטון, פנייה חוזרת, ביטוי ברושור ורשימות שוטים בתסריט', () => {
    const r = scriptChecks(FEATURE_TOUR_FAIL, { ...BRIEFS.booking.brief, voiceoverNeeded: true });
    expect(r.budget).toBe(89);
    expect(r.words).toBeGreaterThan(98);
    expect(r.critical.join()).toContain('קריינות ארוכה מדי');
    const issues = r.issues.join('\n');
    expect(issues).toContain('פנייה חוזרת');
    expect(issues).toContain('ויש עוד משהו');
    expect(issues).toContain('רשימת שוטים');
  });

  it('תסריט הדוק עם רעיון אחד עובר את בדיקות הקוד (הבדיקות לא פוסלות הכל)', () => {
    const r = scriptChecks(TIGHT_SCRIPT, { ...BRIEFS.booking.brief, voiceoverNeeded: true });
    expect(r.critical).toEqual([]);
    expect(r.issues).toEqual([]);
  });
});

describe('שער ה-QA מחושב בקוד, לא לפי תחושת השופט', () => {
  const none = { critical: [], issues: [] };
  it('מבנה תקין וציון גבוה לא מספיקים כשיש כשל קריטי שנמדד', () => {
    const q = gate(qaPass(), { critical: ['קריינות ארוכה מדי'], issues: [] }, 'j');
    expect(q.total).toBeGreaterThanOrEqual(85);
    expect(q.passed).toBe(false);
  });
  it('ציון בלי ראיה מהתסריט לא נספר', () => {
    const d = qaPass();
    d.scores.idea = { score: 25, evidence: '' };
    const q = gate(d, none, 'j');
    expect(q.scores.idea.score).toBe(0);
    expect(q.passed).toBe(false);
  });
  it('85+ אבל קריטריון אחד מתחת ל-70% — נכשל', () => {
    const d = qaPass();
    d.scores.hook = { score: 10, evidence: 'הוק חלש' }; // 10/15 < 70%
    d.scores.idea = { score: 25, evidence: 'x' };
    const q = gate(d, none, 'j');
    expect(q.total).toBeGreaterThanOrEqual(85);
    expect(q.passed).toBe(false);
  });
  it('טענה לא מבוססת מכשילה ומחזירה להבנת המוצר', () => {
    const q = gate({ ...qaPass(), unsupportedClaims: ['"120 עסקים כבר עברו"'], failStage: 'writing' }, none, 'j');
    expect(q.passed).toBe(false);
    expect(q.failStage).toBe('product');
  });
});

describe('התהליך: הבנת מוצר → כיוונים → בחירה → כתיבה → QA', () => {
  for (const kind of Object.keys(BRIEFS) as Array<keyof typeof BRIEFS>) {
    it(`${kind}: לא כותב לפני שיש כיוון, בוחר לפי ציונים, ומחשב תקציב מילים לפי הבריף`, async () => {
      const { ctx, gpt, p } = setup(kind);
      const r = await runCreativePipeline(ctx, p.id);
      const order = gpt.calls.map((c) => c.name);
      expect(order.slice(0, 4)).toEqual(['product_intel', 'concepts', 'concept_selection', 'text']);
      // הכיוון שנבחר הוא בעל הציון הגבוה (B: 8), לא הראשון ברשימה
      const brief = getProject(ctx.db, p.id)!.brief;
      expect(brief.concept.startsWith('B1')).toBe(true);
      expect(brief.intel?.facts).toEqual(['עובדה']);
      const [creative] = creativeCalls(gpt);
      expect(creative.system).toContain(`at most ${BRIEFS[kind].budget} spoken words`);
      expect(creative.system).toContain('PRIORITY OF INSTRUCTIONS');
      expect(creative.user).toContain('CHOSEN CREATIVE DIRECTION');
      expect(creative.user).toContain('PRODUCT INTELLIGENCE');
      // הכיוונים חייבים להיות שונים מהותית ולהימנע מפתרונות אוטומטיים
      const concepts = gpt.calls.find((c) => c.name === 'concepts')!;
      expect(concepts.system).toContain('Three wordings of the same situation is a failure');
      expect(concepts.system).toContain('montage of professionals');
      // השיפוט בקריאה נפרדת ועם בדיקות הקוד
      expect(gpt.calls.find((c) => c.name === 'script_qa')!.user).toContain('CODE CHECKS');
      expect(r.qa.passed).toBe(true);
      expect(r.qa.rounds).toBe(1);
    });
  }

  it('האפיון הישן כפה "מבנה מחייב" — עכשיו הוא רשימת דברים שחייבים להיות ברורים, לא המבנה', async () => {
    const { ctx, gpt, p } = setup('booking');
    await runCreativePipeline(ctx, p.id);
    const [creative] = creativeCalls(gpt);
    expect(creative.user).toContain('מבנה מחייב');
    expect(creative.system).toContain('treat it as a list of things the viewer must understand by the end — NOT as the structure');
  });

  it('אף כיוון לא עובר את הרף → כיוונים חדשים, בלי לחזור על הנדחים', async () => {
    const { ctx, gpt, p } = setup('booking', { selection: [[5, 5, 6], [8, 6, 6]] });
    await runCreativePipeline(ctx, p.id);
    const conceptCalls = gpt.calls.filter((c) => c.name === 'concepts');
    expect(conceptCalls).toHaveLength(2);
    expect(conceptCalls[1].user).toContain('DIRECTIONS ALREADY REJECTED');
    expect(conceptCalls[1].user).toContain('A1');
    expect(getProject(ctx.db, p.id)!.brief.concept.startsWith('A2')).toBe(true);
  });

  it('QA: "בחירת הכיוון" → עוברים לכיוון הבא בתור, והראשון מסומן כנפסל', async () => {
    const { ctx, p } = setup('booking', { qa: [qaFail('selection'), qaPass()] });
    const r = await runCreativePipeline(ctx, p.id);
    const brief = getProject(ctx.db, p.id)!.brief;
    expect(brief.concept.startsWith('C1')).toBe(true);
    expect(brief.conceptOptions.find((c) => c.title === 'B1')?.rejected).toBe(true);
    expect(r.qa.passed).toBe(true);
    expect(r.qa.rounds).toBe(2);
  });

  it('QA: "הבנת המוצר" → חוזרים לחלץ עובדות לפני שכותבים שוב', async () => {
    const { ctx, gpt, p } = setup('booking', { qa: [qaFail('writing', { unsupportedClaims: ['מספר לקוחות שלא באפיון'] }), qaPass()] });
    await runCreativePipeline(ctx, p.id);
    expect(gpt.calls.filter((c) => c.name === 'product_intel')).toHaveLength(2);
  });

  it('QA: "הכתיבה" → כתיבה חדשה עם שורש הכשל, בלי הנוסח הקודם', async () => {
    const { ctx, gpt, p } = setup('booking', { qa: [qaFail('writing'), qaPass()] });
    await runCreativePipeline(ctx, p.id);
    const second = creativeCalls(gpt)[1];
    expect(second.user).toContain('THE PREVIOUS ATTEMPT WAS REJECTED');
    expect(second.user).toContain('לפתוח ברגע שרק המוצר הזה יכול לפתוח בו');
    expect(second.user).not.toContain(TIGHT_SCRIPT.scenes[1].narration);
  });

  it('Claude נכנס רק בסוף ורק לוויזואל: הקופי של ChatGPT ננעל', async () => {
    const { ctx, p } = setup('booking');
    const claude = fakeClaude();
    const r = await runCreativePipeline(ctx, p.id, { visualBy: claude as never });
    expect(claude.reviews).toBe(1);
    expect(r.draft.data.scenes.map((s) => s.narration)).toEqual(TIGHT_SCRIPT.scenes.map((s) => s.narration));
    expect(r.draft.data.scenes.every((s) => s.visualAction.endsWith('[ויזואל]'))).toBe(true);
    expect(r.draft.data.qa?.passed).toBe(true);
  });
});

describe('אחרי 2 סבבי תיקון בלי מעבר: עוצרים ומבקשים החלטה', () => {
  it('הגרסה נשמרת כטיוטה עם דוח שלא עבר, ונכנסת ל"מחכה לך" — לא מוצגת כאילו אושרה', async () => {
    const { ctx, gpt, p } = setup('booking', { qa: [qaFail('writing'), qaFail('writing'), qaFail('writing'), qaFail('writing')] });
    cmd.updateBrief(ctx, p.id, { cta: 'הצטרפו' });
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    expect(gpt.calls.filter((c) => c.name === 'script_qa')).toHaveLength(3);
    const [v] = listScripts(ctx.db, p.id);
    expect(v.status).toBe('draft');
    expect(v.content.qa?.passed).toBe(false);
    expect(v.content.qa?.needsOwner).toBe(true);
    expect(v.changeNote).toContain('לא עבר');
    const urgent = ctx.db.prepare("SELECT * FROM notifications WHERE dedupe_key LIKE 'attention:%'").all() as any[];
    expect(urgent).toHaveLength(1);
    expect(urgent[0].body).toContain('לא עבר QA');
  });
});

describe('בדיקת QA לגרסה קיימת', () => {
  it('שופט בלבד: מחזיר דוח עם בדיקות הקוד, ולא משנה את הגרסה', async () => {
    const { ctx, gpt, p } = setup('booking', { qa: [qaPass(), qaFail('concept')] });
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const [v] = listScripts(ctx.db, p.id);
    // מחליפים את התוכן במקרה הכשל, כמו גרסה ישנה שנכתבה לפני השער
    ctx.db.prepare('UPDATE script_versions SET content = ? WHERE id = ?').run(JSON.stringify({ ...FEATURE_TOUR_FAIL, scenes: FEATURE_TOUR_FAIL.scenes.map((s, i) => ({ id: `s${i}`, ...s })) }), v.id);
    const before = JSON.stringify(listScripts(ctx.db, p.id)[0].content);
    const { buildApp } = await import('../src/app.js');
    const app = await buildApp(ctx);
    const r = (await app.inject({ method: 'POST', url: `/api/scripts/${v.id}/qa` })).json();
    expect(JSON.stringify(listScripts(ctx.db, p.id)[0].content)).toBe(before);
    expect(r.passed).toBe(false);
    expect(r.failStage).toBe('concept');
    expect(r.codeChecks.join()).toContain('קריינות ארוכה מדי');
    expect(gpt.calls.at(-1)!.user).toContain('קריינות ארוכה מדי');
  });
});

describe('"כתוב מחדש" מול גרסה שאושרה', () => {
  it('נוצרת גרסה חדשה מהעובדות והכיוון; הגרסה המאושרת והקריינות שלה לא משתנות', async () => {
    const { ctx, gpt, p } = setup('booking');
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const [v1] = listScripts(ctx.db, p.id);
    cmd.approveScriptInternal(ctx, v1.id);
    const before = JSON.stringify(listScripts(ctx.db, p.id).find((v) => v.id === v1.id)!.content);
    cmd.requestScriptRewrite(ctx, v1.id, 'ההוק גנרי, אין רעיון');
    await drain(ctx);
    const all = listScripts(ctx.db, p.id);
    const v2 = all.find((v) => v.parentId === v1.id)!;
    expect(v2).toBeTruthy();
    expect(v2.changeNote).toContain('כתיבה מחדש');
    expect(v2.content.qa?.passed).toBe(true);
    const after = all.find((v) => v.id === v1.id)!;
    expect(after.status).toBe('internal_approved');
    expect(JSON.stringify(after.content)).toBe(before);
    const last = creativeCalls(gpt).at(-1)!;
    expect(last.user).toContain('ההוק גנרי, אין רעיון');
    expect(last.user).toContain('THE PREVIOUS ATTEMPT WAS REJECTED');
  });
});

describe('סטורי בורד: Claude בלבד', () => {
  it('ChatGPT לא נקרא בכלל; כש-Claude לא מחובר — חסימה עם הסבר, לא מעבר שקט ל-ChatGPT', async () => {
    const { listJobs, listStoryboards } = await import('../src/db/repo.js');
    const { projectWithBrief } = await import('./helpers.js');
    const run = async (claudeOn: boolean) => {
      const ctx = makeCtx();
      const p = projectWithBrief(ctx);
      cmd.completeBrief(ctx, p.id);
      await drain(ctx);
      const [v] = listScripts(ctx.db, p.id);
      // מכאן: ChatGPT שזורק אם נוגעים בו, ו-Claude מזויף (או מנותק)
      const gpt = { ...ctx.fake, id: 'openai', isConfigured: () => true, generateStoryboard: async () => { throw new Error('ChatGPT נקרא לסטורי בורד'); } };
      (ctx.providers.text as any).openai = gpt;
      (ctx.providers.text as any).collab = gpt;
      if (!claudeOn) (ctx.providers.text as any).claude = { ...ctx.fake, isConfigured: () => false };
      cmd.approveScriptInternal(ctx, v.id, 'ok');
      cmd.recordClientApproval(ctx, v.id, { approvedBy: 'לקוח' });
      await drain(ctx);
      return { sb: listStoryboards(ctx.db, p.id), job: listJobs(ctx.db, p.id).find((j) => j.type === 'storyboard.generate')! };
    };
    const on = await run(true);
    expect(on.sb).toHaveLength(1);
    expect(on.sb[0].provider).toBe('fake');
    const off = await run(false);
    expect(off.sb).toHaveLength(0);
    expect(off.job.lastError).toContain('Claude בלבד');
  });
});
