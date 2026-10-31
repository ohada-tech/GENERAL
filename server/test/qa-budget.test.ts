import { QA_RUBRIC } from '@apos/shared';
import { describe, expect, it } from 'vitest';
import { gate, lengthNote } from '../src/services/creative.js';

const full = () => Object.fromEntries(Object.entries(QA_RUBRIC).map(([k, v]) => [k, { score: v.max, evidence: 'סצנה 1' }]));
const judgeSays = ['הקריינות חורגת מתקציב המילים שנבדק: 95 מילים מול יעד של 89.'];

describe('תקציב מילים ב-QA', () => {
  it('חריגה קטנה (הערה בקוד) לא מפילה, גם אם השופט כתב אותה כקריטית', () => {
    const qa = gate({ scores: full(), critical: judgeSays }, { critical: [], issues: ['הקריינות מעט מעל התקציב: 95/89 מילים'] }, 'test');
    expect(qa.critical).toEqual([]);
    expect(qa.passed).toBe(true);
    expect(qa.codeChecks).toContain('הקריינות מעט מעל התקציב: 95/89 מילים');
  });

  it('חריגה גדולה (קריטית בקוד) עדיין מפילה', () => {
    const code = 'קריינות ארוכה מדי: 120 מילים ≈ 60 שניות קריינות בסרטון של 45 שניות (תקציב: 89 מילים)';
    const qa = gate({ scores: full(), critical: judgeSays }, { critical: [code], issues: [] }, 'test');
    expect(qa.passed).toBe(false);
    expect(qa.critical).toEqual([...judgeSays, code]);
  });

  it('כשל קריטי אחר של השופט נשאר', () => {
    const qa = gate({ scores: full(), critical: ['הצופה לא מבין מה המוצר'] }, { critical: [], issues: [] }, 'test');
    expect(qa.passed).toBe(false);
  });

  it('הוראת קיצור עם מספרים מדויקים', () => {
    expect(lengthNote(95, 89)).toContain('Cut at least 6 words');
    expect(lengthNote(80, 89)).toBe('');
  });
});
