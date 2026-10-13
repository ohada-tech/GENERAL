/**
 * "שרת" בתוך הדפדפן: ממשק דמוי-Fastify שעליו נרשמים אותם נתיבי /api של השרת
 * (server/src/api/routes.ts), ו-fetch shim שמנתב אליו בקשות /api/* בלי רשת.
 */
import { ZodError } from 'zod';
import { GateError } from '../../../server/src/context';

type Handler = (req: Req, reply: Reply) => unknown;

export interface Req {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  url: string;
  file: () => Promise<{ filename: string; mimetype: string; blob: File } | undefined>;
}

class Reply {
  statusCode = 200;
  payload: unknown = undefined;
  sent = false;
  code(n: number) {
    this.statusCode = n;
    return this;
  }
  header() {
    return this;
  }
  send(v: unknown) {
    this.payload = v;
    this.sent = true;
    return this;
  }
}

interface Route {
  method: string;
  path: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

export class MiniApp {
  private routes: Route[] = [];

  private add(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp(
      '^' + path.replace(/:([A-Za-z_]+)/g, (_m, k) => (keys.push(k), '([^/]+)')).replace(/\//g, '\\/') + '$',
    );
    // רישום מחדש של אותו נתיב מחליף את הקודם (כך דורסים נתיבים שתלויים בדיסק)
    const i = this.routes.findIndex((r) => r.method === method && r.path === path);
    const route = { method, path, re, keys, handler };
    if (i >= 0) this.routes[i] = route;
    else this.routes.push(route);
  }
  get = (p: string, h: Handler) => this.add('GET', p, h);
  post = (p: string, h: Handler) => this.add('POST', p, h);
  put = (p: string, h: Handler) => this.add('PUT', p, h);
  patch = (p: string, h: Handler) => this.add('PATCH', p, h);
  delete = (p: string, h: Handler) => this.add('DELETE', p, h);

  async handle(method: string, url: URL, body: BodyInit | null | undefined): Promise<Response> {
    const route = this.routes.find((r) => r.method === method && r.re.test(url.pathname));
    if (!route) return jsonResponse(404, { error: 'לא נמצא' });
    const m = route.re.exec(url.pathname)!;
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    let parsed: unknown = {};
    if (typeof body === 'string' && body.trim()) {
      try {
        parsed = JSON.parse(body);
      } catch {
        return jsonResponse(400, { error: 'JSON לא תקין' });
      }
    }
    const req: Req = {
      params,
      query: Object.fromEntries(url.searchParams),
      body: parsed,
      url: url.pathname + url.search,
      file: async () => {
        if (!(body instanceof FormData)) return undefined;
        const f = body.get('file');
        if (!(f instanceof File)) return undefined;
        return { filename: f.name, mimetype: f.type || 'application/octet-stream', blob: f };
      },
    };
    const reply = new Reply();
    try {
      const out = await route.handler(req, reply);
      const payload = reply.sent ? reply.payload : out;
      if (reply.statusCode === 204 || payload === undefined) return new Response(null, { status: reply.statusCode === 200 ? 204 : reply.statusCode });
      return jsonResponse(reply.statusCode, payload);
    } catch (err) {
      if (err instanceof ZodError) {
        return jsonResponse(400, {
          error: 'נתונים לא תקינים',
          details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }
      if (err instanceof GateError) return jsonResponse(err.statusCode, { error: err.message });
      const e = err as { statusCode?: number; message?: string };
      const status = e.statusCode ?? 500;
      if (status >= 500) console.error(err);
      return jsonResponse(status, { error: status >= 500 ? `שגיאה: ${e.message}` : e.message });
    }
  }
}

const jsonResponse = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export function installFetchShim(app: MiniApp) {
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      return app.handle((init?.method ?? 'GET').toUpperCase(), url, init?.body);
    }
    return original(input, init);
  };
}
