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
  jobs: { maxAttempts: number; retryBaseSeconds: number; stuckMinutes: number; pollMs: number };
  stalledProjectDays: number;
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
    jobs: {
      maxAttempts: num(env.JOB_MAX_ATTEMPTS, 3),
      retryBaseSeconds: num(env.JOB_RETRY_BASE_SECONDS, 10),
      stuckMinutes: num(env.STUCK_JOB_MINUTES, 10),
      pollMs: num(env.JOB_POLL_MS, 1000),
    },
    stalledProjectDays: num(env.STALLED_PROJECT_DAYS, 3),
  };
}
