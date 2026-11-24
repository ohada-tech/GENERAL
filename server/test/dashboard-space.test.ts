import { describe, expect, it } from 'vitest';
import * as cmd from '../src/workflow/commands.js';
import { dashboard } from '../src/services/views.js';
import { makeCtx } from './helpers.js';

describe('דשבורד — הפרדה GNSS / OA', () => {
  it('כל פרויקט בדשבורד מגיע עם השיוך שלו, והחלפה מהכרטיס נשמרת', () => {
    const ctx = makeCtx();
    const g = cmd.createProject(ctx, { name: 'G', clientName: 'A' });
    const s = cmd.createProject(ctx, { name: 'S', clientName: 'B', settings: { brand: 'studio' } });
    const brands = () => Object.fromEntries(dashboard(ctx).projects.map((p) => [p.id, p.brand]));
    expect(brands()).toEqual({ [g.id]: 'genesis', [s.id]: 'studio' });

    cmd.updateProject(ctx, g.id, { settings: { brand: 'studio' } });
    expect(brands()[g.id]).toBe('studio');
  });
});
