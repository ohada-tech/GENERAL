import type { Config } from '../config.js';
import { AnthropicTextProvider } from './anthropic.js';
import { CollabTextProvider } from './collab.js';
import { DemoTextProvider } from './demo.js';
import { KieClient } from './kie.js';
import { OpenAITextProvider } from './openai.js';
import type { TextProvider } from './types.js';

export interface Providers {
  text: Record<string, TextProvider>;
  /** מחולל מדיה (תמונה/וידאו/קול/מוזיקה) — KIE */
  media: KieClient;
}

export function createProviders(config: Config, fetchFn: typeof fetch = fetch): Providers {
  const openai = new OpenAITextProvider(config.openai, fetchFn);
  const claude = new AnthropicTextProvider(config.anthropic);
  return {
    text: {
      collab: new CollabTextProvider(openai, claude),
      'collab:claude': new CollabTextProvider(claude, openai),
      openai,
      claude,
      demo: new DemoTextProvider(),
    },
    media: new KieClient(config.kie, fetchFn),
  };
}

export function describeProviders(p: Providers) {
  return Object.entries(p.text)
    .filter(([k]) => !k.includes(':'))
    .map(([, t]) => ({
      id: t.id,
      label: t.label,
      configured: t.isConfigured(),
      demo: t.isDemo,
    }));
}
