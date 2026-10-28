import i18next from 'i18next';
import HttpBackend from 'i18next-http-backend';
import { getStoredItem, setStoredItem } from '../utils/safe-storage.js';
import enCommon from '../../../public/locales/en/common.json';
import enTools from '../../../public/locales/en/tools.json';

// Supported languages
export const supportedLanguages = [
  'en',
  'ar',
  'be',
  'ru',
  'fr',
  'de',
  'es',
  'zh',
  'zh-TW',
  'vi',
  'tr',
  'id',
  'it',
  'pt',
  'pl',
  'nl',
  'da',
  'sv',
  'ko',
  'ja',
  'uk',
  'sk',
  'ca',
  'fa',
] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const languageNames: Record<SupportedLanguage, string> = {
  en: 'English',
  ar: 'العربية',
  be: 'Беларуская',
  ru: 'Русский',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  zh: '中文',
  'zh-TW': '繁體中文（台灣）',
  vi: 'Tiếng Việt',
  tr: 'Türkçe',
  id: 'Bahasa Indonesia',
  it: 'Italiano',
  pt: 'Português',
  pl: 'Polski',
  nl: 'Nederlands',
  da: 'Dansk',
  sv: 'Svenska',
  ko: '한국어',
  ja: '日本語',
  uk: 'Українська',
  sk: 'Slovenčina',
  ca: 'Català',
  fa: 'فارسی',
};

export const getLanguageFromUrl = (): SupportedLanguage => {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  let path = window.location.pathname;

  if (basePath && basePath !== '/' && path.startsWith(basePath)) {
    path = path.slice(basePath.length) || '/';
  }

  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  const langMatch = path.match(
    /^\/(en|ar|fr|es|de|zh|zh-TW|vi|tr|id|it|pt|nl|be|da|ko|sv|ru|ja|uk|sk|ca|fa)(?:\/|$)/
  );
  if (
    langMatch &&
    supportedLanguages.includes(langMatch[1] as SupportedLanguage)
  ) {
    return langMatch[1] as SupportedLanguage;
  }

  const storedLang = getStoredItem('i18nextLng');
  if (
    storedLang &&
    supportedLanguages.includes(storedLang as SupportedLanguage)
  ) {
    return storedLang as SupportedLanguage;
  }

  // Check browser language preferences
  if (typeof navigator !== 'undefined' && navigator.languages) {
    for (const lang of navigator.languages) {
      if (supportedLanguages.includes(lang as SupportedLanguage)) {
        return lang as SupportedLanguage;
      }

      const primaryLang = lang.split('-')[0];
      if (supportedLanguages.includes(primaryLang as SupportedLanguage)) {
        return primaryLang as SupportedLanguage;
      }
    }
  }

  const envLang = import.meta.env?.VITE_DEFAULT_LANGUAGE;
  if (envLang && supportedLanguages.includes(envLang as SupportedLanguage)) {
    return envLang as SupportedLanguage;
  }

  return 'en';
};

let initPromise: Promise<typeof i18next> | null = null;

// Pages that build their UI on DOMContentLoaded await this before calling t();
// every caller shares the one load main.ts starts.
export const initI18n = (): Promise<typeof i18next> =>
  (initPromise ??= loadI18n());

const loadI18n = async (): Promise<typeof i18next> => {
  const currentLang = getLanguageFromUrl();

  setStoredItem('i18nextLng', currentLang);

  await i18next.use(HttpBackend).init({
    lng: currentLang,
    fallbackLng: 'en',
    supportedLngs: supportedLanguages as unknown as string[],
    ns: ['common', 'tools'],
    defaultNS: 'common',
    preload: [currentLang],
    partialBundledLanguages: true,
    resources: {
      en: {
        common: enCommon,
        tools: enTools,
      },
    },
    backend: {
      loadPath: `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}locales/{{lng}}/{{ns}}.json`,
    },
    interpolation: {
      escapeValue: false,
    },
  });

  await i18next.loadNamespaces('tools');

  return i18next;
};

// Page scripts start here instead of on DOMContentLoaded: DOMContentLoaded
// fires before the page language is fetched, and t() would answer in English.
export const onPageReady = (init: () => unknown): void => {
  const run = () => {
    initI18n().then(
      () => init(),
      (error) => {
        console.error('[i18n] Translations failed to load:', error);
        init();
      }
    );
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
};

// Before initI18n() finishes (e.g. a loader shown on page start), answer from
// the bundled English strings instead of returning undefined.
const englishFallback = (
  key: string,
  options?: Record<string, unknown>
): string => {
  const [ns, path] = key.includes(':') ? key.split(':', 2) : ['common', key];
  const bundle = ns === 'tools' ? enTools : enCommon;
  const value = path
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      bundle
    );
  if (typeof value !== 'string') return key;
  return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    options?.[name] != null ? String(options[name]) : match
  );
};

export const t = (key: string, options?: Record<string, unknown>): string => {
  if (!i18next.isInitialized) return englishFallback(key, options);
  return i18next.t(key, options);
};

