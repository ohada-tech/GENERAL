/*
 * Service worker מינימלי — מאפשר להתקין את המערכת כאפליקציה בחלון נפרד.
 * לא שומר נתונים במטמון: הכל תמיד מהשרת (המערכת חיה, ההפקות משתנות כל הזמן).
 * רק כשאין רשת, מסך הפתיחה מראה הודעה במקום דף שגיאה של הדפדפן.
 */
const OFFLINE = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Production AP</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0a0a0b;color:#e8e8ee;font-family:system-ui,sans-serif;text-align:center">
<div><h2>אין חיבור לשרת</h2><p style="color:#9a9aa6">בדוק את החיבור לאינטרנט ונסה שוב.</p>
<button onclick="location.reload()" style="padding:10px 22px;border-radius:10px;border:0;background:#A9BEF7;color:#0a0a0b;font-size:15px;cursor:pointer">נסה שוב</button></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // API, קבצים ומדיה — ישירות לרשת, בלי התערבות
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});

// התראות Push: קופצות גם כשהמערכת סגורה, ומסמנות את האייקון בשורת המשימות
self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: 'AI Production AP', body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    (async () => {
      await self.registration.showNotification(d.title || 'AI Production AP', {
        body: d.body || '',
        tag: d.tag || undefined,
        renotify: Boolean(d.tag),
        requireInteraction: true,
        lang: 'he',
        dir: 'rtl',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { link: d.link || '/' },
      });
      const open = await self.registration.getNotifications();
      if (self.navigator.setAppBadge) await self.navigator.setAppBadge(open.length).catch(() => {});
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '/';
  e.waitUntil(
    (async () => {
      const left = await self.registration.getNotifications();
      if (self.navigator.setAppBadge) await (left.length ? self.navigator.setAppBadge(left.length) : self.navigator.clearAppBadge()).catch(() => {});
      if (/^https?:\/\//.test(link) && !link.startsWith(self.location.origin)) return self.clients.openWindow(link);
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = all.find((c) => c.url.startsWith(self.location.origin));
      if (win) {
        await win.focus();
        return win.navigate ? win.navigate(new URL(link, self.location.origin).href) : undefined;
      }
      return self.clients.openWindow(link);
    })(),
  );
});
