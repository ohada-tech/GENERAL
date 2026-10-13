/**
 * מפתח OpenAI שהוזן מתוך הממשק נשמר בשרת בלבד, בקובץ data/secrets.json
 * (התיקייה data מוחרגת מ-Git). המפתח לעולם לא מוחזר לדפדפן — רק 4 התווים האחרונים.
 * מפתח שהוזן בממשק גובר על OPENAI_API_KEY שב-.env.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../context.js';
import type { Config } from '../config.js';
import type { OpenAITextProvider } from '../providers/openai.js';

interface SecretsFile {
  openaiApiKey?: string;
  openaiModel?: string;
}

export interface OpenAIStatus {
  configured: boolean;
  source: 'ui' | 'env' | null;
  last4: string | null;
  model: string;
  verified: boolean | null;
  verifiedAt: string | null;
  lastError: string | null;
}

const file = (config: Config) => path.join(config.dataDir, 'secrets.json');

const envDefaults = { apiKey: '', model: '' };
const status: Pick<OpenAIStatus, 'verified' | 'verifiedAt' | 'lastError'> = { verified: null, verifiedAt: null, lastError: null };
let source: OpenAIStatus['source'] = null;

function readFile(config: Config): SecretsFile {
  try {
    return JSON.parse(fs.readFileSync(file(config), 'utf8')) as SecretsFile;
  } catch {
    return {};
  }
}

function writeFile(config: Config, data: SecretsFile) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file(config), JSON.stringify(data, null, 2), { mode: 0o600 });
}

/** בהפעלה: טוען מפתח שנשמר מהממשק (אם יש) מעל ערכי .env. */
export function loadSecrets(config: Config) {
  envDefaults.apiKey = config.openai.apiKey;
  envDefaults.model = config.openai.model;
  const s = readFile(config);
  if (s.openaiApiKey) {
    config.openai.apiKey = s.openaiApiKey;
    source = 'ui';
  } else {
    source = config.openai.apiKey ? 'env' : null;
  }
  if (s.openaiModel) config.openai.model = s.openaiModel;
}

export function openaiStatus(config: Config): OpenAIStatus {
  const key = config.openai.apiKey;
  return {
    configured: Boolean(key),
    source: key ? source : null,
    last4: key ? key.slice(-4) : null,
    model: config.openai.model,
    ...status,
  };
}

function provider(ctx: Ctx) {
  return ctx.providers.text.openai as unknown as OpenAITextProvider;
}

/** בודק את המפתח הנוכחי מול OpenAI ומעדכן את הסטטוס. */
export async function testOpenAI(ctx: Ctx) {
  const p = provider(ctx);
  if (typeof p.verify !== 'function') return openaiStatus(ctx.config);
  const r = await p.verify();
  status.verified = r.ok;
  status.verifiedAt = ctx.now().toISOString();
  status.lastError = r.ok ? null : r.message;
  return openaiStatus(ctx.config);
}

/**
 * שמירת מפתח/מודל מהממשק. המפתח נבדק מול OpenAI לפני השמירה —
 * מפתח לא תקף לא נשמר ולא מחליף מפתח קיים שעובד.
 */
export async function saveOpenAI(ctx: Ctx, input: { apiKey?: string; model?: string }) {
  const apiKey = input.apiKey?.trim() || ctx.config.openai.apiKey;
  const model = input.model?.trim() || ctx.config.openai.model;
  if (!apiKey) return { ok: false as const, error: 'יש להדביק מפתח API', status: openaiStatus(ctx.config) };
  if (!/^sk-[A-Za-z0-9_\-]{20,}$/.test(apiKey)) {
    return { ok: false as const, error: 'זה לא נראה כמו מפתח OpenAI (אמור להתחיל ב-sk-)', status: openaiStatus(ctx.config) };
  }
  const p = provider(ctx);
  const r = typeof p.verify === 'function' ? await p.verify(apiKey, model) : ({ ok: true, model } as const);
  if (!r.ok) return { ok: false as const, error: r.message, status: openaiStatus(ctx.config) };

  const s = readFile(ctx.config);
  if (input.apiKey?.trim()) s.openaiApiKey = apiKey;
  if (input.model?.trim()) s.openaiModel = model;
  writeFile(ctx.config, s);
  ctx.config.openai.apiKey = apiKey;
  ctx.config.openai.model = model;
  if (input.apiKey?.trim()) source = 'ui';
  status.verified = true;
  status.verifiedAt = ctx.now().toISOString();
  status.lastError = null;
  return { ok: true as const, status: openaiStatus(ctx.config) };
}

/** מחיקת המפתח שנשמר מהממשק — חוזרים לערך שב-.env (אם יש). */
export function clearOpenAI(ctx: Ctx) {
  const s = readFile(ctx.config);
  delete s.openaiApiKey;
  delete s.openaiModel;
  writeFile(ctx.config, s);
  ctx.config.openai.apiKey = envDefaults.apiKey;
  ctx.config.openai.model = envDefaults.model || ctx.config.openai.model;
  source = envDefaults.apiKey ? 'env' : null;
  status.verified = null;
  status.verifiedAt = null;
  status.lastError = null;
  return openaiStatus(ctx.config);
}
