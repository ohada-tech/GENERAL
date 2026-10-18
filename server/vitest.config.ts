import { defineConfig } from 'vitest/config';

// בדיקות שמעלות את השרת (buildApp) לוקחות כמה שניות כשהמחשב עמוס — 5 שניות של ברירת המחדל לא מספיקות
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
