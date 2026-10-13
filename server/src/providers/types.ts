import type { Brief, ScriptContent, ShotFields } from '@apos/shared';

/**
 * שגיאת ספק. retryable קובע אם מנגנון ה-Retry ינסה שוב
 * (למשל 429/5xx/רשת) או שהמשימה תסומן כחסומה (מפתח חסר, 401, בקשה שגויה).
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code: string = 'provider_error',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface GenResult<T> {
  data: T;
  provider: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** במצב שיתוף: מה המודל המבקר שינה ולמה */
  reviewNotes?: string[];
  reviewer?: string;
}

export interface ScriptDraftScene {
  storyRole: string;
  narration: string;
  onScreenText: string;
  visualAction: string;
  estDurationSec: number;
  notes: string;
}

export interface ScriptDraft {
  title: string;
  logline: string;
  scenes: ScriptDraftScene[];
}

export interface ProjectContext {
  name: string;
  clientName: string;
  brief: Brief;
  /** כללים שהמערכת למדה מהערות קודמות (כלליים + של הלקוח) */
  lessons?: string[];
  /** ספר ההפקה: הסקילים שלימדת את Claude, מזוקקים (כלליים + של הלקוח) */
  playbook?: string;
}

export interface TextGenOptions {
  model?: string;
}

/** ממשק אחיד לספק טקסט — החלפת ספק לא דורשת שינוי בשאר המערכת. */
export interface TextProvider {
  readonly id: string;
  readonly label: string;
  /** האם הספק מחובר בפועל (למשל מפתח API קיים) */
  isConfigured(): boolean;
  /** האם התוצרים הם תוכן הדגמה ולא תוצר אמיתי של מודל */
  readonly isDemo: boolean;
  generateScript(ctx: ProjectContext, opts?: TextGenOptions): Promise<GenResult<ScriptDraft>>;
  reviseScript(
    ctx: ProjectContext,
    base: ScriptContent,
    feedback: string,
    opts?: TextGenOptions,
  ): Promise<GenResult<ScriptDraft>>;
  generateStoryboard(
    ctx: ProjectContext,
    script: ScriptContent,
    defaults: { imageModel: string; animationModel: string },
    opts?: TextGenOptions,
  ): Promise<GenResult<ShotFields[]>>;
}
