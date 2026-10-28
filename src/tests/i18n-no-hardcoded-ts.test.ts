import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import ts from 'typescript';

// English string literals must not reach the UI from TypeScript: what goes
// to alerts, loaders, status lines, textContent, title, placeholder and
// markup assigned through innerHTML has to come from t(). Low-level
// diagnostics (canvas, worker, parser, HTTP) may stay English in thrown
// errors because the UI prefixes them with a translated message.
const SINK_CALLS = new Set([
  'showAlert',
  'showLoader',
  'showModal',
  'showAlertModal',
  'showConfirmModal',
  'showWarningModal',
  'showStatus',
  'showToast',
  'alert',
  'confirm',
  'onProgress',
  'progress',
]);
const SINK_PROPS = new Set([
  'textContent',
  'innerText',
  'title',
  'placeholder',
]);
const SINK_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt']);
const TECHNICAL =
  /canvas|toBlob|context|content stream|inline image|worker|module did not|did not expose|not initialized|^Failed to fetch|Failed to load script|font asset|offscreen|INVALID_PASSWORD|PASSWORD_REQUIRED|^Unknown error$|Unresolved optional|timed out|Page container|File list not found|Invalid shortcut|exit code|threw an exception|did not produce|^Invalid URL$|^No worker|crashed|empty decrypted|could not create PDF\/A|Failed to get 2D|substitute font|No PDF document loaded|^Converter|qpdf exit|callback must be/i;
const KEEP =
  /^(Ctrl \+ K|⌘ \+ K|PDF|OK|DPI|×|&times;|[A-Z]{2,6}(-[A-Z0-9]+)*|[\d\s.,%x×:/()+-]+\w{0,3})$/;
const SKIP_DIRS =
  /\/(workers|tests)\/|\/compare\/engine\/|config\/tools\.ts$|workflow\/nodes\/registry\.ts$|\.d\.ts$/;

const isEnglish = (text: string): boolean => {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s || KEEP.test(s) || /[{};]\s*$|\{[^}]*:[^}]*;/.test(s)) return false;
  if (/^[\w-]+$/.test(s)) return /^[A-Z][a-z]+$/.test(s);
  return /[A-Za-z]{2}/.test(s);
};

const root = resolve(__dirname, '../..');
const tsFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isTemplateExpression(node))
    return [
      node.head.text,
      ...node.templateSpans.map((s) => s.literal.text),
    ].join(' ');
  return null;
}

function findings(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf-8'),
    ts.ScriptTarget.Latest,
    true
  );
  const out: string[] = [];
  const where = (n: ts.Node) =>
    `${relative(root, file)}:${source.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const check = (node: ts.Node, technicalOk = false): void => {
    if (ts.isConditionalExpression(node)) {
      check(node.whenTrue, technicalOk);
      check(node.whenFalse, technicalOk);
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    ) {
      check(node.left, technicalOk);
      check(node.right, technicalOk);
      return;
    }
    if (ts.isParenthesizedExpression(node))
      return check(node.expression, technicalOk);
    const text = literalText(node);
    if (text == null || !isEnglish(text.replace(/<[^>]*>/g, ' '))) return;
    if (technicalOk && TECHNICAL.test(text)) return;
    out.push(`${where(node)} "${text.trim().slice(0, 80)}"`);
  };
  const checkMarkup = (node: ts.Node): void => {
    if (ts.isConditionalExpression(node)) {
      checkMarkup(node.whenTrue);
      checkMarkup(node.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      checkMarkup(node.left);
      checkMarkup(node.right);
      return;
    }
    const chunks = ts.isTemplateExpression(node)
      ? [node.head.text, ...node.templateSpans.map((s) => s.literal.text)]
      : ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? [node.text]
        : [];
    for (const chunk of chunks) {
      for (const [, text] of chunk.matchAll(/>([^<>]*)</g))
        if (isEnglish(text)) out.push(`${where(node)} markup "${text.trim()}"`);
      for (const [, , value] of chunk.matchAll(
        /\b(title|placeholder|aria-label|alt)="([^"$]*)"/g
      ))
        if (isEnglish(value)) out.push(`${where(node)} attribute "${value}"`);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      if (name === 't') return;
      const onConsole =
        ts.isPropertyAccessExpression(callee) &&
        callee.expression.getText() === 'console';
      if (SINK_CALLS.has(name) && !onConsole)
        node.arguments.forEach((a) => check(a));
      const [attr, value] = node.arguments;
      if (
        name === 'setAttribute' &&
        attr &&
        value &&
        ts.isStringLiteral(attr) &&
        SINK_ATTRS.has(attr.text)
      )
        check(value);
      if (name === 'insertAdjacentHTML' && value) checkMarkup(value);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left)
    ) {
      const prop = node.left.name.text;
      if (SINK_PROPS.has(prop) && node.left.expression.getText() !== 'document')
        check(node.right);
      if (prop === 'innerHTML' || prop === 'outerHTML') checkMarkup(node.right);
    }
    if (
      ts.isThrowStatement(node) &&
      node.expression &&
      ts.isNewExpression(node.expression) &&
      node.expression.arguments?.[0]
    )
      check(node.expression.arguments[0], true);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe('TypeScript sources', () => {
  it('send no hardcoded English to the UI', () => {
    const files = tsFiles(join(root, 'src/js')).filter(
      (f) => !SKIP_DIRS.test(f.replace(/\\/g, '/'))
    );
    expect(files.flatMap(findings)).toEqual([]);
  }, 60_000);
});
