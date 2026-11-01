import { afterEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { tesseractLanguageName } from '../js/utils/tesseract-language-availability';

describe('tesseractLanguageName', () => {
  afterEach(async () => {
    await i18next.changeLanguage('en');
  });

  it('keeps the English names in English', async () => {
    await i18next.init({ lng: 'en', resources: {} });
    expect(tesseractLanguageName('deu')).toBe('German');
  });

  it('names languages in the interface language', async () => {
    await i18next.init({
      lng: 'sk',
      resources: {
        sk: { ui: { '{{name}} (Fraktur)': '{{name}} (fraktúra)' } },
      },
    });
    expect(tesseractLanguageName('deu')).toBe('Nemčina');
    expect(tesseractLanguageName('chi_sim')).toMatch(/^Čínština/);
    expect(tesseractLanguageName('frk')).toBe('Nemčina (fraktúra)');
  });

  it('falls back to the code when nobody knows the language', async () => {
    await i18next.init({ lng: 'sk', resources: {} });
    expect(tesseractLanguageName('xyz')).toBe('xyz');
  });
});
