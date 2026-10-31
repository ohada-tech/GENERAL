import { describe, expect, it } from 'vitest';
import { writeScriptTwoStep, type TwoStepWriter } from '../src/providers/writer.js';
import { writingContext } from '../src/services/creative.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

const scene = (narration: string) => ({ storyRole: 'hook', narration, onScreenText: '', visualAction: 'רואים ספר במספרה', estDurationSec: 5, notes: '' });
const script = (n: number) => ({ title: 'כותרת', logline: 'רעיון', scenes: [scene('מילה '.repeat(n).trim()), scene('הצטרפו עכשיו')] });

function fake(answers: object[]) {
  const calls: string[] = [];
  const w: TwoStepWriter = {
    id: 'openai',
    text: async () => ({ text: 'טיוטה', model: 'm' }),
    json: async <T,>(name: string) => {
      calls.push(name);
      return { data: answers.shift() as T, model: 'm' } as never;
    },
  };
  return { w, calls };
}

// 10 שניות בעברית → תקציב קטן (כ-20 מילים)
function pctx() {
  const c = makeCtx();
  const p = projectWithBrief(c);
  cmd.updateBrief(c, p.id, { durationSec: 10, language: 'עברית', voiceoverNeeded: true });
  return writingContext(c, p.id);
}

describe('קיצור אחרי הכתיבה', () => {
  it('קריינות ארוכה מהתקציב — הכותב מקצר עד שהיא נכנסת', async () => {
    const { w, calls } = fake([script(40), script(25), script(17)]);
    const r = await writeScriptTwoStep(w, pctx());
    expect(calls).toEqual(['script', 'script_trim', 'script_trim']);
    expect(r.data.scenes[0].narration.split(' ')).toHaveLength(17);
  });

  it('קיצור שחתך יותר מדי (רשימת פיצ׳רים) — לא מתקבל', async () => {
    const { w } = fake([script(40), script(5), script(4)]);
    const r = await writeScriptTwoStep(w, pctx());
    expect(r.data.scenes[0].narration.split(' ')).toHaveLength(40);
  });

  it('בתוך התקציב — בלי קריאת קיצור', async () => {
    const { w, calls } = fake([script(5)]);
    await writeScriptTwoStep(w, pctx());
    expect(calls).toEqual(['script']);
  });

  it('"קיצור" שהאריך — לא מתקבל', async () => {
    const { w } = fake([script(40), script(45), script(42)]);
    const r = await writeScriptTwoStep(w, pctx());
    expect(r.data.scenes[0].narration.split(' ')).toHaveLength(40);
  });
});