export const changeLanguage = (lang: SupportedLanguage): void => {
  if (!supportedLanguages.includes(lang)) return;
  setStoredItem('i18nextLng', lang);

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  let relativePath = window.location.pathname;

  if (basePath && basePath !== '/' && relativePath.startsWith(basePath)) {
    relativePath = relativePath.slice(basePath.length) || '/';
  }

  if (!relativePath.startsWith('/')) {
    relativePath = '/' + relativePath;
  }

  let pagePathWithoutLang = relativePath;
  const langPrefixMatch = relativePath.match(
    /^\/(en|ar|fr|es|de|zh|zh-TW|vi|tr|id|it|pt|nl|be|da|ko|sv|ru|ja|uk|sk|ca|fa)(\/.*)?$/
  );
  if (langPrefixMatch) {
    pagePathWithoutLang = langPrefixMatch[2] || '/';
  }

  if (!pagePathWithoutLang.startsWith('/')) {
    pagePathWithoutLang = '/' + pagePathWithoutLang;
  }

  let newRelativePath: string;
  if (lang === 'en') {
    newRelativePath = pagePathWithoutLang;
  } else {
    newRelativePath =
      pagePathWithoutLang === '/'
        ? `/${lang}`
        : `/${lang}${pagePathWithoutLang}`;
  }

  let newPath: string;
  if (basePath && basePath !== '/') {
    newPath = basePath + newRelativePath;
  } else {
    newPath = newRelativePath;
  }

  newPath = newPath.replace(/\/+/g, '/');

  const newUrl = newPath + window.location.search + window.location.hash;
  window.location.href = newUrl;
};

// Puts a translated string into an element that contains links or other
// inline elements: [0]text[/0] stands for its first child element, [1] for
// the second, and so on. Same rules as scripts/i18n-linked-text.mjs.
const applyLinkedText = (element: Element, translation: string): boolean => {
  const children = Array.from(element.children);
  const nodes: Node[] = [];
  for (const part of translation.split(/(\[\d+\][^[\]]*\[\/\d+\])/)) {
    const match = part.match(/^\[(\d+)\]([^[\]]*)\[\/\1\]$/);
    if (!match) {
      if (/\[\/?\d+\]/.test(part)) return false;
      if (part) nodes.push(document.createTextNode(part));
      continue;
    }
    const child = children[Number(match[1])];
    if (!child) return false;
    const clone = child.cloneNode(false);
    clone.textContent = match[2];
    nodes.push(clone);
  }
  element.replaceChildren(...nodes);
  return true;
};

const I18N_ATTRIBUTES = [
  'placeholder',
  'title',
  'aria-label',
  'alt',
  'label',
  'content',
];

// Translates data-i18n* elements in the document and inside <template>s, so
// UI cloned from a template later is already translated.
export const applyTranslations = (): void => {
  const roots: ParentNode[] = [
    document,
    ...Array.from(document.querySelectorAll('template'), (tpl) => tpl.content),
  ];
  const translated = (key: string | null): string | null => {
    if (!key) return null;
    const value = t(key);
    return value && value !== key ? value : null;
  };

  for (const root of roots) {
    root.querySelectorAll('[data-i18n]').forEach((element) => {
      const value = translated(element.getAttribute('data-i18n'));
      if (value) element.textContent = value;
    });

    root.querySelectorAll('[data-i18n-linked]').forEach((element) => {
      const value = translated(element.getAttribute('data-i18n-linked'));
      if (value) applyLinkedText(element, value);
    });

    for (const attr of I18N_ATTRIBUTES) {
      root.querySelectorAll(`[data-i18n-${attr}]`).forEach((element) => {
        const value = translated(element.getAttribute(`data-i18n-${attr}`));
        if (value) element.setAttribute(attr, value);
      });
    }
  }

  document.documentElement.lang = i18next.language;
  document.documentElement.dir = ['ar', 'fa'].includes(i18next.language)
    ? 'rtl'
    : 'ltr';
};

export const rewriteLinks = (): void => {
  const currentLang = getLanguageFromUrl();
  if (currentLang === 'en') return;

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const links = document.querySelectorAll('a[href]');

  links.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    if (
      href.startsWith('http') ||
      href.startsWith('//') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('#') ||
      href.startsWith('javascript:') ||
      href.startsWith('data:') ||
      href.startsWith('vbscript:')
    ) {
      return;
    }

    if (href.includes('/assets/')) {
      return;
    }

    const langPrefixRegex = new RegExp(
      `^(${basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})?/?(en|ar|fr|es|de|zh|zh-TW|vi|tr|id|it|pt|nl|be|da|ko|sv|ru|ja|uk|sk|ca|fa)(/|$)`
    );
    if (langPrefixRegex.test(href)) {
      return;
    }

    let newHref: string;
    if (basePath && basePath !== '/' && href.startsWith(basePath)) {
      const pathAfterBase = href.slice(basePath.length);
      newHref = `${basePath}/${currentLang}${pathAfterBase}`;
    } else if (href.startsWith('/')) {
      if (basePath && basePath !== '/') {
        newHref = `${basePath}/${currentLang}${href}`;
      } else {
        newHref = `/${currentLang}${href}`;
      }
    } else if (href === '' || href === 'index.html') {
      if (basePath && basePath !== '/') {
        newHref = `${basePath}/${currentLang}/`;
      } else {
        newHref = `/${currentLang}/`;
      }
    } else {
      newHref = `/${currentLang}/${href}`;
    }

    newHref = newHref
      .replace(/([^:])\/+/g, '$1/')
      .replace(/^([^?#]*[^/?#])\/(?=$|[?#])/, '$1');

    link.setAttribute('href', newHref);
  });
};

export default i18next;
