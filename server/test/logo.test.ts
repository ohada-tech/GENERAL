import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { dashboard } from '../src/services/views.js';
import { autoLogo, hideLogo, logoCandidates } from '../src/services/logo.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(400, 1)]);

function multipart(file: { name: string; type: string; body: Buffer }) {
  const b = '----x';
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`),
    file.body,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

describe('הלוגו של הלקוח על כרטיס הפרויקט', () => {
  it('לוגו שהועלה גובר על הפריים, ומוצג גם בפרויקט אחר של אותו לקוח', async () => {
    const ctx = makeCtx();
    const p1 = cmd.createProject(ctx, { name: 'סרטון תדמית', clientName: 'MoveUp' });
    const p2 = cmd.createProject(ctx, { name: 'ריל', clientName: 'moveup ' });
    const p3 = cmd.createProject(ctx, { name: 'אחר', clientName: 'לקוח אחר' });
    const app = await buildApp(ctx);
    const bad = await app.inject({ method: 'POST', url: `/api/projects/${p1.id}/assets?kind=logo`, ...multipart({ name: 'a.txt', type: 'text/plain', body: Buffer.from('hello') }) });
    expect(bad.statusCode).toBe(400);
    const up = await app.inject({ method: 'POST', url: `/api/projects/${p1.id}/assets?kind=logo`, ...multipart({ name: 'logo.png', type: 'image/png', body: PNG }) });
    expect(up.statusCode).toBe(201);
    const byId = Object.fromEntries(dashboard(ctx).projects.map((p) => [p.id, p]));
    expect(byId[p1.id]!.cover).toEqual({ assetId: up.json().id, logo: true });
    expect(byId[p2.id]!.cover).toEqual({ assetId: up.json().id, logo: true });
    expect(byId[p3.id]!.cover ?? null).toBeNull();
    const detail = await app.inject({ url: `/api/projects/${p2.id}` });
    expect(detail.json().cover.logo).toBe(true);
  });

  it('מוצא לוגו באתר: JSON-LD, תמונה שמסומנת כלוגו, ואייקון גדול', () => {
    const html = `<html><head><link rel="icon" href="/fav.ico" sizes="16x16"><link rel="apple-touch-icon" href="/apple.png">
      <script type="application/ld+json">{"@type":"Organization","logo":{"@type":"ImageObject","url":"https:\/\/cdn.example.com\/org-logo.png"}}</script></head>
      <body><header><img class="site-logo" src="/img/logo.svg"></header><img src="/hero.jpg"></body></html>`;
    expect(logoCandidates(html, 'https://example.com/')).toEqual([
      'https://cdn.example.com/org-logo.png',
      'https://example.com/img/logo.svg',
      'https://example.com/apple.png',
    ]);
  });

  it('מביא את הלוגו מהאתר פעם אחת ושומר אותו כלוגו של הפרויקט', async () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'סרטון', clientName: 'אתרי' });
    cmd.updateBrief(ctx, p.id, { website: 'https://shop.example.com' });
    expect(dashboard(ctx).projects[0]!.logoAuto).toBe(true);
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      if (url === 'https://shop.example.com/') return new Response('<img id="logo" src="/l.png">', { headers: { 'content-type': 'text/html' } });
      if (url === 'https://shop.example.com/l.png') return new Response(PNG, { headers: { 'content-type': 'image/png' } });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const id = await autoLogo(ctx, p.id, { fetcher });
    expect(id).toBeTruthy();
    expect(calls).toEqual(['https://shop.example.com/', 'https://shop.example.com/l.png']);
    const s = dashboard(ctx).projects[0]!;
    expect(s.cover).toEqual({ assetId: id, logo: true });
    expect(s.logoAuto).toBe(false);
  });

  it('אתר בלי לוגו — לא מנסים שוב (אלא בלחיצה), והכרטיס נשאר עם התמונה מהסרטון', async () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'סרטון', clientName: 'בלי לוגו' });
    cmd.updateBrief(ctx, p.id, { website: 'https://nologo.example.com' });
    let n = 0;
    const fetcher = (async () => {
      n++;
      return new Response('<p>שלום</p>', { headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
    expect(await autoLogo(ctx, p.id, { fetcher })).toBeNull();
    expect(await autoLogo(ctx, p.id, { fetcher })).toBeNull();
    expect(n).toBe(1);
    expect(dashboard(ctx).projects[0]!.logoAuto).toBe(false);
    await autoLogo(ctx, p.id, { fetcher, force: true });
    expect(n).toBe(2);
  });

  it('לוגו של שותף באתר לא נבחר: הלוגו שמקשר לדף הבית קודם, וקרוסלת לקוחות מדולגת', () => {
    const html = `<section><div class="elementor-widget-container"><img src="/up/Israbar_logo_white.svg" alt=""></div></section>
      <div class="clients-carousel"><img src="/up/other-logo.png"></div>
      <div class="elementor-widget-container"><a href="https://techdin.co.il"><img src="/up/logocolor.svg" alt=""></a></div>
      <link rel="apple-touch-icon" href="/icon.png">`;
    const c = logoCandidates(html, 'https://techdin.co.il/techdinone');
    expect(c[0]).toBe('https://techdin.co.il/up/logocolor.svg');
    expect(c).not.toContain('https://techdin.co.il/up/other-logo.png');
    expect(c.indexOf('https://techdin.co.il/up/Israbar_logo_white.svg')).toBeGreaterThan(c.indexOf('https://techdin.co.il/icon.png'));
  });

  it('"זה לא הלוגו": יורד מכל הפרויקטים של הלקוח, לא מובא שוב אוטומטית, ובניסיון ידני מדלגים עליו', async () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'א', clientName: 'Client X' });
    const p2 = cmd.createProject(ctx, { name: 'ב', clientName: 'client x' });
    cmd.updateBrief(ctx, p.id, { website: 'https://x.example.com' });
    const fetcher = (async (url: string) => {
      if (url === 'https://x.example.com/') return new Response('<header><img class="logo" src="/wrong.png"></header><a href="/"><img alt="x logo" src="/right.png"></a>', { headers: { 'content-type': 'text/html' } });
      return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    }) as unknown as typeof fetch;
    const first = await autoLogo(ctx, p.id, { fetcher });
    expect(ctx.db.prepare('SELECT filename FROM assets WHERE id = ?').get(first) as any).toEqual({ filename: 'right.png' });
    expect(hideLogo(ctx, p2.id)).toBe(1);
    const byId = () => Object.fromEntries(dashboard(ctx).projects.map((x) => [x.id, x]));
    expect(byId()[p.id]!.cover ?? null).toBeNull();
    expect(byId()[p2.id]!.cover ?? null).toBeNull();
    expect(byId()[p.id]!.logoAuto).toBe(false);
    const second = await autoLogo(ctx, p.id, { fetcher, force: true });
    expect(ctx.db.prepare('SELECT filename FROM assets WHERE id = ?').get(second) as any).toEqual({ filename: 'wrong.png' });
  });
});
