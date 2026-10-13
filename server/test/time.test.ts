import { estimateActiveSeconds, formatDuration } from '@apos/shared';
import { describe, expect, it } from 'vitest';
import * as time from '../src/services/time.js';
import { dashboard } from '../src/services/views.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx } from './helpers.js';

describe('estimateActiveSeconds', () => {
  it('groups close actions into sessions and adds a floor per session', () => {
    const t = (min: number) => new Date(Date.UTC(2026, 0, 1, 10, min)).toISOString();
    expect(estimateActiveSeconds([])).toBe(0);
    // פעולה בודדת = 5 דקות
    expect(estimateActiveSeconds([t(0)])).toBe(5 * 60);
    // 0,10,15 = סשן אחד של 15 דק' + 5
    expect(estimateActiveSeconds([t(0), t(10), t(15)])).toBe(20 * 60);
    // פער של 40 דק' פותח סשן חדש: (5+5) + (0+5)
    expect(estimateActiveSeconds([t(0), t(5), t(45)])).toBe(15 * 60);
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0 ד׳');
    expect(formatDuration(59)).toBe('<1 ד׳');
    expect(formatDuration(12 * 60)).toBe('12 ד׳');
    expect(formatDuration(3725)).toBe('1:02 ש׳');
  });
});

describe('Time tracking', () => {
  it('timer start/stop records the elapsed time', () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'A', clientName: '' });
    time.startTimer(ctx, p.id, { stage: 'script', note: 'כתיבה' });
    ctx.advance(25 * 60);
    expect(time.timeSummary(ctx, p.id).running?.durationSec).toBe(25 * 60);
    const e = time.stopTimer(ctx, 'סיימתי טיוטה');
    expect(e.durationSec).toBe(25 * 60);
    expect(e.note).toBe('סיימתי טיוטה');
    const s = time.timeSummary(ctx, p.id);
    expect(s.trackedSec).toBe(25 * 60);
    expect(s.byStage.script).toBe(25 * 60);
    expect(s.running).toBeNull();
    expect(() => time.stopTimer(ctx)).toThrow(/אין טיימר פעיל/);
  });

  it('only one timer runs: starting on another project stops the first', () => {
    const ctx = makeCtx();
    const a = cmd.createProject(ctx, { name: 'A', clientName: '' });
    const b = cmd.createProject(ctx, { name: 'B', clientName: '' });
    time.startTimer(ctx, a.id, { stage: 'brief' });
    ctx.advance(600);
    time.startTimer(ctx, b.id, { stage: 'brief' });
    ctx.advance(300);
    expect(time.runningTimer(ctx)?.projectId).toBe(b.id);
    expect(time.timeSummary(ctx, a.id).trackedSec).toBe(600);
    expect(time.timeSummary(ctx, b.id).trackedSec).toBe(300);
    // הפעלה חוזרת על אותו פרויקט ושלב לא פותחת רישום חדש
    time.startTimer(ctx, b.id, { stage: 'brief' });
    expect(time.listEntries(ctx, b.id)).toHaveLength(1);
  });

  it('manual entries: validation, edit and delete', () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'A', clientName: '' });
    const e = time.addManualEntry(ctx, p.id, { stage: 'storyboard', minutes: 90, note: 'Higgsfield' });
    expect(e.source).toBe('manual');
    expect(e.durationSec).toBe(90 * 60);
    expect(() => time.addManualEntry(ctx, p.id, { stage: 'storyboard', minutes: 0 })).toThrow();
    expect(() =>
      time.addManualEntry(ctx, p.id, { stage: 'storyboard', minutes: 30, startedAt: new Date(ctx.clock.t + 3600_000).toISOString() }),
    ).toThrow(/עתידי/);
    const u = time.updateEntry(ctx, e.id, { minutes: 60, stage: 'images' });
    expect(u.durationSec).toBe(3600);
    expect(time.timeSummary(ctx, p.id).byStage).toEqual({ images: 3600 });
    time.deleteEntry(ctx, e.id);
    expect(time.timeSummary(ctx, p.id).trackedSec).toBe(0);
  });

  it('cannot change duration of a running timer', () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'A', clientName: '' });
    const r = time.startTimer(ctx, p.id, { stage: 'brief' });
    expect(() => time.updateEntry(ctx, r.id, { minutes: 10 })).toThrow(/עצור אותו/);
    expect(time.updateEntry(ctx, r.id, { note: 'ok' }).note).toBe('ok');
  });

  it('estimate counts only the owner actions, separately from tracked time', () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'A', clientName: '' });
    ctx.advance(10 * 60);
    cmd.updateBrief(ctx, p.id, { goal: 'x' });
    const s = time.timeSummary(ctx, p.id);
    expect(s.trackedSec).toBe(0);
    expect(s.estimatedActiveSec).toBe(15 * 60);
  });

  it('dashboard shows per-project and weekly tracked totals', () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'A', clientName: '' });
    time.addManualEntry(ctx, p.id, { stage: 'script', minutes: 45 });
    time.startTimer(ctx, p.id, { stage: 'script' });
    ctx.advance(15 * 60);
    const d = dashboard(ctx);
    expect(d.projects[0].trackedSec).toBe(60 * 60);
    expect(d.weekTrackedSec).toBe(60 * 60);
  });

  it('warns once about a forgotten timer', () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'A', clientName: '' });
    time.startTimer(ctx, p.id, { stage: 'brief' });
    ctx.advance(9 * 3600);
    expect(time.checkForgottenTimer(ctx)).toBe(false);
    ctx.advance(2 * 3600);
    expect(time.checkForgottenTimer(ctx)).toBe(true);
    expect(time.checkForgottenTimer(ctx)).toBe(false);
  });
});
