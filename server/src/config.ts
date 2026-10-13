import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** שורש הריפוזיטורי — נתיבים יחסיים ב-.env מחושבים ממנו. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  ownerName: string;
  openai: { apiKey: string; model: string; baseUrl: string; timeoutMs: number };
  anthropic: { apiKey: string; model: string; timeoutMs: number };
  kie: { apiKey: string; baseUrl: string; uploadUrl: string; pollMs: number; timeoutMinutes: number };
  /** סיסמת כניסה למערכת. ריק = ללא התחברות (מותר רק כשהשרת מאזין למחשב המקומי) */
  auth: { password: string; sessionSecret: string };
  jobs: { maxAttempts: number; retryBaseSeconds: number; stuckMinutes: number; pollMs: number; concurrency: number };
  stalledProjectDays: number;
  /** טיימר שרץ מעבר לכך נחשב "נשכח" ונשלחת התראה */
  timerMaxHours: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: num(env.PORT, 3001),
    host: env.HOST || '127.0.0.1',
    dataDir: path.resolve(REPO_ROOT, env.DATA_DIR || 'data'),
    ownerName: env.OWNER_NAME || 'owner',
    openai: {
      apiKey: env.OPENAI_API_KEY || '',
      model: env.OPENAI_MODEL || 'gpt-4.1',
      baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      timeoutMs: num(env.OPENAI_TIMEOUT_MS, 180_000),
    },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || '',
      model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
      timeoutMs: num(env.ANTHROPIC_TIMEOUT_MS, 600_000),
    },
    kie: {
      apiKey: env.KIE_API_KEY || '',
      baseUrl: (env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/$/, ''),
      uploadUrl: (env.KIE_UPLOAD_URL || 'https://kieai.redpandaai.co').replace(/\/$/, ''),
      pollMs: num(env.KIE_POLL_MS, 4000),
      timeoutMinutes: num(env.KIE_TIMEOUT_MINUTES, 25),
    },
    auth: {
      password: env.APP_PASSWORD || '',
      sessionSecret: env.SESSION_SECRET || '',
    },
    jobs: {
      maxAttempts: num(env.JOB_MAX_ATTEMPTS, 3),
      retryBaseSeconds: num(env.JOB_RETRY_BASE_SECONDS, 10),
      stuckMinutes: num(env.STUCK_JOB_MINUTES, 10),
      pollMs: num(env.JOB_POLL_MS, 1000),
      concurrency: num(env.JOB_CONCURRENCY, 4),
    },
    stalledProjectDays: num(env.STALLED_PROJECT_DAYS, 3),
    timerMaxHours: num(env.TIMER_MAX_HOURS, 10),
  };
}
