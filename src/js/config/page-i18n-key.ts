import overrides from './page-i18n-keys.json';

// Key of a page in tools.json: its file name in camelCase, unless
// page-i18n-keys.json names it differently. Build scripts read the same JSON.
export const pageI18nKey = (hrefOrFile: string): string => {
  const file = hrefOrFile
    .split(/[?#]/)[0]
    .split('/')
    .pop()!
    .replace(/\.html$/, '');
  return (
    (overrides as Record<string, string>)[file] ??
    file.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  );
};
