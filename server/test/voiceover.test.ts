import { describe, expect, it } from 'vitest';
import { getProject, listMedia, listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import * as cmd from '../src/workflow/commands.js';
import * as vo from '../src/workflow/voiceover.js';
import { makeCtx, projectWithBrief, sampleMedia } from './helpers.js';

function withVoice(ctx: ReturnType<typeof makeCtx>) {
  const calls: Array<{ text: string; voiceId: string; model: string }> = [];
  const mp3 = sampleMedia().mp3 ?? Buffer.from('ID3fake');
  (ctx.providers as any).voice = {
    isConfigured: () => true,
    tts: async (text: string, voiceId: string, model: string) => {
      calls.push({ text, voiceId, model });
      return mp3;
    },
  };
  return calls;
}

describe('Voiceover stage (ElevenLabs)', () => {
  it('needs ElevenLabs, a voice and a script', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    expect(() => vo.generateVoiceover(ctx, p.id, { voiceId: 'v1' })).toThrow(/ElevenLabs/);
    withVoice(ctx);
    expect(() => vo.generateVoiceover(ctx, p.id, {})).toThrow(/קול/);
    expect(() => vo.generateVoiceover(ctx, p.id, { voiceId: 'v1' })).toThrow(/תסריט/);
  });

  it('reads the script narration right after the script, before any production stage', async () => {
    const ctx = makeCtx();
    const calls = withVoice(ctx);
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const script = listScripts(ctx.db, p.id)[0];
    const o = vo.voiceoverOverview(ctx, p.id);
    expect(o.narration?.source).toBe('draft');
    expect(o.narration?.text.length).toBeGreaterThan(0);

    const m = vo.generateVoiceover(ctx, p.id, { voiceId: 'voice-abc', model: 'eleven_v3' });
    expect(m.status).toBe('generating');
    // הקול נשמר לפרויקט
    expect(getProject(ctx.db, p.id)!.settings.elevenVoiceId).toBe('voice-abc');
    expect(() => vo.generateVoiceover(ctx, p.id, {})).toThrow(/כבר נוצרת/);
    await drain(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ voiceId: 'voice-abc', model: 'eleven_v3' });
    expect(calls[0].text).toBe(script.content.scenes.map((s) => s.narration.trim()).filter((x) => x && x !== '—' && x !== '-').join('\n'));
    const take1 = listMedia(ctx.db, p.id, 'voiceover')[0];
    expect(take1.status).toBe('ready');
    expect(take1.assetId).toBeTruthy();

    // טייק שני: הקודם מפנה מקום, נשאר ברשימה
    vo.generateVoiceover(ctx, p.id, { note: 'קצב איטי יותר' });
    await drain(ctx);
    const takes = vo.voiceoverTakes(ctx, p.id);
    expect(takes.map((t) => [t.version, t.status])).toEqual([
      [2, 'ready'],
      [1, 'rejected'],
    ]);
    expect(calls[1].voiceId).toBe('voice-abc');
  });
});
