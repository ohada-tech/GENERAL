import { useEffect, useRef, useState } from 'react';
import { api, useAction, useApi } from '../lib/api';
import { fmtRelative } from '../lib/format';
import { InlineError, Tag } from './ui';

type Msg = {
  id: string;
  role: 'owner' | 'claude';
  text: string;
  status: 'new' | 'in_progress' | 'done' | 'declined' | 'info';
  attachments: string[];
  replyTo: string | null;
  createdAt: string;
};

/** הצ'אט הישיר עם Claude שמפתח את המערכת (לבקשות דחופות) */
const SESSION_URL = 'https://claude.ai/code/session_01KQMvk2XJssYKmB3cFE4Kko';
const SEEN_KEY = 'apos-devchat-seen';

const STATUS: Record<Msg['status'], { label: string; tone: string }> = {
  new: { label: 'ממתין ל-Claude', tone: 'warn' },
  in_progress: { label: 'Claude עובד על זה', tone: 'info' },
  done: { label: 'בוצע ✓', tone: 'ok' },
  declined: { label: 'לא בוצע', tone: 'danger' },
  info: { label: '', tone: 'neutral' },
};

const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
};

/** "💬 שינויים במערכת": בקשות שינוי ל-Claude מתוך המערכת, עם צילומי מסך. Claude עובר עליהן, מבצע ועונה כאן. */
export function DevChat() {
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).has('dev'));
  const { data, reload } = useApi<{ messages: Msg[] }>('/api/dev/messages', { pollMs: open ? 8000 : 60000 });
  const [text, setText] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [seen, setSeen] = useState(readSeen);
  const send = useAction();
  const up = useAction();
  const end = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const msgs = data?.messages ?? [];
  const unread = msgs.filter((m) => m.role === 'claude' && m.createdAt > seen).length;

  useEffect(() => {
    if (!open || !msgs.length) return;
    const last = msgs[msgs.length - 1].createdAt;
    try {
      localStorage.setItem(SEEN_KEY, last);
    } catch {
      /* לא קריטי */
    }
    setSeen(last);
    end.current?.scrollIntoView({ block: 'end' });
  }, [open, msgs.length]);

  // לחיצה בכל מקום אחר בדף (או Esc) סוגרת את החלון; הטקסט שהתחלת לכתוב נשמר
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !fab.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const upload = async (blobs: File[]) => {
    for (const f of blobs.filter((b) => b.type.startsWith('image/'))) {
      const r = await up.run(() => api.upload<{ name: string }>('/api/dev/attachments', f));
      if (r) setFiles((x) => [...x, r.name]);
    }
  };
  const submit = async () => {
    const r = await send.run(() => api.post('/api/dev/messages', { text, attachments: files }));
    if (r) {
      setText('');
      setFiles([]);
      await reload();
    }
  };

  const byId = new Map(msgs.map((m) => [m.id, m]));
  return (
    <>
      <button ref={fab} className="devchat-fab" onClick={() => setOpen((x) => !x)} title="בקשות שינוי ל-Claude שמפתח את המערכת">
        💬 שינויים במערכת
        {unread > 0 && <span className="bell-count">{unread}</span>}
      </button>
      {open && (
        <div ref={panel} className="devchat-panel" role="dialog" aria-label="שינויים במערכת">
          <div className="bell-head">
            <b>שינויים במערכת — עם Claude</b>
            <span className="row gap-s">
              <button
                className="btn-link small"
                onClick={() => window.open(SESSION_URL, 'claude-dev', 'width=560,height=900')}
                title="פותח בחלון צדדי את הצ'אט הישיר עם Claude — לבקשות דחופות"
              >
                צ'אט ישיר ↗
              </button>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="סגור">
                ✕
              </button>
            </span>
          </div>
          <div className="devchat-body">
            {msgs.length === 0 && (
              <div className="muted small pad">
                כתוב כאן מה לשנות או להוסיף במערכת — אפשר להדביק צילום מסך (Ctrl+V). Claude עובר על הבקשות פעם בשעה, מבצע ועונה כאן.
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={`devchat-msg ${m.role === 'owner' ? 'mine' : 'theirs'}`}>
                {m.replyTo && byId.get(m.replyTo) && <div className="small muted clamp-2">↩ {byId.get(m.replyTo)!.text}</div>}
                {m.text && <div className="devchat-text">{m.text}</div>}
                {m.attachments.map((a) => (
                  <a key={a} href={`/api/dev/attachments/${a}`} target="_blank" rel="noreferrer">
                    <img className="devchat-img" src={`/api/dev/attachments/${a}`} alt="" />
                  </a>
                ))}
                <div className="row gap-s small muted">
                  <span>{m.role === 'claude' ? 'Claude' : 'אתה'}</span>
                  <span>· {fmtRelative(m.createdAt)}</span>
                  {m.role === 'owner' && <Tag tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Tag>}
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
          <div className="devchat-compose stack">
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
              rows={3}
              placeholder="מה לשנות במערכת? (Ctrl+Enter לשליחה · אפשר להדביק צילום מסך)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const imgs = [...e.clipboardData.files];
                if (imgs.length) {
                  e.preventDefault();
                  void upload(imgs);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (text.trim() || files.length)) void submit();
              }}
            />
            <div className="row gap-s">
              <label className="btn btn-sm btn-ghost" title="צרף צילום מסך">
                📎 תמונה
                <input type="file" accept="image/*" multiple hidden onChange={(e) => void upload([...(e.target.files ?? [])])} />
              </label>
              <span className="grow" />
              <button className="btn btn-primary btn-sm" disabled={send.busy || up.busy || (!text.trim() && !files.length)} onClick={submit}>
                {send.busy ? 'שולח…' : up.busy ? 'מעלה…' : 'שלח ל-Claude'}
              </button>
            </div>
            <InlineError error={send.error ?? up.error} onClose={() => (send.clearError(), up.clearError())} />
          </div>
        </div>
      )}
    </>
  );
}
