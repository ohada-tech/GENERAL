/** פקודות של כלי הציור, הרטוש והמדידה — נקראות מ-Editor.run (תפריטים, כפתורים וקיצורים) */
import type { Editor } from './editor';
import { definePattern } from './patterns';
import { clearRuler, clearSamplers, straightenLayer } from './tools-measure';
import { runArtboardCmd } from './artboard-ops';

export function runToolCmd(ed: Editor, id: string): boolean {
  if (runArtboardCmd(ed, id)) return true;
  switch (id) {
    case 'edit.definePattern': definePattern(ed); return true;
    case 'view.resetRotation': ed.setViewRotation(0); return true;
    case 'ruler.straighten': straightenLayer(ed); return true;
    case 'ruler.clear': clearRuler(ed); return true;
    case 'sampler.clear': clearSamplers(ed); return true;
  }
  return false;
}
