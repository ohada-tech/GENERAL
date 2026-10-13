/**
 * בנייה של גרסת הענן: קובץ HTML יחיד שרץ כ-Artifact ב-claude.ai.
 * קוד ה-workflow של השרת נטען כמו שהוא; רק שכבת ה-DB ומודולי Node מוחלפים.
 */
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDb = path.resolve(here, '../server/src/db/db.ts');
const browserDb = path.resolve(here, 'src/cloud/db-browser.ts');
const stub = (f: string) => path.resolve(here, 'src/cloud/stubs', f);

/** מפנה את server/src/db/db.ts (node:sqlite) לגרסה הדפדפנית (sql.js). */
function browserDbPlugin(): Plugin {
  return {
    name: 'apos-browser-db',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !/[\\/]server[\\/]src[\\/]/.test(importer) && !importer.includes('/src/cloud/')) return null;
      if (!/(^|\/)db(\.js|\.ts)?$/.test(source)) return null;
      const r = await this.resolve(source.replace(/\.js$/, '.ts'), importer, { ...options, skipSelf: true });
      return r && path.normalize(r.id) === serverDb ? browserDb : null;
    },
  };
}

// CLOUD_SINGLE=1 → קובץ אחד; ברירת מחדל: עמוד קטן + קבצי JS/CSS/גופנים נפרדים (מתאים ל-Artifact מרובה קבצים)
const single = process.env.CLOUD_SINGLE === '1';

export default defineConfig({
  base: './',
  plugins: [browserDbPlugin(), react(), ...(single ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
  resolve: {
    alias: [
      { find: /^(node:)?fs$/, replacement: stub('fs.ts') },
      { find: /^(node:)?path$/, replacement: stub('path.ts') },
      { find: /^(node:)?stream\/promises$/, replacement: stub('stream.ts') },
      { find: /^node:sqlite$/, replacement: stub('sqlite.ts') },
      { find: /^(node:)?child_process$/, replacement: stub('child_process.ts') },
      { find: /^(node:)?util$/, replacement: stub('util.ts') },
    ],
  },
  build: {
    outDir: 'dist-cloud',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: single ? 100_000_000 : 0,
    modulePreload: false,
    rollupOptions: { input: path.resolve(here, 'cloud.html') },
  },
});
