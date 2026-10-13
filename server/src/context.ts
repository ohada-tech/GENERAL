import type { Config } from './config.js';
import type { DB } from './db/db.js';
import type { Providers } from './providers/registry.js';

/** הקשר משותף שעובר לכל שכבות השרת — מאפשר הזרקת תלויות בבדיקות. */
export interface Ctx {
  db: DB;
  config: Config;
  providers: Providers;
  /** ניתן לדרוס בבדיקות */
  now: () => Date;
}

/** שגיאה עסקית: פעולה לא מותרת במצב הנוכחי (נקודת אישור, סטטוס וכד'). */
export class GateError extends Error {
  constructor(
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
    this.name = 'GateError';
  }
}

export class NotFoundError extends GateError {
  constructor(what: string) {
    super(`${what} לא נמצא`, 404);
    this.name = 'NotFoundError';
  }
}
