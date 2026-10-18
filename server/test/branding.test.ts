import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { REPO_ROOT } from '../src/config.js';
import { listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { brandStatus, imageSize, saveGenesisLogo } from '../src/services/branding.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

const PNG = fs.readFileSync(path.join(REPO_ROOT, 'web', 'public', 'icons', 'icon-192.png'));

async function wordXml(brand?: 'genesis' | 'studio', withLogo = false) {
  const ctx = makeCtx();
  const p = projectWithBrief(ctx);
  if (brand) cmd.updateProject(ctx, p.id, { settings: { brand } } as any);
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  if (withLogo) saveGenesisLogo(ctx, PNG);
  const v = listScripts(ctx.db, p.id)[0];
  const app = await buildApp(ctx);
  const r = await app.inject({ url: `/api/scripts/${v.id}/docx` });
  await app.close();
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(r.rawPayload);
  return { xml: await zip.file('word/document.xml')!.async('string'), media: Object.keys(zip.files).filter((f) => f.startsWith('word/media/') && !zip.files[f].dir) };
}

describe('Branding of client files', { timeout: 30_000 }, () => {
  it('reads logo dimensions', () => {
    expect(imageSize(PNG)).toEqual({ type: 'png', width: 192, height: 192 });
    expect(imageSize(Buffer.from('not an image'))).toBeNull();
  });

  it('new projects are Genesis: GENESIS on top, no studio name or logo', async () => {
    const { xml, media } = await wordXml();
    expect(xml).toContain('GENESIS');
    expect(xml).toContain('Ohad Alfi');
    expect(xml).not.toContain('AI Production Studio');
    expect(media).toHaveLength(0);
  });

  it('uses the uploaded Genesis logo', async () => {
    const { xml, media } = await wordXml('genesis', true);
    expect(media).toHaveLength(1);
    expect(xml).not.toContain('>GENESIS<');
  });

  it('studio projects keep the original studio branding', async () => {
    const { xml, media } = await wordXml('studio', true);
    expect(xml).toContain('Ohad Alfi · AI Production Studio');
    expect(xml).not.toContain('GENESIS');
    expect(media).toHaveLength(1);
  });

  it('rejects a logo that is not an image', () => {
    const ctx = makeCtx();
    expect(() => saveGenesisLogo(ctx, Buffer.from('hello'))).toThrow('PNG');
    expect(brandStatus(ctx).genesisLogo).toBeNull();
  });
});
