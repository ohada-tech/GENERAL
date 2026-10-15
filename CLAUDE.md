# AI Production AP — הנחיות ל-Claude Code

מערכת הפקה לסרטוני AI בעברית (RTL). ה-AI עושה את העבודה, אוהד רק מאשר ומעיר.
ChatGPT ו-Claude משתפים פעולה בכתיבה, והמערכת לומדת מכל הערה.

## איפה זה רץ
- ענף עבודה: `claude/determined-mendel-hml2ab`. כל push אליו פורס אוטומטית ל-Render.
- המערכת החיה: https://ai-production-ap.onrender.com. בכל פריסה יש 502 קצר עד שהשרת עולה.
- הריפו ציבורי: אסור להכניס אליו מפתחות, טוקנים, סיסמאות או תוכן של לקוחות.

## מבנה
- `shared/`: טיפוסים ולוגיקה משותפת (סקריפט, בריף, גרסאות).
- `server/`: Fastify 5, node:sqlite, tsx. נתיבי API ב-`server/src/api/`, עבודות רקע ב-`server/src/jobs/`, ספקי AI ב-`server/src/providers/`.
- `web/`: React 19 + Vite, אפליקציה מתקינה (PWA).

## פקודות
- `npm install`
- `npm run typecheck`
- `npm test` (Vitest; כל הבדיקות צריכות לעבור לפני push)
- `npm run build`
- `npm run dev` להרצה מקומית

## כללים קבועים
- לענות לאוהד בעברית, קצר ונקודתי.
- מפתחות API רק במשתני סביבה בשרת, אף פעם לא בקוד או ב-GitHub.
- מפתח המפעיל של המערכת נמצא במשתנה הסביבה `APOS_OPERATOR_TOKEN`. לא להדפיס ולא לבקש להדביק אותו בצ'אט.
- לא להריץ יצירה בתשלום (תמונה, וידאו, קריינות ב-ElevenLabs/KIE) בלי אישור מפורש לכל הרצה.
- Higgsfield: רק Unlimited, אף פעם לא לבזבז קרדיטים.
- תיקון ממוקד נוגע רק בשורות שצוטטו. כל הערה של אוהד נלמדת מהפעם הראשונה.

## צ'אט "💬 שינויים במערכת"
בקשות שאוהד כותב בתוך המערכת נשמרות בשרת:
1. `GET /api/dev/messages?status=new` עם `Authorization: Bearer $APOS_OPERATOR_TOKEN`.
2. לכל בקשה: לסמן in_progress (`POST /api/dev/messages/:id/status`), לבצע, typecheck, בדיקות, build, commit, push, ולחכות לפריסה.
3. לענות ב-`POST /api/dev/messages` עם `role: "claude"`, `replyTo`, `status: "done"` וטקסט קצר בעברית.
   בקשה שדורשת החלטה או תשלום: שאלה ממוקדת עם `status: "in_progress"`. לא אפשרי: `declined` עם הסבר.

## פתוח כרגע
- Ancitech (עברית): להחליף לוגו בסגיר ולהוסיף קריאה לפעולה בסוף.
- Ancitech (אנגלית): קריינות באנגלית בלי "מיוצר בישראל", והחלפת לוגו.
  מחכה לאוהד: אישור טקסט הקריינות, בחירת קול, נוסח ה-CTA, והאם ליצור כרטיס סיום חדש.
- הכפתור "צ'אט ישיר ↗" ב-`web/src/components/DevChat.tsx` מפנה לסשן ענן ישן. צריך להפנות אותו למקום אחר או להסיר אותו.
