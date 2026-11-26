/** פונטים זמינים בעורך: גוגל פונטס (עברית + לטינית) נטענים לפי דרישה, ובנוסף פונטים שהמשתמש מעלה. */

export interface FontDef { family: string; spec: string; hebrew: boolean; weights: number[] }

const w = (a: number, b: number) => [100, 200, 300, 400, 500, 600, 700, 800, 900].filter((x) => x >= a && x <= b);

export const FONTS: FontDef[] = [
  { family: 'Assistant', spec: 'Assistant:wght@200..800', hebrew: true, weights: w(200, 800) },
  { family: 'Heebo', spec: 'Heebo:wght@100..900', hebrew: true, weights: w(100, 900) },
  { family: 'Rubik', spec: 'Rubik:ital,wght@0,300..900;1,300..900', hebrew: true, weights: w(300, 900) },
  { family: 'Frank Ruhl Libre', spec: 'Frank+Ruhl+Libre:wght@300..900', hebrew: true, weights: w(300, 900) },
  { family: 'Noto Sans Hebrew', spec: 'Noto+Sans+Hebrew:wght@100..900', hebrew: true, weights: w(100, 900) },
  { family: 'Noto Serif Hebrew', spec: 'Noto+Serif+Hebrew:wght@100..900', hebrew: true, weights: w(100, 900) },
  { family: 'IBM Plex Sans Hebrew', spec: 'IBM+Plex+Sans+Hebrew:wght@100;200;300;400;500;600;700', hebrew: true, weights: w(100, 700) },
  { family: 'Secular One', spec: 'Secular+One', hebrew: true, weights: [400] },
  { family: 'Suez One', spec: 'Suez+One', hebrew: true, weights: [400] },
  { family: 'Varela Round', spec: 'Varela+Round', hebrew: true, weights: [400] },
  { family: 'Alef', spec: 'Alef:wght@400;700', hebrew: true, weights: [400, 700] },
  { family: 'Karantina', spec: 'Karantina:wght@300;400;700', hebrew: true, weights: [300, 400, 700] },
  { family: 'Bellefair', spec: 'Bellefair', hebrew: true, weights: [400] },
  { family: 'Miriam Libre', spec: 'Miriam+Libre:wght@400..700', hebrew: true, weights: w(400, 700) },
  { family: 'David Libre', spec: 'David+Libre:wght@400;500;700', hebrew: true, weights: [400, 500, 700] },
  { family: 'Amatic SC', spec: 'Amatic+SC:wght@400;700', hebrew: true, weights: [400, 700] },
  { family: 'Fredoka', spec: 'Fredoka:wght@300..700', hebrew: true, weights: w(300, 700) },
  { family: 'Open Sans', spec: 'Open+Sans:ital,wght@0,300..800;1,300..800', hebrew: true, weights: w(300, 800) },
  { family: 'Inter', spec: 'Inter:ital,wght@0,100..900;1,100..900', hebrew: false, weights: w(100, 900) },
  { family: 'Montserrat', spec: 'Montserrat:ital,wght@0,100..900;1,100..900', hebrew: false, weights: w(100, 900) },
  { family: 'Poppins', spec: 'Poppins:wght@100;200;300;400;500;600;700;800;900', hebrew: false, weights: w(100, 900) },
  { family: 'Roboto', spec: 'Roboto:ital,wght@0,100..900;1,100..900', hebrew: false, weights: w(100, 900) },
  { family: 'Oswald', spec: 'Oswald:wght@200..700', hebrew: false, weights: w(200, 700) },
  { family: 'Bebas Neue', spec: 'Bebas+Neue', hebrew: false, weights: [400] },
  { family: 'Anton', spec: 'Anton', hebrew: false, weights: [400] },
  { family: 'Archivo Black', spec: 'Archivo+Black', hebrew: false, weights: [400] },
  { family: 'Playfair Display', spec: 'Playfair+Display:ital,wght@0,400..900;1,400..900', hebrew: false, weights: w(400, 900) },
  { family: 'DM Serif Display', spec: 'DM+Serif+Display', hebrew: false, weights: [400] },
  { family: 'Cormorant Garamond', spec: 'Cormorant+Garamond:ital,wght@0,300..700;1,300..700', hebrew: false, weights: w(300, 700) },
];

let loaded = false;
/** טוען את קובצי ה-CSS של גוגל (הקבצים עצמם יורדים רק כשפונט באמת בשימוש) — קישור לכל פונט, כדי שתקלה באחד לא תפיל את כולם */
export function loadGoogleFonts() {
  if (loaded) return;
  loaded = true;
  for (const f of FONTS) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${f.spec}&display=swap`;
    document.head.appendChild(l);
  }
}

export const weightsOf = (family: string) => FONTS.find((f) => f.family === family)?.weights ?? [100, 200, 300, 400, 500, 600, 700, 800, 900];

export const WEIGHT_NAMES: Record<number, string> = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
