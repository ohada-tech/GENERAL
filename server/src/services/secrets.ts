/**
 * מפתחות API שהוזנו מתוך הממשק (OpenAI, Anthropic, KIE) נשמרים בשרת בלבד, בקובץ data/secrets.json
 * (התיקייה data מוחרגת מ-Git; בענן היא דיסק קבוע). מפתח לעולם לא מוחזר לדפדפן — רק 4 התווים האחרונים.
 * מפתח שהוזן בממשק גובר על משתנה הסביבה. כל מפתח נבדק מול הספק לפני שהוא נשמר.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../context.js';
import type { Config } from '../config.js';
import type { AnthropicTextProvider } from '../providers/anthropic.js';
import type { OpenAITextProvider } from '../providers/openai.js';

export type KeyService = 'openai' | 'anthropic' | 'kie';
export const KEY_SERVICES: KeyService[] = ['openai', 'anthropic', 'kie'];

interface SecretsFile {
  openaiApiKey?: string;
  openaiModel?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  kieApiKey?: string;
}

export interface KeyStatus {
  service: KeyService;
  configured: boolean;
  source: 'ui' | 'env' | null;
  last4: string | null;
  model: string;
  verified: boolean | null;
  verifiedAt: string | null;
  lastError: string | null;
  /** יתרת קרדיטים (KIE) */
  credits?: number | null;
}
export type OpenAIStatus = KeyStatus;

const LABEL: Record<KeyService, string> = { openai: 'OpenAI', anthropic: 'Anthropic', kie: 'KIE' };
const FORMAT: Record<KeyService, { re: RegExp; hint: string }> = {
  openai: { re: /^sk-[A-Za-z0-9_\-]{20,}$/, hint: 'זה לא נראה כמו מפתח OpenAI (אמור להתחיל ב-sk-)' },
  anthropic: { re: /^sk-ant-[A-Za-z0-9_\-]{20,}$/, hint: 'זה לא נראה כמו מפתח Anthropic (אמור להתחיל ב-sk-ant-)' },
  kie: { re: /^[A-Za-z0-9_\-]{16,}$/, hint: 'זה לא נראה כמו מפתח KIE (העתק אותו מ-kie.ai/api-key)' },
};

const file = (config: Config) => path.join(config.dataDir, 'secrets.json');

const env: Record<KeyService, { apiKey: string; model: string }> = {
  openai: { apiKey: '', model: '' },
  anthropic: { apiKey: '', model: '' },
  kie: { apiKey: '', model: '' },
};
const source: Record<KeyService, KeyStatus['source']> = { openai: null, anthropic: null, kie: null };
const check: Record<KeyService, Pick<KeyStatus, 'verified' | 'verifiedAt' | 'lastError'> & { credits?: number | null }> = {
  openai: { verified: null, verifiedAt: null, lastError: null },
  anthropic: { verified: null, verifiedAt: null, lastError: null },
  kie: { verified: null, verifiedAt: null, lastError: null, credits: null },
};

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

/** הגדרות הספק בתוך ה-Config (אובייקט חי — הספקים קוראים ממנו בכל קריאה) */
function slot(config: Config, s: KeyService): { apiKey: string; model?: string } {
  return s === 'openai' ? config.openai : s === 'anthropic' ? config.anthropic : config.kie;
}

const fileKey = (s: KeyService) => `${s}ApiKey` as 'openaiApiKey' | 'anthropicApiKey' | 'kieApiKey';
const fileModel = (s: KeyService) => (s === 'kie' ? null : (`${s}Model` as 'openaiModel' | 'anthropicModel'));

/** בהפעלה: טוען מפתחות שנשמרו מהממשק מעל ערכי הסביבה. */
export function loadSecrets(config: Config) {
  const f = readFile(config);
  for (const s of KEY_SERVICES) {
    const sl = slot(config, s);
    env[s] = { apiKey: sl.apiKey, model: sl.model ?? '' };
    const k = f[fileKey(s)];
    if (k) {
      sl.apiKey = k;
      source[s] = 'ui';
    } else {
      source[s] = sl.apiKey ? 'env' : null;
    }
    const fm = fileModel(s);
    if (fm && f[fm]) sl.model = f[fm];
    check[s] = { verified: null, verifiedAt: null, lastError: null, ...(s === 'kie' ? { credits: null } : {}) };
  }
}

