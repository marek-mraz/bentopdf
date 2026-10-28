import { describe, it, expect } from 'vitest';
import { categories } from '../js/config/tools';
import { pageI18nKey } from '../js/config/page-i18n-key';
import enTools from '../../public/locales/en/tools.json';
import skTools from '../../public/locales/sk/tools.json';

type Tools = Record<string, Record<string, unknown> | undefined>;
const bundles: Record<string, Tools> = {
  en: enTools as unknown as Tools,
  sk: skTools as unknown as Tools,
};

describe('tool names and subtitles on the home page', () => {
  for (const [lang, tools] of Object.entries(bundles)) {
    it(`resolve in ${lang} for every tool`, () => {
      const missing: string[] = [];
      for (const category of categories)
        for (const tool of category.tools) {
          const entry = tools[pageI18nKey(tool.href)];
          if (typeof entry?.name !== 'string')
            missing.push(`${tool.href} name`);
          if (tool.subtitle && typeof entry?.subtitle !== 'string')
            missing.push(`${tool.href} subtitle`);
        }
      expect(missing).toEqual([]);
    });
  }

  it('Slovak names differ from English except for brand-like names', () => {
    const same = new Set(['pdfEditor', 'nUpPdf']);
    const english: string[] = [];
    for (const category of categories)
      for (const tool of category.tools) {
        const key = pageI18nKey(tool.href);
        if (!same.has(key) && bundles.sk[key]?.name === bundles.en[key]?.name)
          english.push(key);
      }
    expect(english).toEqual([]);
  });
});
