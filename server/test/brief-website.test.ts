import { briefSchema } from '@apos/shared';
import { describe, expect, it } from 'vitest';
import { briefToText } from '../src/providers/prompts.js';

describe('Brief: client website and links reach the AI', () => {
  it('includes the website and every link with a URL', () => {
    const brief = briefSchema.parse({
      productOrService: 'אפליקציה',
      website: 'https://example.com',
      links: [
        { label: 'אינסטגרם', url: 'https://instagram.com/example' },
        { label: 'ריק', url: '' },
      ],
    });
    const text = briefToText({ name: 'פרויקט', clientName: 'לקוח', brief, lessons: [] } as any);
    expect(text).toContain('- Client website: https://example.com');
    expect(text).toContain('- Links: אינסטגרם: https://instagram.com/example');
    expect(text).not.toContain('ריק');
  });
});