export function keyStatus(config: Config, s: KeyService): KeyStatus {
  const sl = slot(config, s);
  return {
    service: s,
    configured: Boolean(sl.apiKey),
    source: sl.apiKey ? source[s] : null,
    last4: sl.apiKey ? sl.apiKey.slice(-4) : null,
    model: sl.model ?? '',
    ...check[s],
  };
}

export const allKeyStatus = (config: Config) => Object.fromEntries(KEY_SERVICES.map((s) => [s, keyStatus(config, s)])) as Record<KeyService, KeyStatus>;

type VerifyResult = { ok: true; credits?: number } | { ok: false; code: string; message: string };

async function verify(ctx: Ctx, s: KeyService, apiKey: string, model: string): Promise<VerifyResult> {
  if (s === 'kie') return ctx.providers.media?.verify ? ctx.providers.media.verify(apiKey) : { ok: true };
  const p = ctx.providers.text[s === 'openai' ? 'openai' : 'claude'] as unknown as OpenAITextProvider | AnthropicTextProvider | undefined;
  if (!p || typeof (p as OpenAITextProvider).verify !== 'function') return { ok: true };
  return (p as OpenAITextProvider).verify(apiKey, model);
}

/** בודק את המפתח הנוכחי ומעדכן את הסטטוס. */
export async function testKey(ctx: Ctx, s: KeyService) {
  const sl = slot(ctx.config, s);
  if (!sl.apiKey) return keyStatus(ctx.config, s);
  const r = await verify(ctx, s, sl.apiKey, sl.model ?? '');
  check[s] = {
    verified: r.ok,
    verifiedAt: ctx.now().toISOString(),
    lastError: r.ok ? null : r.message,
    ...(s === 'kie' ? { credits: r.ok ? (r.credits ?? null) : null } : {}),
  };
  return keyStatus(ctx.config, s);
}

/** שמירת מפתח/מודל מהממשק. מפתח לא תקף לא נשמר ולא מחליף מפתח קיים שעובד. */
export async function saveKey(ctx: Ctx, s: KeyService, input: { apiKey?: string; model?: string }) {
  const sl = slot(ctx.config, s);
  const apiKey = input.apiKey?.trim() || sl.apiKey;
  const model = input.model?.trim() || sl.model || '';
  if (!apiKey) return { ok: false as const, error: 'יש להדביק מפתח API', status: keyStatus(ctx.config, s) };
  if (!FORMAT[s].re.test(apiKey)) return { ok: false as const, error: FORMAT[s].hint, status: keyStatus(ctx.config, s) };
  const r = await verify(ctx, s, apiKey, model);
  if (!r.ok) return { ok: false as const, error: r.message, status: keyStatus(ctx.config, s) };

  const f = readFile(ctx.config);
  if (input.apiKey?.trim()) f[fileKey(s)] = apiKey;
  const fm = fileModel(s);
  if (fm && input.model?.trim()) f[fm] = model;
  writeFile(ctx.config, f);
  sl.apiKey = apiKey;
  if (s !== 'kie') sl.model = model;
  if (input.apiKey?.trim()) source[s] = 'ui';
  check[s] = { verified: true, verifiedAt: ctx.now().toISOString(), lastError: null, ...(s === 'kie' ? { credits: r.credits ?? null } : {}) };
  return { ok: true as const, status: keyStatus(ctx.config, s) };
}

/** מחיקת המפתח שנשמר מהממשק — חוזרים לערך שבמשתני הסביבה (אם יש). */
export function clearKey(ctx: Ctx, s: KeyService) {
  const f = readFile(ctx.config);
  delete f[fileKey(s)];
  const fm = fileModel(s);
  if (fm) delete f[fm];
  writeFile(ctx.config, f);
  const sl = slot(ctx.config, s);
  sl.apiKey = env[s].apiKey;
  if (s !== 'kie') sl.model = env[s].model || sl.model;
  source[s] = env[s].apiKey ? 'env' : null;
  check[s] = { verified: null, verifiedAt: null, lastError: null, ...(s === 'kie' ? { credits: null } : {}) };
  return keyStatus(ctx.config, s);
}

export const keyLabel = (s: KeyService) => LABEL[s];

/* תאימות לאחור (OpenAI בלבד) */
export const openaiStatus = (config: Config) => keyStatus(config, 'openai');
export const testOpenAI = (ctx: Ctx) => testKey(ctx, 'openai');
export const saveOpenAI = (ctx: Ctx, input: { apiKey?: string; model?: string }) => saveKey(ctx, 'openai', input);
export const clearOpenAI = (ctx: Ctx) => clearKey(ctx, 'openai');
