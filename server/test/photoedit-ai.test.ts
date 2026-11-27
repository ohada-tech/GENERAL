import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { fillPrompt } from '../src/api/photoedit-ai.js';
import { makeCtx } from './helpers.js';

function multipart(fields: Record<string, string>, files: Record<string, Buffer>) {
  const boundary = '----ai' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const [k, b] of Object.entries(files)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"; filename="${k}.png"\r\nContent-Type: image/png\r\n\r\n`), b, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const until = async (f: () => Promise<boolean>) => { for (let i = 0; i < 100 && !(await f()); i++) await new Promise((r) => setTimeout(r, 10)); };

afterEach(() => vi.unstubAllGlobals());

describe('PHOTOEDIT Generative Fill', () => {
  it('runs an OpenAI masked edit and serves the results', async () => {
    const calls: Array<{ url: string; body: FormData }> = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: FormData }) => {
      calls.push({ url, body: init.body });
      return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }, { b64_json: PNG.toString('base64') }] }), { status: 200 });
    });
    const ctx = makeCtx();
    ctx.config.openai.apiKey = 'sk-test';
    const app = await buildApp(ctx);
    expect((await app.inject({ url: '/api/photoedit/ai/engines' })).json().openai.ready).toBe(true);
    const res = await app.inject({ method: 'POST', url: '/api/photoedit/ai/fill', ...multipart({ engine: 'openai', prompt: 'כוס קפה', n: '2', size: '1536x1024', quality: 'medium' }, { image: PNG, mask: PNG }) });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    await until(async () => (await app.inject({ url: `/api/photoedit/ai/jobs/${id}` })).json().status === 'done');
    const job = (await app.inject({ url: `/api/photoedit/ai/jobs/${id}` })).json();
    expect(job).toMatchObject({ status: 'done', engine: 'openai', outputs: [`/api/photoedit/ai/jobs/${id}/out-0.png`, `/api/photoedit/ai/jobs/${id}/out-1.png`] });
    expect(calls[0].url).toMatch(/\/images\/edits$/);
    expect(calls[0].body.get('size')).toBe('1536x1024');
    expect(String(calls[0].body.get('prompt'))).toContain('כוס קפה');
    expect(calls[0].body.get('mask')).toBeTruthy();
    expect((await app.inject({ url: job.outputs[1] })).statusCode).toBe(200);
    await app.close();
  });

  it('reports a quota error from OpenAI in Hebrew', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'You exceeded your current quota' } }), { status: 429 }));
    const ctx = makeCtx();
    ctx.config.openai.apiKey = 'sk-test';
    const app = await buildApp(ctx);
    const id = (await app.inject({ method: 'POST', url: '/api/photoedit/ai/fill', ...multipart({ engine: 'openai', prompt: '' }, { image: PNG, mask: PNG }) })).json().id;
    await until(async () => (await app.inject({ url: `/api/photoedit/ai/jobs/${id}` })).json().status === 'failed');
    expect((await app.inject({ url: `/api/photoedit/ai/jobs/${id}` })).json().error).toContain('אין קרדיט');
    await app.close();
  });

  it('queues a Higgsfield job for the local worker, which reports the result', async () => {
    vi.stubGlobal('fetch', async () => new Response(PNG, { status: 200 }));
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    expect((await app.inject({ method: 'POST', url: '/api/photoedit/ai/fill', ...multipart({ engine: 'openai' }, { image: PNG, mask: PNG }) })).statusCode).toBe(409);
    const res = await app.inject({ method: 'POST', url: '/api/photoedit/ai/fill', ...multipart({ engine: 'higgsfield', prompt: 'עציץ', aspect: '4:5' }, { image: PNG, hint: PNG }) });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'queued', cost: '2 קרדיטים ($0.08)' });
    const next = await app.inject({ url: '/api/photoedit/ai/next' });
    expect(next.json()).toMatchObject({ job: 'nano_banana_pro', params: { aspect_ratio: '4:5', resolution: '2k' }, n: 1 });
    expect(next.json().images).toHaveLength(2);
    expect(next.json().prompt).toContain('עציץ');
    expect((await app.inject({ url: '/api/photoedit/ai/next' })).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/photoedit/ai/engines' })).json().higgsfield.ready).toBe(true);
    const done = await app.inject({ method: 'POST', url: `/api/photoedit/ai/jobs/${next.json().id}/report`, payload: { urls: ['https://cdn.example/out.png'] } });
    expect(done.json()).toMatchObject({ status: 'done', outputs: [expect.stringContaining('out-0.png')] });
    await app.close();
  });

  it('an empty prompt asks to remove and fill from the surroundings', () => {
    expect(fillPrompt('openai', '  ')).toMatch(/Remove whatever is inside/);
    expect(fillPrompt('higgsfield', '')).toMatch(/remove whatever is inside that region/);
  });
});
