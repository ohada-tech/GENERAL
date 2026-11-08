/**
 * עלות לכל פרויקט: קרדיטים בהיגספילד (גם בדולרים), טוקנים של Claude Code,
 * וחלק הפרויקט ממגבלת השימוש השבועית של החשבון.
 * הנתונים נאספים במחשב של אוהד (~/.apos/usage-sync.cjs) ונשלחים למערכת.
 */
import { z } from 'zod';

/** מחיר קרדיט בהיגספילד (דף Usage) */
export const HF_CREDIT_USD = 0.04;

export const usageTokensSchema = z.object({
  input: z.number().nonnegative().default(0),
  output: z.number().nonnegative().default(0),
  cacheRead: z.number().nonnegative().default(0),
  cacheWrite: z.number().nonnegative().default(0),
});
export type UsageTokens = z.infer<typeof usageTokensSchema>;

export const usageSyncSchema = z.object({
  projects: z
    .array(
      z.object({
        projectId: z.string().min(1),
        hfCredits: z.number().nonnegative().default(0),
        tokens: usageTokensSchema,
        /** משקל השימוש השבוע (לחישוב החלק מהמגבלה השבועית) */
        weekWeight: z.number().nonnegative().default(0),
        sessions: z.number().int().nonnegative().default(0),
      }),
    )
    .max(500),
  /** משקל כל השימוש בחשבון השבוע — כולל סשנים שלא שייכים לפרויקט */
  weekWeightTotal: z.number().nonnegative().default(0),
});
export type UsageSync = z.infer<typeof usageSyncSchema>;

export const planUsageSchema = z.object({
  windows: z
    .array(z.object({ label: z.string().max(80), percentUsed: z.number().min(0).max(1000), resetsAt: z.string().max(40).nullable().default(null) }))
    .max(10),
});
export type PlanUsageInput = z.infer<typeof planUsageSchema>;

export interface PlanUsage {
  windows: Array<{ label: string; percentUsed: number; resetsAt: string | null }>;
  /** מתי נמדד */
  at: string;
}

export interface ProjectUsage {
  hfCredits: number;
  hfUsd: number;
  tokens: UsageTokens & { total: number };
  sessions: number;
  /** חלק הפרויקט מכל השימוש השבוע (0–1) */
  weekShare: number;
  /** ≈ אחוז מהמגבלה השבועית שהפרויקט צרך. null = אין מדידה של המגבלה */
  weekPct: number | null;
  updatedAt: string;
}

export const tokensTotal = (t: UsageTokens) => t.input + t.output + t.cacheRead + t.cacheWrite;

/** תצוגה קצרה: 1.2M / 340K */
export function fmtTokens(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
}

/** המגבלה השבועית של כל המודלים — הבסיס לחישוב החלק של כל פרויקט */
export const weeklyWindow = (p: PlanUsage | null | undefined) => p?.windows.find((w) => /weekly/i.test(w.label) && /all/i.test(w.label)) ?? p?.windows.find((w) => /weekly|שבוע/i.test(w.label)) ?? null;
