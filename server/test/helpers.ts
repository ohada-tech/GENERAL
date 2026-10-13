import { loadConfig } from '../src/config.js';
import type { Ctx } from '../src/context.js';
import { openDb } from '../src/db/db.js';
import { DemoTextProvider } from '../src/providers/demo.js';
import type { TextProvider } from '../src/providers/types.js';
import * as cmd from '../src/workflow/commands.js';

export interface TestCtx extends Ctx {
  clock: { t: number };
  advance(seconds: number): void;
}

/** ספק טקסט לבדיקות: מתנהג כמו ספק אמיתי (לא demo), עם אפשרות להזריק כשלונות. */
export class FakeTextProvider implements TextProvider {
  readonly id = 'fake';
  readonly label = 'Fake';
  readonly isDemo = false;
  calls = 0;
  failWith: Error[] = [];
  private demo: TextProvider = new DemoTextProvider();
  isConfigured() {
    return true;
  }
  private maybeFail() {
    this.calls++;
    const e = this.failWith.shift();
    if (e) throw e;
  }
  async generateScript(...a: Parameters<TextProvider['generateScript']>) {
    this.maybeFail();
    const r = await this.demo.generateScript(...a);
    return { ...r, provider: 'fake', model: 'fake-model' };
  }
  async reviseScript(...a: Parameters<TextProvider['reviseScript']>) {
    this.maybeFail();
    const r = await this.demo.reviseScript(...a);
    return { ...r, provider: 'fake', model: 'fake-model' };
  }
  async generateStoryboard(...a: Parameters<TextProvider['generateStoryboard']>) {
    this.maybeFail();
    const r = await this.demo.generateStoryboard(...a);
    return { ...r, provider: 'fake', model: 'fake-model' };
  }
}

export function makeCtx(fake = new FakeTextProvider()): TestCtx & { fake: FakeTextProvider } {
  const config = loadConfig({ OWNER_NAME: 'tester', JOB_MAX_ATTEMPTS: '3', JOB_RETRY_BASE_SECONDS: '10' } as any);
  const clock = { t: Date.parse('2026-01-01T10:00:00.000Z') };
  const ctx = {
    db: openDb(':memory:'),
    config,
    // הספק "openai" מוחלף בספק מזויף — אותו ממשק בדיוק
    providers: { text: { openai: fake, demo: new DemoTextProvider() } },
    now: () => new Date(clock.t),
    clock,
    advance(seconds: number) {
      clock.t += seconds * 1000;
    },
    fake,
  };
  return ctx;
}

export const FULL_BRIEF = {
  videoType: 'פרסומת',
  goal: 'הגדלת הרשמות',
  productOrService: 'אפליקציית כושר',
  targetAudience: 'נשים 25-40',
  keyMessage: 'אימון של 10 דקות ביום מספיק',
  platforms: ['Instagram Reels'],
  aspectRatio: '9:16',
  durationSec: 30,
  visualStyle: 'ריאליסטי, אור טבעי',
  language: 'עברית',
  tone: 'אנרגטי וחם',
  dueDate: '2026-02-01',
};

export function projectWithBrief(ctx: Ctx) {
  const p = cmd.createProject(ctx, { name: 'Test', clientName: 'Client' });
  cmd.updateBrief(ctx, p.id, FULL_BRIEF);
  return p;
}
