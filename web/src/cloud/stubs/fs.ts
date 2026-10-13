// בגרסת הענן אין מערכת קבצים — הקוד שנוגע בדיסק (מפתחות OpenAI, העלאות) מוחלף בנתיבים ייעודיים.
const unavailable = () => {
  throw new Error('מערכת קבצים לא זמינה בגרסת הענן');
};
export const existsSync = () => false;
export const mkdirSync = () => undefined;
export const readFileSync = unavailable;
export const writeFileSync = unavailable;
export const rmSync = () => undefined;
export const statSync = unavailable;
export const createReadStream = unavailable;
export const createWriteStream = unavailable;
export default { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, createReadStream, createWriteStream };
