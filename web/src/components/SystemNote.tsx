import { useState } from 'react';
import { api, useAction } from '../lib/api';
import { InlineError } from './ui';
import { Icon } from './Icon';

const TAB_LABEL: Record<string, string> = {
  overview: 'סקירה',
  brief: 'אפיון',
  script: 'תסריט',
  voiceover: 'קריינות',
  storyboard: 'סטורי בורד',
  production: 'הפקה',
  time: 'זמנים',
  activity: 'פעילות',
  jobs: 'משימות',
  settings: 'הגדרות',
};

/**
 * "הערה למערכת": קבוע בתחתית כל לשונית בכל פרויקט. אוהד כותב מה חסר או לא נכון בכלי
 * (פיצ'ר, באג, בנייה לא נכונה), וזה נשלח לצ'אט "שינויים במערכת" יחד עם הפרויקט והלשונית,
 * כדי ש-Claude ישנה את המערכת עצמה — לכל הפרויקטים, לא רק לזה.
 */
export function SystemNote({ projectName, tab }: { projectName: string; tab: string }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  const send = useAction();
  const up = useAction();

  const upload = async (blobs: File[]) => {
    for (const f of blobs.filter((b) => b.type.startsWith('image/'))) {
      const r = await up.run(() => api.upload<{ name: string }>('/api/dev/attachments', f));
      if (r) setFiles((x) => [...x, r.name]);
    }
  };
  const submit = async () => {
    const body = text.trim();
    if (!body && !files.length) return;
    const where = `📍 הערה למערכת מתוך הפרויקט «${projectName}» · לשונית ${TAB_LABEL[tab] ?? tab}`;
    const r = await send.run(() => api.post('/api/dev/messages', { text: `${where}\n${body}`, attachments: files }));
    if (r) {
      setText('');
      setFiles([]);
      setSent(true);
    }
  };

  return (
    <div className="system-note card">
      <div className="row gap-s wrap">
        <strong>
          <Icon n="chat" /> הערה למערכת / פיצ'ר חסר
        </strong>
        <span className="small muted">משהו חסר או בנוי לא נכון בכלי? כתוב כאן — Claude משנה את המערכת לכל הפרויקטים ועונה ב"שינויים במערכת".</span>
      </div>
      {files.length > 0 && (
        <div className="row gap-s">
          {files.map((f) => (
            <span key={f} className="devchat-thumb">
              <img src={`/api/dev/attachments/${f}`} alt="" />
              <button className="icon-btn" onClick={() => setFiles((x) => x.filter((y) => y !== f))} aria-label="הסר">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        rows={2}
        placeholder="למשל: אין מחיקת שוטים בסטורי בורד מאושר (Ctrl+Enter לשליחה · אפשר להדביק צילום מסך)"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSent(false);
        }}
        onPaste={(e) => {
          const imgs = [...e.clipboardData.files];
          if (imgs.length) {
            e.preventDefault();
            void upload(imgs);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
        }}
      />
      <div className="row gap-s">
        <label className="btn btn-sm btn-ghost" title="צרף צילום מסך">
          <Icon n="clip" /> תמונה
          <input type="file" accept="image/*" multiple hidden onChange={(e) => void upload([...(e.target.files ?? [])])} />
        </label>
        {sent && <span className="small ok-text">נשלח ✓ התשובה תופיע ב"שינויים במערכת"</span>}
        <span className="grow" />
        <button className="btn btn-primary btn-sm" disabled={send.busy || up.busy || (!text.trim() && !files.length)} onClick={() => void submit()}>
          {send.busy ? 'שולח…' : up.busy ? 'מעלה…' : 'שלח ל-Claude'}
        </button>
      </div>
      <InlineError error={send.error ?? up.error} onClose={() => (send.clearError(), up.clearError())} />
    </div>
  );
}
