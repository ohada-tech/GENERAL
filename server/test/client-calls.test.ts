import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { drain } from '../src/jobs/worker.js';
import { callToFeedback, formatTranscript, getCall, transcribeCall } from '../src/services/client-calls.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

const W = (speaker: string, start: number, text: string) => [
  { text, start, type: 'word', speaker },
  { text: ' ', start, type: 'spacing', speaker },
];

async function setup() {
  const ctx = makeCtx();
  const p = projectWithBrief(ctx);
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  let sent: { name: string; size: number } | null = null;
  (ctx.providers as any).voice = {
    isConfigured: () => true,
    transcribe: async (data: Buffer, name: string) => {
      sent = { name, size: data.length };
      return {
        languageCode: 'heb',
        text: 'שלום מה נשמע',
        words: [...W('speaker_0', 0, 'שלום'), ...W('speaker_0', 0.5, 'דנה'), ...W('speaker_1', 65, 'תוריד'), ...W('speaker_1', 66, 'את המטבח'), ...W('speaker_0', 70, 'סגור')],
      };
    },
  };
  return { ctx, p, sent: () => sent };
}

describe('Client calls', { timeout: 30_000 }, () => {
  it('formats a diarized transcript as one line per turn', () => {
    expect(formatTranscript([...W('a', 0, 'היי'), ...W('a', 1, 'שם'), ...W('b', 61, 'כן')])).toBe('[0:00] דובר 1: היי שם\n[1:01] דובר 2: כן');
  });

  it('transcribes a recording, then turns what the client said into a feedback import', async () => {
    const { ctx, p, sent } = await setup();
    const call = await transcribeCall(ctx, p.id, { name: 'call.m4a', data: Buffer.from('audio') });
    expect(sent()).toEqual({ name: 'call.m4a', size: 5 });
    expect(getCall(ctx, call.id)!.transcript).toBe('[0:00] דובר 1: שלום דנה\n[1:05] דובר 2: תוריד את המטבח\n[1:10] דובר 1: סגור');
    expect(call.durationSec).toBe(70);

    let asked = '';
    (ctx.fake as any).json = async (_n: string, _s: object, _sys: string, user: string) => {
      asked = user;
      return {
        data: {
          clientSpeaker: 'דובר 2',
          items: [
            { scene: 2, text: 'להוריד את המטבח', quote: 'תוריד את המטבח', agreed: true },
            { scene: 99, text: 'הטון צעיר יותר', quote: '', agreed: false },
            { scene: 0, text: ' ', quote: '', agreed: false },
          ],
        },
        model: 'gpt-test',
      };
    };
    const imp = await callToFeedback(ctx, call.id);
    expect(asked).toContain('CALL TRANSCRIPT');
    expect(asked).toContain('תוריד את המטבח');
    expect(imp).toMatchObject({ source: 'call', callId: call.id, status: 'draft' });
    expect(imp.items.map((i) => [i.text, i.scenes, i.author])).toEqual([
      ['להוריד את המטבח', [1], 'סוכם בשיחה'],
      ['הטון צעיר יותר', [], 'הלקוח בשיחה'],
    ]);
  });

  it('rejects a file that is not a recording, and serves the calls over the API', async () => {
    const { ctx, p } = await setup();
    await expect(transcribeCall(ctx, p.id, { name: 'notes.docx', data: Buffer.from('x') })).rejects.toThrow('הקלטה');
    const call = await transcribeCall(ctx, p.id, { name: 'call.mp3', data: Buffer.from('audio') });
    const app = await buildApp(ctx);
    const list = await app.inject({ url: `/api/projects/${p.id}/calls` });
    const one = await app.inject({ url: `/api/calls/${call.id}` });
    await app.close();
    expect(list.json().calls.map((c: { id: string }) => c.id)).toEqual([call.id]);
    expect(one.json().transcript).toContain('תוריד את המטבח');
  });
});
