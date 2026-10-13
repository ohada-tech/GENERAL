/**
 * שמירת מסד הנתונים בענן: קובץ ה-SQLite נשמר כמסמכים פרטיים תחת data/users/<id>
 * (פרטי גם מבעל ה-Artifact). שני "סלוטים" (a/b) — כותבים לסלוט הלא-פעיל ורק אז
 * מעדכנים את meta, כך ששמירה שנקטעה באמצע לא משחיתה את הגרסה הקודמת.
 */
const CHUNK = 190_000; // תווי base64 למסמך (מגבלת מסמך: 256KiB)

type Db = ClaudeCapabilityMap['db'];

interface Meta {
  slot: 'a' | 'b';
  chunks: number;
  savedAt: string;
  session: string;
  bytes: number;
}

export type SaveState =
  | { kind: 'saved'; at: string }
  | { kind: 'saving' }
  | { kind: 'dirty' }
  | { kind: 'error'; message: string }
  | { kind: 'conflict' }
  | { kind: 'local' };

const toB64 = (u8: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64: string) => {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
};

export class CloudStore {
  private meta: Meta | null = null;
  private readonly session = crypto.randomUUID();
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private stopped = false;
  state: SaveState = { kind: 'saved', at: '' };
  private listeners = new Set<(s: SaveState) => void>();

  constructor(
    private readonly db: Db,
    private readonly userId: string,
    private readonly exportBytes: () => Uint8Array,
  ) {}

  private col = () => this.db.collection(`data/users/${this.userId}`);

  onChange(fn: (s: SaveState) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private set(s: SaveState) {
    this.state = s;
    this.listeners.forEach((fn) => fn(s));
  }

  async load(): Promise<Uint8Array | null> {
    const snap = await this.col().doc('meta').get();
    if (!snap.exists) return null;
    const meta = snap.data() as unknown as Meta;
    const parts: string[] = [];
    for (let i = 0; i < meta.chunks; i++) {
      const c = await this.col().doc(`${meta.slot}${i}`).get();
      const d = c.data() as { b64?: string } | undefined;
      if (!c.exists || typeof d?.b64 !== 'string') throw new Error(`חלק ${i} של הנתונים חסר`);
      parts.push(d.b64);
    }
    this.meta = meta;
    this.set({ kind: 'saved', at: meta.savedAt });
    return fromB64(parts.join(''));
  }

  /** נקרא בכל כתיבה למסד — שומר אחרי 1.5 שניות של שקט. */
  markDirty = () => {
    if (this.stopped) return;
    this.dirty = true;
    if (this.state.kind !== 'saving') this.set({ kind: 'dirty' });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 1500);
  };

  async flush(): Promise<void> {
    if (this.saving) {
      await this.saving;
      if (!this.dirty) return;
    }
    if (!this.dirty || this.stopped) return;
    this.saving = this.save().finally(() => (this.saving = null));
    return this.saving;
  }

  private async save() {
    this.dirty = false;
    this.set({ kind: 'saving' });
    try {
      // הגנה מפני שני חלונות פתוחים שדורסים זה את זה
      const cur = await this.col().doc('meta').get();
      const remote = cur.exists ? (cur.data() as unknown as Meta) : null;
      if (remote && remote.session !== this.session && remote.savedAt !== this.meta?.savedAt) {
        this.stopped = true;
        this.set({ kind: 'conflict' });
        return;
      }
      const b64 = toB64(this.exportBytes());
      const slot: Meta['slot'] = this.meta?.slot === 'a' ? 'b' : 'a';
      const chunks = Math.max(1, Math.ceil(b64.length / CHUNK));
      for (let i = 0; i < chunks; i++) {
        await this.col().doc(`${slot}${i}`).set({ b64: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
      }
      const meta: Meta = { slot, chunks, savedAt: new Date().toISOString(), session: this.session, bytes: b64.length };
      await this.col().doc('meta').set({ ...meta });
      this.meta = meta;
      this.set(this.dirty ? { kind: 'dirty' } : { kind: 'saved', at: meta.savedAt });
    } catch (e) {
      this.dirty = true;
      const err = e as { code?: string; message?: string };
      this.set({ kind: 'error', message: err.code === 'quota_exceeded' ? 'נגמר מקום האחסון' : (err.message ?? String(e)) });
      // ניסיון חוזר אחד אחרי השהיה — לא לולאה
      if (err.code === 'unavailable' || err.code === 'resource_exhausted') {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.flush(), 15_000);
      }
    }
  }
}
