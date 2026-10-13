import { z } from 'zod';
import type { Brief, BriefValidation } from './brief.js';
import type { PipelineState, StageAvailability, StageKey, Status } from './stages.js';

export const projectSettingsSchema = z.object({
  /** ספק טקסט: openai = אינטגרציה אמיתית; demo = תוכן הדגמה מסומן, ללא API */
  textProvider: z.enum(['openai', 'demo']).default('openai'),
  /** דורס את OPENAI_MODEL לפרויקט זה (ריק = ברירת מחדל מהשרת) */
  textModel: z.string().default(''),
  /** script_only: ChatGPT לתסריט בלבד, שוטים נבנים כשלד לעריכה ידנית.
   *  script_and_visual: ChatGPT מפתח גם קונספט חזותי ופרומפטים לשוטים. */
  chatgptScope: z.enum(['script_only', 'script_and_visual']).default('script_and_visual'),
  autoGenerateScript: z.boolean().default(true),
  autoGenerateStoryboard: z.boolean().default(true),
  defaultImageModel: z.string().default('Higgsfield · Nano Banana Pro'),
  defaultAnimationModel: z.string().default('Kling (Unlimited)'),
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export interface Project {
  id: string;
  name: string;
  clientName: string;
  brief: Brief;
  briefCompletedAt: string | null;
  settings: ProjectSettings;
  pipelineState: PipelineState;
  createdAt: string;
  updatedAt: string;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type JobType = 'script.generate' | 'script.revise' | 'storyboard.generate';

export const JOB_LABELS: Record<JobType, string> = {
  'script.generate': 'יצירת טיוטת תסריט',
  'script.revise': 'יצירת גרסה מתוקנת לתסריט',
  'storyboard.generate': 'יצירת סטורי בורד',
};

export const JOB_STAGE: Record<JobType, StageKey> = {
  'script.generate': 'script',
  'script.revise': 'script',
  'storyboard.generate': 'storyboard',
};

export interface Job {
  id: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  /** automatic = מבוצע ע"י אינטגרציה; manual = כרטיס משימה לביצוע ידני */
  mode: 'automatic' | 'manual';
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  idempotencyKey: string;
  triggeredBy: string | null;
  runAfter: string;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  createdAt: string;
}

export interface JobAttempt {
  id: string;
  jobId: string;
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  error: string | null;
}

export interface ProjectEvent {
  id: string;
  projectId: string | null;
  type: string;
  actor: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type NotificationKind = 'approval_needed' | 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  projectId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

export interface Blocker {
  id: string;
  projectId: string;
  stage: StageKey;
  reason: string;
  source: 'manual' | 'job' | 'stalled';
  createdAt: string;
  resolvedAt: string | null;
}

export interface Approval {
  id: string;
  projectId: string;
  subjectType: string;
  subjectId: string;
  kind: 'internal' | 'client' | 'qc';
  decision: 'approved' | 'changes_requested';
  by: string;
  note: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  projectId: string;
  subjectType: string;
  subjectId: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface Asset {
  id: string;
  projectId: string;
  filename: string;
  mime: string;
  size: number;
  kind: string;
  createdAt: string;
}

/* ---------- מצב נגזר (Workflow) ---------- */

export interface Milestone {
  label: string;
  done: boolean;
}

export interface StageState {
  key: StageKey;
  status: Status;
  availability: StageAvailability;
  detail: string;
  milestones: Milestone[];
  blockedReason: string | null;
}

export interface ActionItem {
  kind: 'approval' | 'task' | 'fix';
  stage: StageKey;
  label: string;
  /** טאב בעמוד הפרויקט */
  tab: string;
}

export interface ProjectState {
  stages: StageState[];
  currentStage: StageKey;
  overallStatus: Status;
  progress: number;
  nextAction: ActionItem | null;
  myActions: ActionItem[];
  blockers: Array<{ stage: StageKey; reason: string; source: string; id?: string }>;
  pipelineState: PipelineState;
  briefValidation: BriefValidation;
  lastActivityAt: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  clientName: string;
  dueDate: string;
  updatedAt: string;
  state: ProjectState;
  /** זמן עבודה מתועד בשניות (כולל טיימר רץ) */
  trackedSec: number;
}

export interface DashboardData {
  projects: ProjectSummary[];
  unreadNotifications: number;
  /** זמן עבודה מתועד מתחילת השבוע (יום א') */
  weekTrackedSec: number;
}
