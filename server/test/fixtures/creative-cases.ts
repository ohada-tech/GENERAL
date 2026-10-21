/**
 * מקרי בדיקה לתהליך הקריאייטיבי. סינתטיים בלבד — הריפו ציבורי, אין כאן תוכן של לקוחות.
 * FEATURE_TOUR_FAIL משחזר את דפוסי הכשל של "קבע לי תור" v5.2 (בלי הטקסט שלו):
 * הוק גנרי של כאב שגרתי, מונטאז' בעלי מקצוע, סיור בפיצ'רים, פנייה חוזרת, רשימות שוטים, וקריינות ארוכה מהסרטון.
 */

export const BRIEFS = {
  /** סוג 1: SaaS לבעלי עסקים, עברית, 45 שניות (מקרה הכשל) */
  booking: {
    name: 'תורנית — פרסומת',
    client: 'תורנית',
    brief: {
      videoType: 'פרסומת ממומנת עם קריינות',
      goal: 'הרשמה לניסיון חינם',
      productOrService: 'תורנית: מערכת תורים שבה בעל העסק בונה לבד אתר לעסק עם קביעת תורים',
      targetAudience: 'בעלי עסקים קטנים שעובדים עם תורים',
      targetMarket: 'ישראל',
      keyMessage: 'אתר משלכם שהלקוחות קובעים בו תור לבד',
      cta: '14 ימי ניסיון חינם',
      platforms: ['Instagram Reels'],
      aspectRatio: '9:16',
      durationSec: 45,
      visualStyle: 'דוקומנטרי',
      language: 'עברית',
      tone: 'חם ובטוח',
      dueDate: '2026-02-01',
      notes: 'מבנה מחייב: 1. הוק 2. מי אתם 3. מה זה 4. איך בונים 5. הצד של הלקוחות 6. מה עוד מקבלים 7. CTA',
    },
    budget: 89,
  },
  /** סוג 2: נדל"ן, עברית, 30 שניות */
  land: {
    name: 'קרקעות בשרון — מודעה',
    client: 'קרקעות בשרון',
    brief: {
      videoType: 'מודעת לידים',
      goal: 'השארת פרטים לסיור בקרקע',
      productOrService: 'מגרשים לבנייה פרטית בשרון',
      targetAudience: 'זוגות בשנות ה-30 שגרים בשכירות במרכז',
      targetMarket: 'ישראל',
      keyMessage: 'בית פרטי על קרקע משלכם, שעה מתל אביב',
      cta: 'השאירו פרטים לסיור',
      platforms: ['Facebook'],
      aspectRatio: '9:16',
      durationSec: 30,
      visualStyle: 'סינמטי חם',
      language: 'עברית',
      tone: 'רגשי ובוגר',
      dueDate: '2026-02-01',
    },
    budget: 59,
  },
  /** סוג 3: B2B תעשייתי, אנגלית, 60 שניות */
  robots: {
    name: 'Arma Robotics — launch',
    client: 'Arma Robotics',
    brief: {
      videoType: 'Product launch film',
      goal: 'Book a demo',
      productOrService: 'Collaborative welding robot for small metal shops',
      targetAudience: 'Owners of metal workshops with 5–30 workers',
      targetMarket: 'USA',
      keyMessage: 'A welder that never calls in sick, set up in one afternoon',
      cta: 'Book a demo',
      platforms: ['LinkedIn'],
      aspectRatio: '16:9',
      durationSec: 60,
      visualStyle: 'Industrial, real workshop light',
      language: 'English',
      tone: 'Confident, plain-spoken',
      dueDate: '2026-02-01',
    },
    budget: 135,
  },
} as const;

const shot = (n: number) => `שוט 1 (2 שנ'): מאקרו על הידיים. שוט 2 (2 שנ'): רחב על העסק ${n}. שוט 3 (2 שנ'): מעל הכתף על המסך, עם מוקאפ בקוד ותנועת מצלמה עדינה ומעבר easing בין המסכים, הכל מצולם באור טבעי ובסגנון דוקומנטרי עם גריין עדין ופנים ישראליות מגוונות.`;

