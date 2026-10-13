import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { KieClient } from '../src/providers/kie.js';
import { ProviderError } from '../src/providers/types.js';
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

/** KIE מזויף: אותו ממשק, בלי רשת ובלי כסף. download מחזיר קבצים אמיתיים (נוצרים ב-ffmpeg אם זמין). */
export class FakeKie {
  readonly id = 'kie';
  readonly label = 'Fake KIE';
  created: Array<{ model: string; input: Record<string, unknown> }> = [];
  music = 0;
  uploads = 0;
  failNextWait: Error[] = [];
  failTask = new Set<string>();
  configured = true;
  constructor(private readonly samples: { png: Buffer; mp4: Buffer | null; mp3: Buffer | null }) {}
  isConfigured() {
    return this.configured;
  }
  async verify() {
    return { ok: true as const, credits: 1000 };
  }
  async credits() {
    return 1000;
  }
  async createTask(model: string, input: Record<string, unknown>) {
    this.created.push({ model, input });
    return `task-${this.created.length}`;
  }
  async waitTask(taskId: string) {
    const e = this.failNextWait.shift();
    if (e) throw e;
    if (this.failTask.has(taskId)) throw new ProviderError('היצירה ב-KIE נכשלה: content policy', false, 'generation_failed');
    const n = Number(taskId.split('-')[1]) - 1;
    const model = this.created[n]?.model ?? '';
    const ext = model.includes('elevenlabs') ? 'mp3' : model.includes('video') || model.includes('seedance') || model.includes('hailuo') ? 'mp4' : 'png';
    return { urls: [`https://fake.kie/${taskId}.${ext}`], creditsConsumed: null };
  }
  async createMusic() {
    this.music++;
    return `music-${this.music}`;
  }
  async waitMusic() {
    return [{ audioUrl: 'https://fake.kie/music.mp3', duration: 30, title: 't' }];
  }
  async download(url: string) {
    const ext = url.split('.').pop();
    if (ext === 'mp4' && this.samples.mp4) return { data: this.samples.mp4, mime: 'video/mp4' };
    if (ext === 'mp3' && this.samples.mp3) return { data: this.samples.mp3, mime: 'audio/mpeg' };
    return { data: this.samples.png, mime: 'image/png' };
  }
  async upload() {
    this.uploads++;
    return `https://fake.kie/upload-${this.uploads}.png`;
  }
}

let samplesCache: { png: Buffer; mp4: Buffer | null; mp3: Buffer | null } | null = null;
export function sampleMedia() {
  if (samplesCache) return samplesCache;
  // PNG של 1×1
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apos-media-'));
  const make = (args: string[], file: string) => {
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, path.join(dir, file)]);
      return fs.readFileSync(path.join(dir, file));
    } catch {
      return null;
    }
  };
  const mp4 = make(['-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=30', '-t', '5', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast'], 'clip.mp4');
  const mp3 = make(['-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '6', '-c:a', 'libmp3lame'], 'tone.mp3');
  samplesCache = { png, mp4, mp3 };
  return samplesCache;
}

export function makeCtx(fake = new FakeTextProvider(), kie = new FakeKie(sampleMedia())): TestCtx & { fake: FakeTextProvider; kie: FakeKie } {
  const config = loadConfig({
    OWNER_NAME: 'tester',
    JOB_MAX_ATTEMPTS: '3',
    JOB_RETRY_BASE_SECONDS: '10',
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'apos-data-')),
  } as any);
  const clock = { t: Date.parse('2026-01-01T10:00:00.000Z') };
  const ctx = {
    db: openDb(':memory:'),
    config,
    // הספק "openai" מוחלף בספק מזויף — אותו ממשק בדיוק
    providers: {
      text: { collab: fake, 'collab:claude': fake, openai: fake, claude: fake, demo: new DemoTextProvider() },
      media: kie as unknown as KieClient,
    },
    now: () => new Date(clock.t),
    clock,
    advance(seconds: number) {
      clock.t += seconds * 1000;
    },
    fake,
    kie,
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
