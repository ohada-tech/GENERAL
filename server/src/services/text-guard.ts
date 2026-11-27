/**
 * שומר קידוד: טקסט שהגיע מסשן או סקריפט בקידוד שגוי (למשל curl מ-Windows בלי UTF-8) מגיע כ-"����".
 * את המידע כבר אי אפשר לשחזר, אז לא שומרים אותו — מחזירים 400 כדי שהשולח ישלח שוב נכון,
 * במקום הודעה שבורה בצ'אט או ב"מחכה לך".
 */
import { GateError } from '../context.js';

export function isGarbled(text: string): boolean {
  const bad = (text.match(/�/g) ?? []).length;
  return bad >= 3 && bad / Math.max(1, text.replace(/\s/g, '').length) > 0.05;
}

export function assertReadableText(text: string) {
  if (isGarbled(text))
    throw new GateError('הטקסט הגיע בקידוד שבור (����) — Text arrived with broken encoding: write the JSON body to a UTF-8 file and send it with curl --data-binary @file', 400);
}
