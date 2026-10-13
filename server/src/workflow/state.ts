/**
 * גזירת מצב הפרויקט מהנתונים — פונקציה טהורה (ללא DB) כדי שתהיה ניתנת לבדיקה.
 * סטטוס שלב לא נשמר ידנית: הוא נגזר מהתוצרים, האישורים, המשימות והחסמים,
 * ולכן תמיד משקף את המצב האמיתי.
 */
import {
  JOB_STAGE,
  STAGES,
  validateBrief,
  type ActionItem,
  type Blocker,
  type Job,
  type Project,
  type ProjectState,
  type Reference,
  type ScriptVersion,
  type Shot,
  type StageKey,
  type StageState,
  type Status,
  type Storyboard,
} from '@apos/shared';

export interface StateInput {
  project: Project;
  scripts: ScriptVersion[]; // מהחדשה לישנה
  storyboard: Storyboard | null; // הנוכחי
  shots: Shot[];
  refs: Reference[];
  jobs: Job[]; // מהחדשה לישנה
  blockers: Blocker[]; // פתוחים
  lastActivityAt: string | null;
}

const TAB: Record<StageKey, string> = {
  brief: 'brief',
  script: 'script',
  storyboard: 'storyboard',
  references: 'storyboard',
  images: 'overview',
  animation: 'overview',
  audio: 'overview',
  editing: 'overview',
  delivery: 'overview',
};

function latestJobFor(jobs: Job[], stage: StageKey) {
  return jobs.find((j) => JOB_STAGE[j.type] === stage && j.status !== 'cancelled') ?? null;
}

const isActive = (j: Job | null) => !!j && (j.status === 'queued' || j.status === 'running');

