import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeCtx, projectWithBrief } from './helpers.js';

function multipart(fields: Record<string, string>, files: Record<string, { name: string; type: string; body: string | Buffer }>) {
  const boundary = '----pe' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const [k, f] of Object.entries(files)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`));
    chunks.push(Buffer.isBuffer(f.body) ? f.body : Buffer.from(f.body));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('PHOTOEDIT documents', () => {
  it('saves a layered document, lists it under the project, reopens it unchanged, updates and deletes it', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    const app = await buildApp(ctx);
    const doc = JSON.stringify({ format: 'photoedit', version: 1, width: 1080, height: 1350, layers: [{ id: 'l1', type: 'text', text: 'שלום עולם' }] });
    const save = await app.inject({ method: 'POST', url: '/api/photoedit/docs', ...multipart({ name: 'מודעה 1', projectId: p.id, width: '1080', height: '1350' }, { doc: { name: 'doc.json', type: 'application/json', body: doc }, thumb: { name: 't.png', type: 'image/png', body: Buffer.from([137, 80, 78, 71]) } }) });
    expect(save.statusCode).toBe(201);
    const saved = save.json();
    expect(saved).toMatchObject({ name: 'מודעה 1', projectId: p.id, width: 1080, height: 1350 });

    const list = (await app.inject({ url: `/api/photoedit/docs?projectId=${p.id}` })).json();
    expect(list.docs.map((d: { id: string }) => d.id)).toEqual([saved.id]);
    const back = await app.inject({ url: `/api/photoedit/docs/${saved.id}` });
    expect(back.json().layers[0].text).toBe('שלום עולם');
    expect((await app.inject({ url: `/api/photoedit/docs/${saved.id}/thumb` })).statusCode).toBe(200);

    const again = await app.inject({ method: 'POST', url: '/api/photoedit/docs', ...multipart({ id: saved.id, name: 'מודעה 1 סופית', width: '1080', height: '1080' }, { doc: { name: 'doc.json', type: 'application/json', body: doc } }) });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id: saved.id, name: 'מודעה 1 סופית', height: 1080, projectId: p.id });

    const bad = await app.inject({ method: 'POST', url: '/api/photoedit/docs', ...multipart({ name: 'x' }, { doc: { name: 'doc.json', type: 'application/json', body: '{"format":"other"}' } }) });
    expect(bad.statusCode).toBe(400);

    expect((await app.inject({ method: 'DELETE', url: `/api/photoedit/docs/${saved.id}` })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/photoedit/docs/${saved.id}` })).statusCode).toBe(404);
    await app.close();
  });

  it('lists the project images available to pull into the editor', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    const app = await buildApp(ctx);
    const up = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/assets?kind=photoedit`, ...multipart({}, { file: { name: 'ad.png', type: 'image/png', body: Buffer.from([137, 80, 78, 71]) } }) });
    expect(up.statusCode).toBe(201);
    const src = (await app.inject({ url: `/api/photoedit/sources/${p.id}` })).json();
    expect(src.images).toEqual([expect.objectContaining({ label: 'ad.png', group: 'PHOTOEDIT', url: `/api/assets/${up.json().id}/file` })]);
    await app.close();
  });
});
