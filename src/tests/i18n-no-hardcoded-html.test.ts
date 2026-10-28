import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve, basename } from 'path';
import tools from '../../public/locales/en/tools.json';
import { pageI18nKey } from '../js/config/page-i18n-key';

// Every user-visible string in the HTML sources must come from the locale
// files: text through data-i18n / data-i18n-linked / data-i18n-faq, the
// title, placeholder, aria-label and alt attributes through data-i18n-<attr>.
// Proper nouns and symbols that read the same in every language are exempt.
const KEEP =
  /^(ballantynedewolf|Fubarpie|Schlemmy|Lemminary|suicidaleggroll|Jeffrey Jansma|nomandera|darcmage|Polar|Stripe|BentoPDF|Bento PDF|GitHub|Reddit|Trustpilot|Lemmy|Discord|X|PDF|PDFs|Kura|N-Up|Ctrl \+ K|⌘ \+ K|JPG|PNG|SVG|CSV|JSON|XML|ZIP|OCR|AGPL-3\.0|MIT|u\/\S+|@\S+|[\w.-]+@[\w.-]+|https?:\/\/\S+|[\w-]+\.(com|org|io|sk)|v?\d[\d.,\s%x×:/-]*\w{0,3}|[A-Z]{2,5}|[A-Z][a-z]+[A-Z]\w*|\w+\d\w*)$/;
const SKIP = 'script,style,svg,code,pre,noscript,kbd,textarea';
const COVERED =
  '[data-i18n],[data-i18n-faq],[data-i18n-linked],[translate="no"]';
const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'label'];

const root = resolve(__dirname, '../..');
const htmlFiles = (dir: string) =>
  readdirSync(join(root, dir))
    .filter((name) => name.endsWith('.html'))
    .map((name) => join(dir, name));

const needsKey = (text: string) =>
  /[A-Za-z]{2}/.test(text) && !text.includes('{{') && !KEEP.test(text);

function hardcoded(file: string): string[] {
  const doc = new DOMParser().parseFromString(
    readFileSync(join(root, file), 'utf-8'),
    'text/html'
  );
  const hasToolKey =
    file.startsWith('src/pages') &&
    pageI18nKey(basename(file)) in (tools as Record<string, unknown>);
  const found: string[] = [];
  const roots: ParentNode[] = [
    doc,
    ...Array.from(doc.querySelectorAll('template'), (tpl) => tpl.content),
  ];
  for (const r of roots) {
    const walker = doc.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!el || !needsKey(text) || el.closest(SKIP) || el.closest(COVERED))
        continue;
      if (el.tagName === 'TITLE' && hasToolKey) continue;
      found.push(`${file}: "${text}"`);
    }
    r.querySelectorAll('*').forEach((el) => {
      if (el.closest(SKIP)) return;
      for (const attr of ATTRS) {
        const value = el.getAttribute(attr)?.trim();
        if (value && needsKey(value) && !el.hasAttribute(`data-i18n-${attr}`))
          found.push(`${file}: ${attr}="${value}"`);
      }
    });
  }
  return found;
}

describe('HTML sources', () => {
  it('contain no hardcoded user-visible text', () => {
    const files = [
      ...htmlFiles('.'),
      ...htmlFiles('src/pages'),
      ...htmlFiles('src/partials'),
    ];
    expect(files.flatMap(hardcoded)).toEqual([]);
  }, 60_000);
});
