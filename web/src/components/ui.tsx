import { STATUS_LABELS, type Status } from '@apos/shared';
import { useAiFilled } from './AutoBrief';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function StatusBadge({ status, label }: { status: Status | string; label?: string }) {
  const text = label ?? STATUS_LABELS[status as Status]?.he ?? status;
  return <span className={`badge st-${status}`}>{text}</span>;
}

export function Tag({ children, tone = 'neutral', title }: { children: ReactNode; tone?: string; title?: string }) {
  return (
    <span className={`tag tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${value}%` }} />
      <span className="progress-label">{value}%</span>
    </div>
  );
}

export function Loading({ text = 'טוען…' }: { text?: string }) {
  return (
    <div className="state-box">
      <span className="spinner" /> {text}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <span>{error}</span>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          נסה שוב
        </button>
      )}
    </div>
  );
}

export function InlineError({ error, onClose }: { error: string | null; onClose?: () => void }) {
  if (!error) return null;
  return (
    <div className="error-box small" role="alert">
      <span>{error}</span>
      {onClose && (
        <button className="btn-link" onClick={onClose} aria-label="סגור">
          ✕
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn-link" onClick={onClose} aria-label="סגור">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  required,
  missing,
  hint,
  group,
  children,
}: {
  label: string;
  required?: boolean;
  missing?: boolean;
  hint?: string;
  /** קבוצת פקדים (כפתורים/רדיו) — div במקום label, כדי שלחיצה על הכותרת לא תפעיל את הפקד הראשון */
  group?: boolean;
  children: ReactNode;
}) {
  const Tag = group ? 'div' : 'label';
  const ai = useAiFilled(label);
  return (
    <Tag className={`field ${missing ? 'field-missing' : ''}`} {...(group ? { role: 'group', 'aria-label': label } : {})}>
      <span className="field-label">
        {label}
        {required && <span className="req">*</span>}
        {missing && <span className="missing-dot">חסר</span>}
        {ai && <span className="ai-dot" title="מולא אוטומטית מהמקורות — עריכה שלך מסירה את הסימון">✨ AI</span>}
      </span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </Tag>
  );
}

/** סימון ברור בין פעולה אוטומטית (אינטגרציה) לבין ידנית / הדגמה */
export function ModeTag({ mode }: { mode: 'auto' | 'manual' | 'demo' | 'planned' }) {
  const map = {
    auto: ['אוטומטי', 'auto', 'מבוצע ע"י אינטגרציה אמיתית'],
    manual: ['ידני', 'manual', 'מבוצע ידנית ע"י המשתמש'],
    demo: ['DEMO', 'demo', 'תוכן הדגמה — לא נוצר ע"י מודל AI'],
    planned: ['טרם נבנה', 'planned', 'השלב מתוכנן ל-Phase עתידי'],
  } as const;
  const [text, tone, title] = map[mode];
  return (
    <Tag tone={tone} title={title}>
      {text}
    </Tag>
  );
}

/**
 * כפתור פעולה הרסנית עם אישור בתוך הדף: לחיצה ראשונה מחליפה את התווית ל"בטוח?",
 * לחיצה שנייה תוך 4 שניות מבצעת. (confirm() של הדפדפן לא עובד בכל הסביבות.)
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'בטוח? לחץ שוב',
  className = 'btn btn-sm btn-danger-ghost',
  disabled,
}: {
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 4000);
          return;
        }
        window.clearTimeout(timer.current);
        setArmed(false);
        await onConfirm();
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

/** שורה שכולה לחיצה (לא רק הטקסט): קישורים וכפתורים בתוכה ממשיכים לעבוד כרגיל; Enter במקלדת פותח */
export function rowLink(go: (to: string) => void, to: string | null | undefined) {
  if (!to) return {};
  const inner = (t: EventTarget | null) => t instanceof Element && !!t.closest('a, button, input, select, textarea, label');
  return {
    className: 'row-link',
    tabIndex: 0,
    role: 'link' as const,
    onClick: (e: { target: EventTarget | null; ctrlKey: boolean; metaKey: boolean }) => {
      if (inner(e.target) || window.getSelection()?.toString()) return;
      if (e.ctrlKey || e.metaKey) window.open(to, '_blank');
      else go(to);
    },
    onKeyDown: (e: { key: string; target: EventTarget | null; currentTarget: EventTarget }) => {
      if (e.key === 'Enter' && e.target === e.currentTarget) go(to);
    },
  };
}
