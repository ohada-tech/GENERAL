import type { StageKey } from './stages.js';

export type TimeSource = 'timer' | 'manual';

export interface TimeEntry {
  id: string;
  projectId: string;
  stage: StageKey;
  startedAt: string;
  /** null = טיימר שרץ כרגע */
  endedAt: string | null;
  durationSec: number;
  note: string;
  source: TimeSource;
  createdAt: string;
}

export interface TimeSummary {
  /** זמן עבודה מתועד (טיימר + הזנה ידנית), כולל טיימר שרץ כרגע */
  trackedSec: number;
  byStage: Partial<Record<StageKey, number>>;
  /** הערכה אוטומטית: זמן פעילות במערכת לפי היסטוריית הפעולות שלך (לא כולל עבודה בכלים חיצוניים) */
  estimatedActiveSec: number;
  running: TimeEntry | null;
  entryCount: number;
  firstWorkAt: string | null;
  lastWorkAt: string | null;
}

export interface RunningTimer extends TimeEntry {
  projectName: string;
}

/** 3725 → "1:02 ש׳"; מתחת לשעה → "12 ד׳" */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (s > 0 && s < 60) return '<1 ד׳';
  if (h === 0) return `${m} ד׳`;
  return `${h}:${String(m).padStart(2, '0')} ש׳`;
}

/** 3725 → "01:02:05" — לטיימר חי */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/**
 * הערכת זמן פעילות מתוך זמני פעולות: פעולות שהמרווח ביניהן קטן מ-gapMin נחשבות אותו סשן עבודה.
 * כל סשן = מהפעולה הראשונה לאחרונה + floorMin (זמן קריאה/חשיבה סביב הפעולות).
 */
export function estimateActiveSeconds(timestamps: string[], gapMin = 20, floorMin = 5): number {
  const ts = timestamps
    .map((t) => new Date(t).getTime())
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (ts.length === 0) return 0;
  const gap = gapMin * 60_000;
  let total = 0;
  let start = ts[0];
  let prev = ts[0];
  for (let i = 1; i <= ts.length; i++) {
    const cur = ts[i];
    if (cur === undefined || cur - prev > gap) {
      total += prev - start + floorMin * 60_000;
      start = cur;
    }
    prev = cur;
  }
  return Math.round(total / 1000);
}