/** הכשל: נראה מפורט ומקצועי, אבל אין בו רעיון */
export const FEATURE_TOUR_FAIL = {
  title: 'הידיים עסוקות. התורים ממשיכים להיכנס.',
  logline: 'אתם עסוקים בעבודה שלכם, והלקוחות שלכם קובעים תורים בעצמם דרך האתר שלכם.',
  scenes: [
    { storyRole: 'hook', narration: 'אתם באמצע עבודה. הטלפון מצלצל. שוב.', onScreenText: '', visualAction: shot(1), estDurationSec: 3, notes: '' },
    { storyRole: 'problem', narration: 'מספרות, קוסמטיקאיות, מאמנים, מטפלים. אתם מכירים את זה. הידיים שלכם עסוקות, והלקוחות שלכם רוצים לקבוע תור דווקא עכשיו.', onScreenText: '', visualAction: shot(2), estDurationSec: 5, notes: '' },
    { storyRole: 'solution', narration: 'בדיוק בשביל זה יש את תורנית. מערכת שבה אתם בונים בעצמכם את האתר של העסק שלכם, והלקוחות שלכם קובעים בו תורים.', onScreenText: '', visualAction: shot(3), estDurationSec: 6, notes: '' },
    { storyRole: 'benefit', narration: 'ויש עוד משהו. אתם בוחרים מה להציג באתר שלכם. השירותים שלכם, המחירים, ואפילו המוצרים שאתם מוכרים בעסק שלכם.', onScreenText: '', visualAction: shot(4), estDurationSec: 6, notes: '' },
    { storyRole: 'benefit', narration: 'ואז מגיעה אחת עשרה בלילה. אתם כבר מזמן לא בעסק. אבל הלקוחות שלכם נכנסים לאתר של העסק שלכם, בוחרים שעה וקובעים תור.', onScreenText: '', visualAction: shot(5), estDurationSec: 8, notes: '' },
    { storyRole: 'benefit', narration: 'לפני התור, הלקוחות שלכם מקבלים תזכורת אוטומטית בוואטסאפ. פחות הברזות, פחות טלפונים. ואתם פותחים את היומן שלכם ורואים בדיוק מי מגיע.', onScreenText: '', visualAction: shot(6), estDurationSec: 8, notes: '' },
    { storyRole: 'cta', narration: 'האתר של העסק שלכם. התורים שהלקוחות שלכם קובעים בעצמם. הצטרפו לתורנית ותתחילו עם 14 ימי ניסיון בחינם, בלי כרטיס אשראי.', onScreenText: '', visualAction: shot(7), estDurationSec: 5, notes: '' },
    { storyRole: 'cta', narration: '', onScreenText: 'תורנית ✓\n14 ימי ניסיון חינם', visualAction: 'כרטיס סיום', estDurationSec: 4, notes: '' },
  ],
};

/** תסריט שעומד בבדיקות הקוד (רעיון אחד, קצר, בלי רשימות שוטים) — כדי לוודא שהבדיקות לא פוסלות הכל */
export const TIGHT_SCRIPT = {
  title: 'המספריים לא עוצרים',
  logline: 'בזמן שאתה גוזר, האתר שלך סוגר לך את השבוע.',
  scenes: [
    { storyRole: 'hook', narration: 'שלוש שיחות שלא נענו. ותספורת אחת מושלמת.', onScreenText: '', visualAction: 'ספר גוזר בריכוז, טלפון מהבהב בפינת הפריים.', estDurationSec: 6, notes: '' },
    { storyRole: 'problem', narration: 'כל שיחה כזאת היא לקוח שהלך למספרה ממול.', onScreenText: '', visualAction: 'הלקוח שלא נענה נכנס למספרה אחרת ברחוב.', estDurationSec: 7, notes: '' },
    { storyRole: 'solution', narration: 'אז בנית אתר. עשר דקות, לבד. עם כפתור אחד: קבע תור.', onScreenText: '', visualAction: 'הספר בהפסקה, בונה את האתר בטלפון.', estDurationSec: 9, notes: '' },
    { storyRole: 'benefit', narration: 'עכשיו הם קובעים לבד. גם באחת עשרה בלילה.', onScreenText: '', visualAction: 'לקוח במרפסת בלילה קובע תור בשתי לחיצות.', estDurationSec: 8, notes: '' },
    { storyRole: 'proof', narration: 'ומחר בבוקר, השבוע כבר מלא.', onScreenText: '', visualAction: 'יומן מלא על המסך, הספר מחייך עם הקפה.', estDurationSec: 7, notes: '' },
    { storyRole: 'cta', narration: 'תבנה את שלך. ארבעה עשר יום עלינו.', onScreenText: '14 ימי ניסיון חינם', visualAction: 'כרטיס סיום עם האתר בתוך מסגרת טלפון.', estDurationSec: 8, notes: '' },
  ],
};
