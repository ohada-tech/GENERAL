/**
 * תזכורת ללקוח שלא הגיב: נוסח וואטסאפ בסגנון של אוהד —
 * שורות קצרות, "היי X מה שלומך?", "אשמח לדעת אם יצא לך…", ":)", סיום חם בלי חתימה. בלי לחץ.
 * ניסוח נייטרלי מגדרית (אין "תעבור/תעברי"), כי לא תמיד ידוע מי בצד השני.
 */
export interface NudgeInput {
  contactName: string;
  /** מה נשלח: "התסריט" / "הסטורי בורד" / "הגרסה" */
  what: string;
  sentAt: string;
  viewed: boolean;
  url?: string;
  now?: Date;
}

/** כמה ימים עברו, ובכמה פעמים כבר הזכרנו — כדי לא לחזור על אותו נוסח */
export const NUDGE_AFTER_DAYS = 3;

function timeGreeting(d: Date) {
  const h = d.getHours();
  const day = d.getDay();
  if (day === 0 && h < 14) return 'שבוע טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  return 'ערב טוב';
}

function whenSent(sentAt: string, now: Date) {
  const days = Math.floor((now.getTime() - new Date(sentAt).getTime()) / 86_400_000);
  if (days <= 1) return 'אתמול';
  if (days < 7) return 'לפני כמה ימים';
  return 'לפני שבוע';
}

export function nudgeText(i: NudgeInput): string {
  const now = i.now ?? new Date();
  const name = i.contactName.trim().split(/\s+/)[0] ?? '';
  const lines = [`היי${name ? ` ${name}` : ''} ${timeGreeting(now)} מה שלומך?`];
  if (i.viewed) {
    lines.push(`אשמח לדעת אם יצא לך לעבור על ${i.what} ששלחתי ${whenSent(i.sentAt, now)} :)`);
    lines.push('אם יש הערות והצעות לשיפורים אשמח לשמוע');
  } else {
    lines.push(`רק מוודא שהקישור ל${i.what.replace(/^ה/, '')} ששלחתי ${whenSent(i.sentAt, now)} הגיע אליך :)`);
    if (i.url) lines.push(i.url);
  }
  lines.push('רק בשביל לקדם ושלא יתעכב');
  lines.push('יום נפלא');
  return lines.join('\n');
}

/** wa.me דורש מספר בינלאומי בלי + ובלי אפסים מובילים. 050-1234567 → 972501234567 */
export function waLink(phone: string, text: string): string | null {
  let d = phone.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `972${d.slice(1)}`;
  if (d.length < 10) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}
