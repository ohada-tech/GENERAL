import { describe, expect, it } from 'vitest';
import { currentStoryboard, getProject, listJobs, listScripts, listShots } from '../src/db/repo.js';
import { projectState } from '../src/services/views.js';
import { importProjects } from '../src/workflow/import.js';
import { makeCtx, FULL_BRIEF } from './helpers.js';

describe('Import existing projects', () => {
  it('imports at the real stage without starting AI or paid jobs, and skips duplicates', () => {
    const ctx = makeCtx();
    const input = {
      projects: [
        { name: 'רק אפיון', clientName: 'A', brief: { videoType: 'פרסומת' } },
        {
          name: 'תסריט אושר',
          clientName: 'B',
          brief: FULL_BRIEF,
          briefCompleted: true,
          script: { title: 'T', scenes: [{ narration: 'שלום', estDurationSec: 4 }], status: 'client_approved', approvedBy: 'טל' },
          storyboard: { shots: [{ action: 'שוט 1', durationSec: 4 }, { action: 'שוט 2', durationSec: 3 }], approved: false, approvedShots: [1] },
          statusNote: 'ממתין לאישור סטורי בורד',
        },
      ],
    };
    const r = importProjects(ctx, input);
    expect(r.imported).toBe(2);
    const id = r.results[1].id!;
    expect(listJobs(ctx.db, id)).toHaveLength(0); // לא הופעלה כתיבה אוטומטית
    expect(listScripts(ctx.db, id)[0].status).toBe('client_approved');
    const sb = currentStoryboard(ctx.db, id)!;
    expect(listShots(ctx.db, sb.id).map((s) => s.approval)).toEqual(['approved', 'pending']);
    const st = projectState(ctx, getProject(ctx.db, id)!);
    expect(st.currentStage).toBe('storyboard');
    expect(importProjects(ctx, input).imported).toBe(0); // ייבוא חוזר לא מכפיל
  });
});
