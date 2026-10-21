/**
 * "✨ מלא את האפיון אוטומטית": סיכום / צ'אט / קבצים / אתר הלקוח ← כל השדות.
 * ממלא רק שדות ריקים (אלא אם מסמנים לדרוס), ומציג מה עוד חסר.
 */
import { BRIEF_FIELD_LABELS, type Brief } from '@apos/shared';
import { createContext, useContext, useRef, useState } from 'react';
import { api, useAction } from '../lib/api';
import { InlineError } from './ui';

/** תוויות השדות שה-AI מילא — כדי ש-Field יציג ✨ */
export const AiFilledContext = createContext<Set<string>>(new Set());
export const useAiFilled = (label: string) => useContext(AiFilledContext).has(label);

/** התוויות כפי שהן מופיעות במסך האפיון (חלקן שונות מהתוויות המשותפות) */
const SCREEN_LABELS: Partial<Record<keyof Brief, string>> = {
  cta: 'קריאה לפעולה (CTA)',
  platforms: 'פלטפורמות הפצה',
  aspectRatio: 'יחס תמונה',
  durationSec: 'אורך הסרטון (שניות)',
  brandImages: 'תמונות מותג',
  language: 'שפה',
  voiceNotes: 'הערות לקול',
  budget: 'תקציב',
  constraints: 'מגבלות הפקה',
  notes: 'הערות נוספות',
};

export const aiLabels = (keys: string[]) => new Set(keys.map((k) => SCREEN_LABELS[k as keyof Brief] ?? BRIEF_FIELD_LABELS[k as keyof Brief] ?? k));

export function AutoBrief({
  projectId,
  brief,
  beforeRun,
  onDone,
}: {
  projectId: string;
  brief: Brief;
  /** שמירת עריכות שלא נשמרו לפני המילוי */
  beforeRun: () => Promise<unknown>;
  onDone: () => Promise<void> | void;
}) {
  const act = useAction();
  const [text, setText] = useState('');
  const [url, setUrl] = useState(brief.website);
  const [files, setFiles] = useState<File[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<{ filled: string[]; usedSite: boolean } | null>(null);
  const [open, setOpen] = useState(!brief.aiFilled.length && !brief.goal);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async () => {
    await beforeRun();
    const r = await act.run(() => {
      if (files.length) {
        const fd = new FormData();
        fd.append('text', text);
        fd.append('url', url);
        fd.append('overwrite', String(overwrite));
        for (const f of files) fd.append('files', f);
        return api.post<{ filled: string[]; usedSite: boolean }>(`/api/projects/${projectId}/brief/autofill`, fd);
      }
      return api.post<{ filled: string[]; usedSite: boolean }>(`/api/projects/${projectId}/brief/autofill`, { text, url, overwrite });
    });
    if (r) {
      setResult(r);
      setText('');
      setFiles([]);
      await onDone();
    }
  };

  const questions = brief.aiQuestions ?? [];

  return (
    <section className="card stack auto-brief">
      <div className="row between wrap gap-s">
        <div>
          <h2>✨ מלא את האפיון אוטומטית</h2>
          <div className="small muted">מסיכום שיחה, וואטסאפ, קבצים מתיקיית החומרים ואתר הלקוח. ממלא רק שדות ריקים; אתה רק מאשר.</div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen((x) => !x)}>
          {open ? 'סגור' : 'פתח'}
        </button>
      </div>

      {open && (
        <>
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="הדבק כאן סיכום: מה הלקוח רוצה, למי, איפה זה ירוץ, אורך, טון, דדליין… (גם טקסט ארוך מצ'אט או מוואטסאפ)" />
          <div className="row gap-s wrap">
            <input className="grow" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://אתר-הלקוח" />
            <button className="btn btn-ghost" type="button" onClick={() => fileRef.current?.click()} title="Word, טקסט או Markdown — עד 10 קבצים">
              📎 קבצים{files.length ? ` (${files.length})` : ''}
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              accept=".docx,.txt,.md,.markdown,.csv"
              onChange={(e) => {
                setFiles(Array.from(e.target.files ?? []).slice(0, 10));
                e.target.value = '';
              }}
            />
          </div>
          {files.length > 0 && <div className="small muted">{files.map((f) => f.name).join(' · ')}</div>}
          <div className="row between wrap gap-s">
            <label className="check small">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              לדרוס גם שדות שכבר מילאתי
            </label>
            <button className="btn btn-primary" disabled={act.busy || (!text.trim() && !url.trim() && !files.length)} onClick={run}>
              {act.busy ? 'קורא וממלא…' : '✨ מלא את האפיון'}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="notice small">
          {result.filled.length
            ? `מולאו ${result.filled.length} שדות: ${[...aiLabels(result.filled)].join(' · ')}`
            : 'לא נמצא מידע חדש לשדות הריקים'}
          {result.usedSite ? ' · נקרא גם אתר הלקוח' : ''}
        </div>
      )}
      {questions.length > 0 && (
        <div className="auto-brief-questions">
          <strong className="small">עוד חסר — רק אתה יודע:</strong>
          <ul>
            {questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      <InlineError error={act.error} onClose={act.clearError} />
    </section>
  );
}