export function computeProjectState(input: StateInput): ProjectState {
  const { project, scripts, storyboard, shots, refs, jobs, blockers } = input;
  const bv = validateBrief(project.brief);
  const paused = project.pipelineState === 'paused';
  const actions: ActionItem[] = [];
  const derivedBlockers: ProjectState['blockers'] = [];
  const stages: Record<string, StageState> = {};

  const set = (key: StageKey, s: Omit<StageState, 'key' | 'availability' | 'blockedReason'> & { blockedReason?: string | null }) => {
    const def = STAGES.find((d) => d.key === key)!;
    stages[key] = { key, availability: def.availability, blockedReason: s.blockedReason ?? null, ...s };
  };
  const jobRunningDetail = (j: Job) =>
    paused
      ? 'ממתין בתור — ה-Pipeline מושהה'
      : j.status === 'running'
        ? 'רץ כעת…'
        : j.attempts > 0
          ? `ממתין לניסיון חוזר (${j.attempts}/${j.maxAttempts}): ${j.lastError ?? ''}`
          : 'בתור להרצה';

  /* 01 Brief */
  {
    const done = !!project.briefCompletedAt;
    const status: Status = done ? 'completed' : bv.requiredDone > 0 ? 'in_progress' : 'not_started';
    set('brief', {
      status,
      detail: done
        ? 'האפיון הושלם'
        : bv.complete
          ? 'כל שדות החובה מולאו — ניתן לסמן כמוכן'
          : `חסרים ${bv.missingRequired.length} שדות חובה: ${bv.missingRequired.map((m) => m.label).join(', ')}`,
      milestones: [
        { label: `שדות חובה (${bv.requiredDone}/${bv.requiredTotal})`, done: bv.complete },
        { label: 'האפיון סומן כמוכן', done },
      ],
    });
    if (!done) {
      actions.push(
        bv.complete
          ? { kind: 'task', stage: 'brief', label: 'סמן את האפיון כמוכן כדי להפעיל כתיבת תסריט', tab: 'brief' }
          : { kind: 'task', stage: 'brief', label: `השלם ${bv.missingRequired.length} שדות חובה באפיון`, tab: 'brief' },
      );
    }
  }

  /* 02 Script */
  const latestScript = scripts[0] ?? null;
  const scriptDone = latestScript?.status === 'client_approved';
  {
    const job = latestJobFor(jobs, 'script');
    const milestones = [
      { label: 'טיוטה נוצרה', done: scripts.length > 0 },
      {
        label: 'אישור פנימי',
        done: !!latestScript && (latestScript.status === 'internal_approved' || latestScript.status === 'client_approved'),
      },
      { label: 'אישור לקוח', done: scriptDone },
    ];
    const v = latestScript ? `v${latestScript.version}` : '';
    if (!project.briefCompletedAt && !latestScript) {
      set('script', { status: 'not_started', detail: 'ממתין להשלמת האפיון', milestones });
    } else if (isActive(job)) {
      set('script', { status: 'in_progress', detail: `${job!.type === 'script.revise' ? 'גרסה מתוקנת' : 'טיוטה'}: ${jobRunningDetail(job!)}`, milestones });
    } else if (job?.status === 'failed' && (!latestScript || latestScript.createdAt < (job.finishedAt ?? job.createdAt))) {
      const reason = job.lastError ?? 'שגיאה לא ידועה';
      set('script', { status: 'blocked', detail: `יצירת התסריט נכשלה: ${reason}`, milestones, blockedReason: reason });
      derivedBlockers.push({ stage: 'script', reason: `יצירת התסריט נכשלה: ${reason}`, source: 'job' });
      actions.push({ kind: 'fix', stage: 'script', label: 'יצירת התסריט נכשלה — בדוק את השגיאה ונסה שוב', tab: 'jobs' });
    } else if (!latestScript) {
      set('script', { status: 'not_started', detail: 'אין עדיין תסריט', milestones });
      actions.push({ kind: 'task', stage: 'script', label: 'צור טיוטת תסריט (AI) או כתוב ידנית', tab: 'script' });
    } else if (latestScript.status === 'draft') {
      set('script', { status: 'waiting_internal', detail: `טיוטה ${v} ממתינה לבדיקה ואישור שלך`, milestones });
      actions.push({ kind: 'approval', stage: 'script', label: `בדוק ואשר את תסריט ${v}`, tab: 'script' });
    } else if (latestScript.status === 'changes_requested') {
      set('script', { status: 'needs_revision', detail: `נדרשים שינויים ב-${v}`, milestones });
      actions.push({ kind: 'fix', stage: 'script', label: `צור גרסה מתוקנת לתסריט ${v}`, tab: 'script' });
    } else if (latestScript.status === 'internal_approved') {
      set('script', { status: 'waiting_client', detail: `${v} אושר פנימית — ממתין לאישור הלקוח`, milestones });
      actions.push({ kind: 'approval', stage: 'script', label: `הצג ללקוח את תסריט ${v} וסמן את אישורו`, tab: 'script' });
    } else {
      set('script', { status: 'completed', detail: `${v} אושר ע"י הלקוח`, milestones });
    }
  }

  /* 03 Storyboard */
  const approvedShots = shots.filter((s) => s.approval === 'approved').length;
  const revisionShots = shots.filter((s) => s.approval === 'needs_revision');
  const sbDone = storyboard?.status === 'approved';
  {
    const job = latestJobFor(jobs, 'storyboard');
    const milestones = [
      { label: 'סטורי בורד נוצר', done: !!storyboard },
      { label: `שוטים מאושרים (${approvedShots}/${shots.length})`, done: shots.length > 0 && approvedShots === shots.length },
      { label: 'הסטורי בורד אושר', done: sbDone },
    ];
    const outdated =
      storyboard && latestScript && storyboard.scriptVersionId !== latestScript.id
        ? ' · שים לב: מבוסס על גרסת תסריט קודמת'
        : '';
    if (isActive(job)) {
      set('storyboard', { status: 'in_progress', detail: `יצירת סטורי בורד: ${jobRunningDetail(job!)}`, milestones });
    } else if (job?.status === 'failed' && (!storyboard || storyboard.createdAt < (job.finishedAt ?? job.createdAt))) {
      const reason = job.lastError ?? 'שגיאה לא ידועה';
      set('storyboard', { status: 'blocked', detail: `יצירת הסטורי בורד נכשלה: ${reason}`, milestones, blockedReason: reason });
      derivedBlockers.push({ stage: 'storyboard', reason: `יצירת הסטורי בורד נכשלה: ${reason}`, source: 'job' });
      actions.push({ kind: 'fix', stage: 'storyboard', label: 'יצירת הסטורי בורד נכשלה — בדוק ונסה שוב', tab: 'jobs' });
    } else if (!storyboard) {
      if (scriptDone) {
        set('storyboard', { status: 'not_started', detail: 'התסריט אושר — ניתן ליצור סטורי בורד', milestones });
        actions.push({ kind: 'task', stage: 'storyboard', label: 'צור סטורי בורד מהתסריט המאושר', tab: 'storyboard' });
      } else {
        set('storyboard', { status: 'not_started', detail: 'ממתין לאישור לקוח על התסריט', milestones });
      }
    } else if (sbDone) {
      set('storyboard', { status: 'completed', detail: `v${storyboard.version} אושר (${shots.length} שוטים)${outdated}`, milestones });
    } else if (revisionShots.length) {
      set('storyboard', {
        status: 'needs_revision',
        detail: `${revisionShots.length} שוטים דורשים תיקון${outdated}`,
        milestones,
      });
      actions.push({
        kind: 'fix',
        stage: 'storyboard',
        label: `תקן שוטים ${revisionShots.map((s) => s.number).join(', ')}`,
        tab: 'storyboard',
      });
    } else if (shots.length && approvedShots === shots.length) {
      set('storyboard', { status: 'waiting_internal', detail: `כל השוטים אושרו — אשר את הסטורי בורד${outdated}`, milestones });
      actions.push({ kind: 'approval', stage: 'storyboard', label: 'אשר את הסטורי בורד', tab: 'storyboard' });
    } else {
      set('storyboard', {
        status: 'waiting_internal',
        detail: `${approvedShots}/${shots.length} שוטים אושרו${outdated}`,
        milestones,
      });
      actions.push({
        kind: 'approval',
        stage: 'storyboard',
        label: `בדוק ואשר שוטים (${shots.length - approvedShots} ממתינים)`,
        tab: 'storyboard',
      });
    }
  }

  /* 04 References — בשלב זה: הוספה ובדיקה ידניות לכל שוט */
  {
    const withApproved = new Set(refs.filter((r) => r.status === 'approved').map((r) => r.shotId));
    const pending = refs.filter((r) => r.status === 'candidate').length;
    const covered = shots.filter((s) => withApproved.has(s.id)).length;
    const milestones = [{ label: `שוטים עם רפרנס מאושר (${covered}/${shots.length})`, done: shots.length > 0 && covered === shots.length }];
    if (!storyboard || shots.length === 0) {
      set('references', { status: 'not_started', detail: 'ממתין לסטורי בורד', milestones });
    } else if (covered === shots.length) {
      set('references', { status: 'completed', detail: 'לכל השוטים יש רפרנס מאושר', milestones });
    } else if (pending > 0) {
      set('references', { status: 'waiting_internal', detail: `${pending} רפרנסים ממתינים לבדיקה · ${covered}/${shots.length} שוטים מכוסים`, milestones });
      actions.push({ kind: 'approval', stage: 'references', label: `סקור ${pending} רפרנסים מועמדים`, tab: 'storyboard' });
    } else {
      set('references', {
        status: refs.length ? 'in_progress' : 'not_started',
        detail: `${covered}/${shots.length} שוטים עם רפרנס מאושר (הוספה ידנית — חיפוש אוטומטי ב-Phase 3)`,
        milestones,
      });
      actions.push({
        kind: 'task',
        stage: 'references',
        label: `הוסף רפרנסים ל-${shots.length - covered} שוטים`,
        tab: 'storyboard',
      });
    }
  }

  /* 05–09 — שלבים מתוכננים: מוצגים בכנות כ"טרם נבנה" */
  for (const def of STAGES.filter((s) => s.availability === 'planned')) {
    set(def.key, {
      status: 'not_started',
      detail: `טרם נבנה במערכת (Phase ${def.phase}) — בינתיים עבודה ידנית מחוץ למערכת`,
      milestones: [{ label: 'השלב הושלם', done: false }],
    });
  }

  /* חסמים ידניים חוסמים את השלב שלהם */
  for (const b of blockers) {
    if (b.source === 'manual') {
      const st = stages[b.stage];
      st.status = 'blocked';
      st.blockedReason = b.reason;
      st.detail = `חסום: ${b.reason}`;
    }
    derivedBlockers.unshift({ stage: b.stage, reason: b.reason, source: b.source, id: b.id });
  }
  if (project.pipelineState === 'stopped') {
    derivedBlockers.unshift({ stage: 'brief', reason: 'ה-Pipeline נעצר ידנית', source: 'pipeline' });
  }
  if (paused) {
    actions.unshift({ kind: 'task', stage: 'brief', label: 'ה-Pipeline מושהה — הפעל מחדש כדי שמשימות ירוצו', tab: 'overview' });
  }

  const ordered = STAGES.map((d) => stages[d.key]);
  const all = ordered.flatMap((s) => s.milestones);
  const progress = all.length ? Math.round((all.filter((m) => m.done).length / all.length) * 100) : 0;
  const currentIdx = ordered.findIndex((s) => s.status !== 'completed');
  const current = currentIdx === -1 ? ordered[ordered.length - 1] : ordered[currentIdx];

  let overallStatus: Status;
  if (currentIdx === -1) overallStatus = 'completed';
  else if (project.pipelineState === 'stopped' || ordered.some((s) => s.status === 'blocked')) overallStatus = 'blocked';
  else if (current.status === 'not_started') overallStatus = currentIdx === 0 ? 'not_started' : 'in_progress';
  else overallStatus = current.status;

  const stageOrder = (k: StageKey) => STAGES.findIndex((s) => s.key === k);
  actions.sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage));
  let nextAction: ActionItem | null =
    actions.find((a) => a.kind === 'fix') ?? actions.find((a) => a.stage === current.key) ?? actions[0] ?? null;
  if (!nextAction && current.availability === 'planned') {
    nextAction = {
      kind: 'task',
      stage: current.key,
      label: `שלב "${STAGES[currentIdx].label}" טרם נבנה — המשך ידנית עם חבילת הפרומפטים`,
      tab: 'storyboard',
    };
  }

  return {
    stages: ordered,
    currentStage: current.key,
    overallStatus,
    progress,
    nextAction,
    myActions: actions,
    blockers: derivedBlockers,
    pipelineState: project.pipelineState,
    briefValidation: bv,
    lastActivityAt: input.lastActivityAt,
  };
}

export const TAB_FOR_STAGE = TAB;
