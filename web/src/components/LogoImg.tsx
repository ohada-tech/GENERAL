import { useState } from 'react';

/**
 * לוגו של לקוח: בודק אם הלוגו בהיר (למשל לבן על שקוף) ומסמן אותו ב-logo-light,
 * כדי שהרקע יהיה כהה ולא ייבלע. הקבצים מאותו מקור, אז הקנבס לא "מזוהם".
 */
export function LogoImg({ src, className = '', alt = '' }: { src: string; className?: string; alt?: string }) {
  const [light, setLight] = useState(false);
  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    try {
      const img = e.currentTarget;
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) return;
      g.drawImage(img, 0, 0, 32, 32);
      const d = g.getImageData(0, 0, 32, 32).data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3]! < 60) continue;
        sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
        n++;
      }
      // רוב הפיקסלים הגלויים בהירים, והתמונה לא אטומה כולה (לוגו על רקע לבן מלא אינו "בהיר")
      setLight(n > 20 && n < 1024 * 0.92 && sum / n > 205);
    } catch {
      /* לא ניתן לקרוא את התמונה — נשארים עם הרקע הבהיר */
    }
  };
  return <img src={src} alt={alt} loading="lazy" className={`${className} ${light ? 'logo-light' : ''}`.trim()} onLoad={onLoad} />;
}
