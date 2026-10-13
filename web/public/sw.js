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
