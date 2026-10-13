/**
 * התחברות בסיסמה אחת (מערכת אישית). סשן = עוגייה חתומה (HMAC) — אין מידע רגיש בעוגייה.
 * כל /api דורש התחברות, חוץ מ-/api/auth/*. כשאין סיסמה מוגדרת ההתחברות כבויה —
 * מותר רק כשהשרת מאזין למחשב המקומי בלבד (נאכף ב-index.ts).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from './config.js';

const COOKIE = 'apos_session';
const MAX_AGE_SEC = 30 * 24 * 3600;

function secretFor(config: Config) {
  if (config.auth.sessionSecret) return config.auth.sessionSecret;
  // סוד אקראי שנשמר פעם אחת בתיקיית הנתונים (בענן: דיסק קבוע)
  const file = path.join(config.dataDir, 'session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}

const sign = (secret: string, payload: string) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

function makeToken(secret: string, now: number) {
  const payload = Buffer.from(JSON.stringify({ exp: now + MAX_AGE_SEC * 1000 })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

function validToken(secret: string, token: string | undefined, now: number) {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(secret, payload);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > now;
  } catch {
    return false;
  }
}

function readCookie(req: FastifyRequest, name: string) {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

const samePassword = (a: string, b: string) => {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

/* ---------- מפתח גישה ל-Claude (מפעיל): Bearer token, נשמר רק כ-hash ---------- */
const opFile = (config: Config) => path.join(config.dataDir, 'operator-token.json');
const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

interface OperatorToken {
  hash: string;
  last4: string;
  createdAt: string;
}

function readOperator(config: Config): OperatorToken | null {
  try {
    return JSON.parse(fs.readFileSync(opFile(config), 'utf8')) as OperatorToken;
  } catch {
    return null;
  }
}

export function operatorStatus(config: Config) {
  const t = readOperator(config);
  return t ? { active: true, last4: t.last4, createdAt: t.createdAt } : { active: false, last4: null, createdAt: null };
}

/** יוצר מפתח חדש (מחליף קודם). הערך המלא מוחזר פעם אחת בלבד. */
export function createOperatorToken(config: Config) {
  const token = `apos_${crypto.randomBytes(24).toString('base64url')}`;
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(opFile(config), JSON.stringify({ hash: sha(token), last4: token.slice(-4), createdAt: new Date().toISOString() }), { mode: 0o600 });
  return { token, ...operatorStatus(config) };
}

export function revokeOperatorToken(config: Config) {
  fs.rmSync(opFile(config), { force: true });
  return operatorStatus(config);
}

function validBearer(config: Config, req: FastifyRequest) {
  const h = String(req.headers.authorization ?? '');
  if (!h.startsWith('Bearer apos_')) return false;
  const t = readOperator(config);
  if (!t) return false;
  const a = Buffer.from(sha(h.slice(7)));
  const b = Buffer.from(t.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function registerAuth(app: FastifyInstance, config: Config) {
  const enabled = Boolean(config.auth.password);
  const secret = enabled ? secretFor(config) : '';
  const attempts = new Map<string, { n: number; until: number }>();

  const isAuthed = (req: FastifyRequest) =>
    !enabled || validToken(secret, readCookie(req, COOKIE), Date.now()) || validBearer(config, req);

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/') || url.startsWith('/api/auth/')) return;
    if (!isAuthed(req)) return reply.code(401).send({ error: 'נדרשת התחברות' });
  });

  app.get('/api/auth/me', async (req) => ({ authRequired: enabled, authenticated: isAuthed(req) }));

  app.post('/api/auth/login', async (req, reply) => {
    if (!enabled) return { ok: true };
    const ip = String(req.headers['x-forwarded-for'] ?? req.ip).split(',')[0].trim();
    const now = Date.now();
    const a = attempts.get(ip);
    if (a && a.n >= 8 && a.until > now) {
      return reply.code(429).send({ error: `יותר מדי ניסיונות. נסה שוב בעוד ${Math.ceil((a.until - now) / 60000)} דקות.` });
    }
    const password = String(((req.body ?? {}) as { password?: string }).password ?? '');
    if (!samePassword(password, config.auth.password)) {
      const next = { n: (a && a.until > now ? a.n : 0) + 1, until: now + 15 * 60_000 };
      attempts.set(ip, next);
      return reply.code(401).send({ error: 'סיסמה שגויה' });
    }
    attempts.delete(ip);
    const secure = String(req.headers['x-forwarded-proto'] ?? req.protocol) === 'https';
    reply.header(
      'Set-Cookie',
      `${COOKIE}=${makeToken(secret, now)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure ? '; Secure' : ''}`,
    );
    return { ok: true };
  });

  app.get('/api/settings/operator-token', async () => operatorStatus(config));
  app.post('/api/settings/operator-token', async () => createOperatorToken(config));
  app.delete('/api/settings/operator-token', async () => revokeOperatorToken(config));

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return { ok: true };
  });
}
