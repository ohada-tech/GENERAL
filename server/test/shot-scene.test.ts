import { describe, expect, it } from 'vitest';
import { creativeSystemPrompt, qaSystemPrompt, SHOT_VS_SCENE } from '../src/providers/prompts.js';

describe('סצנה ≠ שוט', () => {
  it('הכותב וה-QA יודעים שכלל אורך השוט לא חל על סצנה', () => {
    const ctx = { brief: { language: 'עברית', constraints: 'כל שוט עד 3 שניות' } } as any;
    expect(qaSystemPrompt(ctx)).toContain(SHOT_VS_SCENE);
    expect(creativeSystemPrompt(ctx)).toContain(SHOT_VS_SCENE);
  });
});
