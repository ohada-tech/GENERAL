/**
 * History Manager — תמונות מצב של המסמך. בזכות copy-on-write על הקנבסים, כל מצב הוא שכפול של המאפיינים בלבד.
 * עד 60 מצבים (בפוטושופ 50 כברירת מחדל); המצב הראשון ("פתיחה") נשמר תמיד.
 */
import type { Doc, Layer } from './model';
import { cloneTree } from './model';
import { clonePaths } from './paths';

export interface Snap {
  label: string;
  layers: Layer[];
  width: number;
  height: number;
  selection: HTMLCanvasElement | null;
  channels: NonNullable<Doc['channels']>;
  /** נתיבים (פאנל Paths) — נתונים קטנים, שכפול עמוק */
  paths: NonNullable<Doc['paths']>;
  guides: { v: number[]; h: number[] };
  selected: string[];
  time: number;
}

export class History {
  states: Snap[] = [];
  index = -1;
  limit = 60;

  static take(doc: Doc, label: string, selected: string[]): Snap {
    return {
      label,
      layers: cloneTree(doc.layers),
      width: doc.width,
      height: doc.height,
      selection: doc.selection,
      channels: [...(doc.channels ?? [])],
      paths: clonePaths(doc.paths ?? []),
      guides: { v: [...doc.guides.v], h: [...doc.guides.h] },
      selected: [...selected],
      time: Date.now(),
    };
  }

  push(s: Snap) {
    this.states = this.states.slice(0, this.index + 1);
    this.states.push(s);
    if (this.states.length > this.limit) this.states.splice(1, this.states.length - this.limit);
    this.index = this.states.length - 1;
  }

  /** מחזיר את המסמך למצב i (שכפול — כדי שעריכה חיה לא תשנה את ההיסטוריה) */
  restore(doc: Doc, i: number): string[] {
    const s = this.states[i];
    this.index = i;
    doc.layers = cloneTree(s.layers);
    doc.width = s.width;
    doc.height = s.height;
    doc.selection = s.selection;
    doc.channels = [...s.channels];
    doc.paths = clonePaths(s.paths ?? []);
    doc.guides = { v: [...s.guides.v], h: [...s.guides.h] };
    return [...s.selected];
  }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.states.length - 1; }
}
