/** מיגרציות לפי סדר. לעולם לא לשנות מיגרציה קיימת — רק להוסיף חדשה. */
export const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    client_name TEXT NOT NULL DEFAULT '',
    brief TEXT NOT NULL DEFAULT '{}',
    brief_completed_at TEXT,
    settings TEXT NOT NULL DEFAULT '{}',
    pipeline_state TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE script_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    parent_id TEXT,
    source TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    content TEXT NOT NULL,
    change_note TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (project_id, version)
  );

  CREATE TABLE storyboards (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    script_version_id TEXT NOT NULL REFERENCES script_versions(id),
    source TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    approved_at TEXT,
    approved_by TEXT,
    UNIQUE (project_id, version)
  );

  CREATE TABLE shots (
    id TEXT PRIMARY KEY,
    storyboard_id TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    fields TEXT NOT NULL,
    approval TEXT NOT NULL DEFAULT 'pending',
    revision_note TEXT NOT NULL DEFAULT '',
    preview_asset_id TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_shots_storyboard ON shots(storyboard_id, number);

  CREATE TABLE refs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'other',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'candidate',
    verification TEXT NOT NULL DEFAULT 'unverified',
    match_score REAL,
    quality_score REAL,
    rights_note TEXT NOT NULL DEFAULT '',
    origin TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_refs_shot ON refs(shot_id);

  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    decision TEXT NOT NULL,
    by TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_approvals_subject ON approvals(subject_type, subject_id);

  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    actor TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_events_project ON events(project_id, created_at);

  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    mode TEXT NOT NULL DEFAULT 'automatic',
    payload TEXT NOT NULL DEFAULT '{}',
    result TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    last_error TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    triggered_by TEXT,
    run_after TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    heartbeat_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_jobs_status ON jobs(status, run_after);

  CREATE TABLE job_attempts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    ok INTEGER,
    error TEXT
  );

  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    dedupe_key TEXT UNIQUE,
    read_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE blockers (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    reason TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    dedupe_key TEXT UNIQUE,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'file',
    created_at TEXT NOT NULL
  );
  `,
  /* v2 — מעקב זמן עבודה */ `
  CREATE TABLE time_entries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage TEXT NOT NULL DEFAULT 'brief',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'timer',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_time_project ON time_entries(project_id, started_at);
  -- לכל היותר טיימר אחד רץ בכל רגע
  CREATE UNIQUE INDEX idx_time_single_running ON time_entries((1)) WHERE ended_at IS NULL;
  `,
  /* v3 — הפקה אוטומטית (05–09): תוצרי מדיה ואישורי שלבים */ `
  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    shot_id TEXT REFERENCES shots(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'generating',
    provider TEXT NOT NULL DEFAULT 'kie',
    model TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    params TEXT NOT NULL DEFAULT '{}',
    asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
    duration_sec REAL,
    cost_credits REAL,
    error TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_media_project ON media(project_id, kind, created_at);
  CREATE INDEX idx_media_shot ON media(shot_id, kind, version);

  CREATE TABLE stage_gates (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    started_at TEXT,
    approved_at TEXT,
    approved_by TEXT,
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (project_id, stage)
  );
  `,
  /* v4 — למידה: הערות ואישורים → כללים שנכנסים לפרומפטים */ `
  CREATE TABLE feedback (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    client TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'revision',
    text TEXT NOT NULL,
    distilled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_feedback_pending ON feedback(distilled, created_at);

  CREATE TABLE lessons (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'global',
    area TEXT NOT NULL DEFAULT 'general',
    text TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'learned',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  /* v5 — ספר הידע: הסקילים שלימדת את Claude, מזוקקים להנחיות הפקה */ `
  CREATE TABLE skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    digest TEXT NOT NULL DEFAULT '',
    areas TEXT NOT NULL DEFAULT '[]',
    clients TEXT NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 50,
    active INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'claude',
    digest_status TEXT NOT NULL DEFAULT 'pending',
    digest_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  /* v6 — מספור גרסאות תסריט major.minor (v6.1 לשינוי קטן) */ `
  ALTER TABLE script_versions ADD COLUMN major INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE script_versions ADD COLUMN minor INTEGER NOT NULL DEFAULT 0;
  `,
  /* v7 — דגלים לתיקונים חד-פעמיים */ `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  /* v8 — צ'אט "שינויים במערכת": בקשות שלך ותשובות של Claude (המפתח) */ `
  CREATE TABLE dev_messages (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    attachments TEXT NOT NULL DEFAULT '[]',
    reply_to TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_dev_messages_created ON dev_messages(created_at);
  `,
  /* v9 — ייבוא הערות לקוח (Google Doc / Word / טקסט) ← תיקון תסריט */ `
  CREATE TABLE client_feedback (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    base_version_id TEXT NOT NULL,
    result_version_id TEXT,
    source TEXT NOT NULL,
    source_name TEXT NOT NULL DEFAULT '',
    detected_label TEXT,
    items TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_client_feedback_project ON client_feedback(project_id, created_at);
  `,
  /* v10 — תרגום תסריט לתצוגה (נשמר לפי גרסה ושפה) */ `
  CREATE TABLE script_translations (
    version_id TEXT NOT NULL,
    lang TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (version_id, lang)
  );
  `,
  /* v11 — מחיקת גרסת תסריט = הסתרה (ניתן לשחזר; ההיסטוריה וההפניות נשמרות) */ `
  ALTER TABLE script_versions ADD COLUMN deleted_at TEXT;
  `,
  /* v12 — דעה של ChatGPT על הערות הלקוח, לפני שמשנים את התסריט (JSON) */ `
  ALTER TABLE client_feedback ADD COLUMN review TEXT;
  `,
  /* v13 — שיחות עם הלקוח: הקלטה ← תמלול (Scribe) ← הערות לתסריט */ `
  CREATE TABLE client_calls (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    duration_sec REAL NOT NULL DEFAULT 0,
    transcript TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_client_calls_project ON client_calls(project_id, created_at);
  ALTER TABLE client_feedback ADD COLUMN call_id TEXT;
  `,
  /* v14 — "שלח ללקוח": קישור פרטי לתסריט (בלי התחברות), עם מעקב צפיות */ `
  CREATE TABLE share_links (
    token TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    script_version_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    lang TEXT,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    view_count INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TEXT
  );
  CREATE INDEX idx_share_links_version ON share_links(script_version_id, created_at);
  CREATE INDEX idx_share_links_project ON share_links(project_id, created_at);
  `,
];
