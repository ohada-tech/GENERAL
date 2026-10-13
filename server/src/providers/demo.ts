/**
 * ספק הדגמה — מייצר תוכן תבניתי מתוך הבריף, ללא קריאה למודל.
 * נועד לבדיקת זרימת העבודה בלי מפתח API. כל תוצר שלו מסומן "DEMO" במערכת.
 */
import type { ScriptContent, ShotFields } from '@apos/shared';
import type { GenResult, ProjectContext, ScriptDraft, TextProvider } from './types.js';

export class DemoTextProvider implements TextProvider {
  readonly id = 'demo';
  readonly label = 'הדגמה (ללא AI)';
  readonly isDemo = true;

  isConfigured() {
    return true;
  }

  async generateScript(ctx: ProjectContext): Promise<GenResult<ScriptDraft>> {
    const b = ctx.brief;
    const total = b.durationSec || 30;
    const parts: Array<[string, number]> = [
      ['hook', 0.15],
      ['problem', 0.2],
      ['solution', 0.3],
      ['benefit', 0.2],
      ['cta', 0.15],
    ];
    const scenes = parts.map(([role, share]) => ({
      storyRole: role,
      narration: `[DEMO] ${role === 'hook' ? b.keyMessage || b.goal : role === 'cta' ? `${ctx.clientName} — ${b.goal}` : `${b.productOrService} עבור ${b.targetAudience}`}`.trim(),
      onScreenText: role === 'cta' ? ctx.clientName : '',
      visualAction: `[DEMO] ${b.visualStyle || 'סגנון חזותי'} — סצנת ${role}`,
      estDurationSec: Math.round(total * share),
      notes: 'תוכן הדגמה — לא נוצר ע"י מודל',
    }));
    return {
      data: { title: `[DEMO] ${ctx.name}`, logline: `[DEMO] ${b.keyMessage}`, scenes },
      provider: this.id,
      model: 'demo-template',
    };
  }

  async reviseScript(_ctx: ProjectContext, base: ScriptContent, feedback: string): Promise<GenResult<ScriptDraft>> {
    return {
      data: {
        title: base.title,
        logline: base.logline,
        scenes: base.scenes.map(({ id: _id, ...s }) => ({ ...s, notes: `[DEMO] משוב שלא יושם בפועל: ${feedback}` })),
      },
      provider: this.id,
      model: 'demo-template',
    };
  }

  async generateStoryboard(
    _ctx: ProjectContext,
    script: ScriptContent,
    defaults: { imageModel: string; animationModel: string },
  ): Promise<GenResult<ShotFields[]>> {
    const shots = script.scenes.map((s, i) => ({
      sceneIndex: i,
      narration: s.narration,
      durationSec: s.estDurationSec,
      action: s.visualAction,
      shotType: '[DEMO] Medium shot',
      cameraAngle: 'Eye level',
      composition: '',
      movement: '',
      lens: '',
      lighting: '',
      colorMood: '',
      character: '',
      wardrobe: '',
      consistencyNotes: '',
      imagePrompt: `[DEMO] ${s.visualAction}`,
      animationPrompt: '[DEMO]',
      imageModel: defaults.imageModel,
      animationModel: defaults.animationModel,
      animationModelReason: 'ברירת מחדל של הפרויקט (DEMO)',
    }));
    return { data: shots, provider: this.id, model: 'demo-template' };
  }
}
