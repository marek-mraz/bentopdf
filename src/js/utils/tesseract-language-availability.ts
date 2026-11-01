import { tesseractLanguages } from '../config/tesseract-languages.js';

import i18next, { trText } from '../i18n/i18n.js';

export const TESSERACT_AVAILABLE_LANGUAGES_ENV_KEY =
  'VITE_TESSERACT_AVAILABLE_LANGUAGES' as const;

type TesseractAvailabilityEnv = Partial<
  Pick<ImportMetaEnv, typeof TESSERACT_AVAILABLE_LANGUAGES_ENV_KEY>
>;

export type TesseractLanguageCode = keyof typeof tesseractLanguages;

function getDefaultEnv(): TesseractAvailabilityEnv {
  return import.meta.env;
}

function normalizeLanguageCodes(value: string | string[]): string[] {
  const rawCodes = Array.isArray(value) ? value : value.split(/[+,]/);
  const seen = new Set<string>();
  const normalizedCodes: string[] = [];

  for (const rawCode of rawCodes) {
    const code = rawCode.trim();
    if (!code || seen.has(code)) {
      continue;
    }
    seen.add(code);
    normalizedCodes.push(code);
  }

  return normalizedCodes;
}

// Codes that are not BCP 47 tags, mapped to the language Intl names.
const INTL_TAGS: Record<string, string> = {
  chi_sim: 'zh-Hans',
  chi_tra: 'zh-Hant',
  frk: 'de',
  ita_old: 'it',
  kat_old: 'ka',
  spa_old: 'es',
};

/** The name of an OCR language in the interface language. */
export function tesseractLanguageName(code: string): string {
  const english = tesseractLanguages[code as TesseractLanguageCode];
  const lang = i18next.language || 'en';
  if (lang.startsWith('en')) return english ?? code;
  try {
    const name = new Intl.DisplayNames([lang], {
      type: 'language',
      fallback: 'none',
    }).of(INTL_TAGS[code] ?? code.replace('_', '-'));
    if (name) {
      const capitalized =
        name.charAt(0).toLocaleUpperCase(lang) + name.slice(1);
      if (code === 'frk')
        return trText('{{name}} (Fraktur)', { name: capitalized });
      if (code.endsWith('_old'))
        return trText('{{name}} (Old)', { name: capitalized });
      return capitalized;
    }
  } catch {
    // Unknown tag or no Intl data for the language: keep the English name.
  }
  return english ?? code;
}

function formatLanguageLabel(code: string): string {
  return code in tesseractLanguages
    ? `${tesseractLanguageName(code)} (${code})`
    : code;
}

export function resolveConfiguredTesseractAvailableLanguages(
  env: TesseractAvailabilityEnv = getDefaultEnv()
): string[] | null {
  const configuredLanguages = env.VITE_TESSERACT_AVAILABLE_LANGUAGES?.trim();
  if (!configuredLanguages) {
    return null;
  }

  return normalizeLanguageCodes(configuredLanguages);
}

export function getAvailableTesseractLanguageEntries(
  env: TesseractAvailabilityEnv = getDefaultEnv()
): Array<[TesseractLanguageCode, string]> {
  const configuredLanguages = resolveConfiguredTesseractAvailableLanguages(env);
  const allEntries = Object.entries(tesseractLanguages) as Array<
    [TesseractLanguageCode, string]
  >;

  const configuredSet = configuredLanguages && new Set(configuredLanguages);
  return allEntries
    .filter(([code]) => !configuredSet || configuredSet.has(code))
    .map(([code]) => [code, tesseractLanguageName(code)]);
}

export function getUnavailableTesseractLanguages(
  requestedLanguages: string | string[],
  env: TesseractAvailabilityEnv = getDefaultEnv()
): string[] {
  const configuredLanguages = resolveConfiguredTesseractAvailableLanguages(env);
  if (!configuredLanguages) {
    return [];
  }

  const configuredSet = new Set(configuredLanguages);
  return normalizeLanguageCodes(requestedLanguages).filter(
    (code) => !configuredSet.has(code)
  );
}

export function formatTesseractLanguageList(codes: string[]): string {
  return codes.map(formatLanguageLabel).join(', ');
}

function buildUnsupportedLanguageMessage(
  unavailableLanguages: string[],
  availableLanguages: string[]
): string {
  const unavailableText = formatTesseractLanguageList(unavailableLanguages);
  const availableText = formatTesseractLanguageList(availableLanguages);

  return [
    trText('This BentoPDF build only bundles OCR data for {{availableText}}.', {
      availableText,
    }),
    trText(
      'The requested OCR language is not available: {{unavailableText}}.',
      { unavailableText }
    ),
    trText(
      'Choose one of the bundled languages or rebuild the air-gapped bundle with the missing language added to --ocr-languages.'
    ),
  ].join(' ');
}

export class UnsupportedOcrLanguageError extends Error {
  readonly unavailableLanguages: string[];
  readonly availableLanguages: string[];

  constructor(unavailableLanguages: string[], availableLanguages: string[]) {
    super(
      buildUnsupportedLanguageMessage(unavailableLanguages, availableLanguages)
    );
    this.name = 'UnsupportedOcrLanguageError';
    this.unavailableLanguages = unavailableLanguages;
    this.availableLanguages = availableLanguages;
  }
}

export function assertTesseractLanguagesAvailable(
  requestedLanguages: string | string[],
  env: TesseractAvailabilityEnv = getDefaultEnv()
): void {
  const availableLanguages = resolveConfiguredTesseractAvailableLanguages(env);
  if (!availableLanguages) {
    return;
  }

  const unavailableLanguages = getUnavailableTesseractLanguages(
    requestedLanguages,
    env
  );

  if (unavailableLanguages.length > 0) {
    throw new UnsupportedOcrLanguageError(
      unavailableLanguages,
      availableLanguages
    );
  }
}
