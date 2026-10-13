import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { briefToText } from '../src/providers/prompts.js';
import type { ProjectContext } from '../src/providers/types.js';
import * as knowledge from '../src/services/knowledge.js';
import { firstPassStats } from '../src/services/learning.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

const GOGO_MD = `---
name: "go-and-go-video"
description: "הפקת סרטונים ל-GO&GO"
---

# GO&GO
- המסך עומד על הרצפה בלבד — לעולם לא על שולחן.
- פתח chatgpt.com בכרום ולחץ על הכפתור.`;

function ctxWithDigest() {
  const ctx = makeCtx();
  const seen: { script: ProjectContext[]; storyboard: ProjectContext[] } = { script: [], storyboard: [] };
  const fake = ctx.fake as any;
  const gen = fake.generateScript.bind(fake);
  const sb = fake.generateStoryboard.bind(fake);
  fake.generateScript = async (c: ProjectContext, ...r: any[]) => (seen.script.push(c), gen(c, ...r));
  fake.generateStoryboard = async (c: ProjectContext, ...r: any[]) => (seen.storyboard.push(c), sb(c, ...r));
  fake.json = async (name: string, _s: object, _sys: string, user: string) => {
    if (name !== 'skill_digest') return { data: { lessons: [] } };
    const isGogo = user.includes('GO&GO');
    return {
      data: {
        areas: isGogo ? ['script', 'storyboard', 'image'] : ['script'],
        clients: isGogo ? 'GO&GO, GOtv' : '',
        digest: isGogo ? '- GOtv עומד על הרצפה בלבד, לעולם לא על שולחן' : '- הוק בשתי השניות הראשונות',
      },
    };
  };
  return { ctx, seen };
}

describe('Knowledge base (Claude skills → production playbook)', () => {
  it('parses SKILL.md frontmatter', () => {
    const s = knowledge.parseSkillMd(GOGO_MD);
    expect(s.name).toBe('go-and-go-video');
    expect(s.description).toBe('הפקת סרטונים ל-GO&GO');
    expect(s.body.startsWith('# GO&GO')).toBe(true);
  });

  it('matches client aliases loosely', () => {
    expect(knowledge.skillMatchesClient('GO&GO, GOtv', 'GO&GO Retail')).toBe(true);
    expect(knowledge.skillMatchesClient('GO&GO, GOtv', 'gotv')).toBe(true);
    expect(knowledge.skillMatchesClient('GO&GO, GOtv', 'HAMBARBER')).toBe(false);
    expect(knowledge.skillMatchesClient('', 'anyone')).toBe(true);
  });

  it('digests skills with Claude and injects only the relevant ones into each prompt', async () => {
    const { ctx, seen } = ctxWithDigest();
    const app = await buildApp(ctx);
    const imp = await app.inject({
      method: 'POST',
      url: '/api/skills/import',
      payload: {
        skills: [
          { ...knowledge.parseSkillMd(GOGO_MD), priority: 90 },
          { name: 'copywriting', description: 'copy', body: 'Write hooks that land fast.', priority: 60 },
          { name: 'higgsfield-unlimited', body: 'Click the Unlimited toggle.', areas: ['operations'], digest: 'נהלי Higgsfield' },
        ],
      },
    });
    expect(imp.statusCode).toBe(200);
    await knowledge.digestPending(ctx);
    const skills = knowledge.listSkills(ctx);
    expect(skills.every((s) => s.digestStatus === 'done')).toBe(true);
    expect(skills.find((s) => s.name === 'go-and-go-video')!.clients).toBe('GO&GO, GOtv');

    // לקוח GO&GO: גם הסקיל של הלקוח וגם הכללי; נהלי ההפעלה לא נכנסים
    const p = projectWithBrief(ctx);
    ctx.db.prepare('UPDATE projects SET client_name = ? WHERE id = ?').run('GO&GO', p.id);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const text = briefToText(seen.script[0]);
    expect(text).toContain('STUDIO PLAYBOOK');
    expect(text).toContain('GOtv עומד על הרצפה');
    expect(text).toContain('הוק בשתי השניות');
    expect(text).not.toContain('Higgsfield');
    expect(text).not.toContain('chatgpt.com');

    // לקוח אחר: רק הכללי
    expect(knowledge.playbookFor(ctx, 'HAMBARBER', ['script'])).not.toContain('GOtv');
    expect(knowledge.playbookFor(ctx, 'HAMBARBER', ['script'])).toContain('הוק');
    // הסטורי בורד מקבל את מה ששייך לתמונות, לא את הקופי
    expect(knowledge.playbookFor(ctx, 'GO&GO', ['storyboard', 'image', 'motion', 'general'])).not.toContain('הוק');

    // ייבוא חוזר לא משכפל; כיבוי מוציא מהפרומפט
    await app.inject({ method: 'POST', url: '/api/skills', payload: { md: GOGO_MD } });
    expect(knowledge.listSkills(ctx)).toHaveLength(3);
    const gogo = knowledge.listSkills(ctx).find((s) => s.name === 'go-and-go-video')!;
    await app.inject({ method: 'PATCH', url: `/api/skills/${gogo.id}`, payload: { active: false } });
    expect(knowledge.playbookFor(ctx, 'GO&GO', ['script'])).not.toContain('GOtv');
    const list = (await app.inject({ url: '/api/skills' })).json();
    expect(list.skills[0].body).toBeUndefined();
    await app.close();
  });

  it('first-pass score: a script the client approved at v1 counts as first pass', async () => {
    const { ctx } = ctxWithDigest();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const v = listScripts(ctx.db, p.id)[0];
    cmd.approveScriptInternal(ctx, v.id);
    cmd.recordClientApproval(ctx, v.id, { approvedBy: 'דנה' });
    const s = firstPassStats(ctx).find((a) => a.area === 'script')!;
    expect(s).toMatchObject({ total: 1, firstPass: 1 });
    expect(s.byMonth[0].month).toBe('2026-01');
  });
});
