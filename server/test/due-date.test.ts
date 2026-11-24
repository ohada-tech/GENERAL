import { describe, expect, it } from 'vitest';
import { defaultDueDate, validateBrief } from '@apos/shared';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx } from './helpers.js';

describe('תאריך יעד ברירת מחדל — 7 ימי עסקים', () => {
  it('מדלג על שישי ושבת', () => {
    // יום שלישי 24.11.2026 → 7 ימי עסקים (רביעי, חמישי, ראשון–חמישי) = חמישי 3.12
    expect(defaultDueDate('2026-11-24T10:00:00Z')).toBe('2026-12-03');
    // שישי 27.11 → ראשון 29.11 נספר ראשון → שני 7.12
    expect(defaultDueDate('2026-11-27T10:00:00Z')).toBe('2026-12-07');
  });

  it('לפי שעון ישראל', () => {
    // 23:30 UTC ביום חמישי = 01:30 שישי בישראל
    expect(defaultDueDate('2026-11-26T23:30:00Z')).toBe('2026-12-07');
  });

  it('פרויקט חדש נפתח עם תאריך יעד, והוא לא חסר באפיון', () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'X', clientName: 'Y' });
    expect(p.brief.dueDate).toBe(defaultDueDate(p.createdAt));
    expect(p.brief.aiFilled).toContain('dueDate');
    expect(validateBrief(p.brief).missingRequired.map((m) => m.field)).not.toContain('dueDate');
  });
});
