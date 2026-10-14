/**
 * עדכון אוטומטי: כשעולה גרסה חדשה של המערכת לשרת, הדף מתעדכן לבד — בלי רענון ידני.
 * לא מרענן באמצע עבודה: אם יש שדה בעריכה או עורך פתוח, מחכה שתסיים.
 */
const CHECK_MS = 45_000;

const currentBuild = () =>
  document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') ?? null;

async function liveBuild(): Promise<string | null> {
  try {
    const html = await (await fetch('/', { cache: 'no-store', credentials: 'same-origin' })).text();
    return /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/index-[^"]+)"/.exec(html)?.[1] ?? null;
  } catch {
    return null; // השרת באמצע עלייה — ננסה שוב
  }
}

function busy() {
  const a = document.activeElement as HTMLElement | null;
  const typing = !!a && (a.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName));
  return typing || !!document.querySelector('[data-editing="true"]');
}

export function startAutoUpdate() {
  const mine = currentBuild();
  if (!mine) return; // מצב פיתוח
  let pending = false;
  const check = async () => {
    if (!pending) {
      const live = await liveBuild();
      pending = !!live && live !== mine;
    }
    if (pending && !busy()) location.reload();
  };
  window.setInterval(check, CHECK_MS);
  // כשיש עדכון שממתין לסיום עריכה — בודקים לעתים קרובות
  window.setInterval(() => pending && !busy() && location.reload(), 4000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void check());
}
