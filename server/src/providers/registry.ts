import type { Config } from '../config.js';
import { DemoTextProvider } from './demo.js';
import { OpenAITextProvider } from './openai.js';
import type { TextProvider } from './types.js';

export interface Providers {
  text: Record<string, TextProvider>;
}

export function createProviders(config: Config, fetchFn: typeof fetch = fetch): Providers {
  return {
    text: {
      openai: new OpenAITextProvider(config.openai, fetchFn),
      demo: new DemoTextProvider(),
    },
  };
}

export function describeProviders(p: Providers) {
  return Object.values(p.text).map((t) => ({
    id: t.id,
    label: t.label,
    configured: t.isConfigured(),
    demo: t.isDemo,
  }));
}
