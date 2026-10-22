import { changedBriefFields, rebaseBrief, type Brief } from '@apos/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { GateError } from '../src/context.js';
import { getProject } from '../src/db/repo.js';
import { autofillBrief } from '../src/services/auto-brief.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx } from './helpers.js';

/** Claude שממלא לוגו, תמונות מותג ודמויות — כמו ב-The Same Day ב-22.10 */
function withAutofill(ctx: ReturnType<typeof makeCtx>) {
  (ctx.providers.text as any).claude = {
    id: 'claude',
    label: 'Claude',
    isConfigured: () => true,
    json: async () => ({
      data: {
        brief: {
          brandLogo: 'לוגו לבן על רקע כחול',
          brandImages: 'צילומי שליחים מהאתר',
          characters: [{ name: 'שליח', description: 'בן 30, מדים כחולים' }],
        },
        missing: [],
      },
      model: 'fake',
    }),
  };
}

const pick = (b: Brief, keys: Array<keyof Brief>) => Object.fromEntries(keys.map((k) => [k, b[k]])) as Partial<Brief>;

describe('Brief: a stale save from the form does not erase autofill', () => {
  it('saving only the edited fields keeps what autofill wrote meanwhile (and its ✨ marks)', async () => {
    const ctx = makeCtx();
    withAutofill(ctx);
    const p = cmd.createProject(ctx, { name: 'The Same Day', clientName: 'The Same Day' });
    const formBase = getProject(ctx.db, p.id)!.brief; // הטופס נטען
    await autofillBrief(ctx, p.id, { text: 'סיכום שיחה' }); // Claude ממלא באמצע

    const draft = { ...formBase, goal: 'להגדיל הזמנות' }; // אוהד הקליד מטרה ושמר
    const fields = changedBriefFields(formBase, draft);
    expect(fields).toEqual(['goal']);
    cmd.updateBrief(ctx, p.id, pick(draft, fields), { base: pick(formBase, fields) });

    const b = getProject(ctx.db, p.id)!.brief;
    expect(b.goal).toBe('להגדיל הזמנות');
    expect(b.brandLogo).toBe('לוגו לבן על רקע כחול');
    expect(b.brandImages).toBe('צילומי שליחים מהאתר');
    expect(b.characters).toHaveLength(1);
    expect(b.aiFilled).toEqual(expect.arrayContaining(['brandLogo', 'brandImages', 'characters']));
  });

  it('409 with the current brief when an edited field changed on the server since the form loaded', async () => {
    const ctx = makeCtx();
    withAutofill(ctx);
    const p = cmd.createProject(ctx, { name: 'The Same Day', clientName: 'The Same Day' });
    const formBase = getProject(ctx.db, p.id)!.brief;
    await autofillBrief(ctx, p.id, { text: 'סיכום שיחה' });

    let err: unknown;
    try {
      cmd.updateBrief(ctx, p.id, { brandLogo: 'לוגו שאוהד כתב', goal: 'מטרה' }, { base: { brandLogo: formBase.brandLogo, goal: formBase.goal } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GateError);
    expect((err as GateError).statusCode).toBe(409);
    expect((err as GateError).message).toContain('לוגו');
    expect((err as GateError).data?.conflicts).toEqual(['brandLogo']);
    expect(((err as GateError).data?.brief as Brief).brandLogo).toBe('לוגו לבן על רקע כחול');
    // שום דבר לא נכתב — גם לא השדה שלא היה בהתנגשות
    const b = getProject(ctx.db, p.id)!.brief;
    expect(b.brandLogo).toBe('לוגו לבן על רקע כחול');
    expect(b.goal).toBe('');
  });

  it('no conflict when the server already holds the value being saved', () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'X', clientName: 'X' });
    cmd.updateBrief(ctx, p.id, { tone: 'חם' }, { by: 'Claude' });
    const r = cmd.updateBrief(ctx, p.id, { tone: 'חם' }, { base: { tone: '' } });
    expect(r.brief.tone).toBe('חם');
  });

  it('without base the old behavior stays (internal callers, scripts)', () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'X', clientName: 'X' });
    cmd.updateBrief(ctx, p.id, { tone: 'חם' }, { by: 'Claude' });
    const r = cmd.updateBrief(ctx, p.id, { tone: 'רגוע' });
    expect(r.brief.tone).toBe('רגוע');
  });

  it('PUT /brief returns 409 with the current brief, and saves a dirty-only patch', async () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'X', clientName: 'X' });
    cmd.updateBrief(ctx, p.id, { brandLogo: 'לוגו מהמילוי', aiFilled: ['brandLogo'] }, { by: 'Claude' });
    const app = await buildApp(ctx);

    const stale = await app.inject({
      method: 'PUT',
      url: `/api/projects/${p.id}/brief`,
      payload: { brief: { brandLogo: '' }, base: { brandLogo: '' } },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().conflicts).toEqual(['brandLogo']);
    expect(stale.json().brief.brandLogo).toBe('לוגו מהמילוי');
    expect(stale.json().error).toContain('לוגו');

    const ok = await app.inject({
      method: 'PUT',
      url: `/api/projects/${p.id}/brief`,
      payload: { brief: { goal: 'מכירות' }, base: { goal: '' } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().brief.brandLogo).toBe('לוגו מהמילוי');
    expect(ok.json().brief.aiFilled).toEqual(['brandLogo']);
    expect(ok.json().brief.goal).toBe('מכירות');
  });
});

describe('Brief form merge (shared)', () => {
  it('fields untouched in the form take the new server value, edited fields stay', () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'X', clientName: 'X' });
    const base = getProject(ctx.db, p.id)!.brief;
    const draft = { ...base, goal: 'מה שאוהד הקליד' };
    const server = { ...base, brandLogo: 'מהמילוי', goal: 'מהמילוי', aiFilled: ['brandLogo', 'goal'] };
    const merged = rebaseBrief(base, draft, server);
    expect(merged.brandLogo).toBe('מהמילוי');
    expect(merged.aiFilled).toEqual(['brandLogo', 'goal']);
    expect(merged.goal).toBe('מה שאוהד הקליד');
    expect(changedBriefFields(server, merged)).toEqual(['goal']);
  });
});
