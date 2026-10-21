import type { Notification } from '@apos/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useApi } from '../lib/api';
import { fmtRelative } from '../lib/format';
import { enablePush, pushSupported } from '../lib/push';

const ICON: Record<string, string> = {
  approval_needed: '🟡',
  success: '✅',
  error: '⛔',
  warning: '⚠️',
  info: 'ℹ️',
};

/** פעמון התראות: התראות בתוך ה-Dashboard + התראות דפדפן (בכפוף להרשאה). */
export function NotificationBell() {
  const { data, reload } = useApi<Notification[]>('/api/notifications?limit=40', { pollMs: 5000 });
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported',
  );
  const [pushOn, setPushOn] = useState(false);
  const [pushMsg, setPushMsg] = useState('');
  const seen = useRef<Set<string> | null>(null);
  const navigate = useNavigate();
  const unread = (data ?? []).filter((n) => !n.readAt);
  const canEnable = !pushOn && (perm === 'default' || (perm === 'granted' && pushSupported()));

  // המכשיר הזה כבר אישר התראות? רושמים אותו בשקט (בלי לשאול)
  useEffect(() => {
    void enablePush(false).then(setPushOn).catch(() => undefined);
  }, []);


  const go = (link: string) => (/^https?:\/\//.test(link) ? window.open(link, '_blank', 'noopener') : navigate(link));

  // התראת דפדפן להתראות חדשות שלא נראו מאז טעינת הדף
  useEffect(() => {
    if (!data) return;
    if (seen.current === null) {
      seen.current = new Set(data.map((n) => n.id));
      return;
    }
    for (const n of data) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      // מה שמחכה לך כבר קופץ כ-Push מהשרת — לא להקפיץ פעמיים
      if (!n.readAt && perm === 'granted' && !(pushOn && n.kind === 'approval_needed')) {
        const bn = new window.Notification(n.title, { body: n.body, tag: n.id, lang: 'he', dir: 'rtl' });
        bn.onclick = () => {
          window.focus();
          if (n.link) go(n.link);
        };
      }
    }
  }, [data, perm, pushOn]);

  const ask = async () => {
    if (perm === 'unsupported') return;
    try {
      const on = pushSupported() ? await enablePush(true) : false;
      setPushOn(on);
      setPerm(window.Notification.permission);
      if (!pushSupported()) setPerm(await window.Notification.requestPermission());
      setPushMsg(on ? 'מופעל: התראות יקפצו גם כשהמערכת סגורה' : '');
    } catch (e) {
      setPushMsg(`לא הצלחתי להפעיל: ${(e as Error).message}`);
    }
  };

  const test = async () => {
    const r = await api.post<{ sent: number }>('/api/push/test').catch(() => ({ sent: 0 }));
    setPushMsg(r.sent ? `נשלחה התראת בדיקה ל-${r.sent} מכשירים` : 'אין מכשיר רשום — לחץ "הפעל התראות"');
  };

  const openItem = async (n: Notification) => {
    if (!n.readAt) await api.post(`/api/notifications/${n.id}/read`).catch(() => undefined);
    setOpen(false);
    void reload();
    if (n.link) go(n.link);
  };

  const readAll = async () => {
    await api.post('/api/notifications/read-all').catch(() => undefined);
    void reload();
  };

  return (
    <div className="bell">
      {canEnable && (
        <button className="btn btn-sm push-cta" onClick={ask} title="התראה קופצת במחשב ובטלפון כשמשהו מחכה לך — גם כשהמערכת סגורה">
          🔔 הפעל התראות
        </button>
      )}
      <button className="btn btn-ghost bell-btn" onClick={() => setOpen((o) => !o)} aria-label="התראות">
        🔔{unread.length > 0 && <span className="bell-count">{unread.length}</span>}
      </button>
      {open && (
        <div className="bell-panel" onMouseLeave={() => setOpen(false)}>
          <div className="bell-head">
            <strong>התראות</strong>
            <div className="row gap-s">
              {canEnable && (
                <button className="btn btn-sm" onClick={ask}>
                  הפעל התראות
                </button>
              )}
              {pushOn && (
                <button className="btn btn-sm btn-ghost" onClick={test}>
                  שלח התראת בדיקה
                </button>
              )}
              {perm === 'denied' && <span className="muted small">התראות דפדפן חסומות בהגדרות הדפדפן</span>}
              {unread.length > 0 && (
                <button className="btn btn-sm btn-ghost" onClick={readAll}>
                  סמן הכל כנקרא
                </button>
              )}
            </div>
          </div>
          {pushMsg && <div className="small muted pad">{pushMsg}</div>}
          {(data ?? []).length === 0 ? (
            <div className="muted pad">אין התראות</div>
          ) : (
            <ul className="bell-list">
              {data!.map((n) => (
                <li key={n.id} className={n.readAt ? 'read' : ''}>
                  <button className="bell-item" onClick={() => openItem(n)}>
                    <span>{ICON[n.kind] ?? '•'}</span>
                    <span className="bell-text">
                      <span className="bell-title">{n.title}</span>
                      {n.body && <span className="bell-body">{n.body}</span>}
                      <span className="bell-time">{fmtRelative(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
