import { ANIMATION_MODEL_OPTIONS, clipDuration, videoModel, videoModelForShot } from '@apos/shared';
import { describe, expect, it } from 'vitest';
import { storyboardSystemPrompt } from '../src/providers/prompts.js';

describe('video models', () => {
  it('routes storyboard recommendations to the current KIE models', () => {
    expect(videoModelForShot('Kling 3.0', 'kling-3.0').apiModel).toBe('kling-3.0/video');
    expect(videoModelForShot('Seedance 2.0', 'kling-3.0').apiModel).toBe('bytedance/seedance-2');
    // Mini לא נבלע ב-Seedance 2.0
    expect(videoModelForShot('Seedance 2.0 Mini', 'kling-3.0').apiModel).toBe('bytedance/seedance-2-mini');
  });

  it('keeps old projects working', () => {
    // שוטים ישנים מנותבים לפי מילת המפתח, מזהה ישן נופל לברירת המחדל
    expect(videoModelForShot('Kling 2.6', 'kling-2.6').id).toBe('kling-3.0');
    expect(videoModelForShot('Seedance 1.5 Pro', 'kling-2.6').id).toBe('seedance-2');
    expect(videoModelForShot('Hailuo 2.3', 'kling-2.6').id).toBe('kling-3.0');
    expect(videoModel('hailuo-2.3').id).toBe('kling-3.0');
  });

  it('orders the shortest supported duration that covers the shot', () => {
    expect(clipDuration(videoModel('kling-3.0'), 3)).toBe(3);
    expect(clipDuration(videoModel('seedance-2'), 2.5)).toBe(4);
    expect(clipDuration(videoModel('seedance-2'), 20)).toBe(15);
  });

  it('every storyboard option except manual maps to its own model', () => {
    const ids = ANIMATION_MODEL_OPTIONS.filter((o) => o !== 'ידני / אחר').map((o) => videoModelForShot(o, 'kling-3.0').id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('storyboard prompt recommends only current models', () => {
    const p = storyboardSystemPrompt({ imageModel: 'Nano Banana 2', animationModel: 'Kling 2.6' });
    expect(p).toContain('Default "Kling 3.0"');
    expect(p).not.toMatch(/Kling 2\.6"|Seedance 1\.5|Hailuo/);
  });
});
