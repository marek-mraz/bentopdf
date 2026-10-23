import { t } from '../i18n/i18n';
import type { NodeCategory } from './types';
import type { NodeRegistryEntry } from './nodes/registry';

const CATEGORY_KEYS: Record<NodeCategory, string> = {
  Input: 'tools:categories.input',
  'Edit & Annotate': 'tools:categories.editAnnotate',
  'Organize & Manage': 'tools:categories.organizeManage',
  'Optimize & Repair': 'tools:categories.optimizeRepair',
  'Secure PDF': 'tools:categories.securePdf',
  Output: 'tools:categories.output',
};

const SPECIAL_NODE_KEYS: Record<string, string> = {
  PDFInputNode: 'tools:pdfWorkflow.specialNodes.pdfInput',
  DownloadNode: 'tools:pdfWorkflow.specialNodes.download',
  DownloadPDFNode: 'tools:pdfWorkflow.specialNodes.download',
  DownloadZipNode: 'tools:pdfWorkflow.specialNodes.download',
};

function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// i18next answers a missing 'tools:a.b' with 'a.b', without the namespace.
function translateOrFallback(key: string, fallback: string): string {
  const value = t(key);
  const missing = value === key || value === key.slice(key.indexOf(':') + 1);
  return value && !missing ? value : fallback;
}

export function translateCategory(category: NodeCategory): string {
  const key = CATEGORY_KEYS[category];
  return translateOrFallback(key, category);
}

export function translateNodeLabel(
  nodeType: string,
  entry: NodeRegistryEntry
): string {
  const specialKey = SPECIAL_NODE_KEYS[nodeType];
  if (specialKey) {
    return translateOrFallback(`${specialKey}.name`, entry.label);
  }
  if (entry.toolPageId) {
    return translateOrFallback(
      `tools:${toCamelCase(entry.toolPageId)}.name`,
      entry.label
    );
  }
  return entry.label;
}

export function translateNodeDescription(
  nodeType: string,
  entry: NodeRegistryEntry
): string {
  const specialKey = SPECIAL_NODE_KEYS[nodeType];
  if (specialKey) {
    return translateOrFallback(`${specialKey}.description`, entry.description);
  }
  if (entry.toolPageId) {
    return translateOrFallback(
      `tools:${toCamelCase(entry.toolPageId)}.subtitle`,
      entry.description
    );
  }
  return entry.description;
}

function formatControlKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export function translateControlLabel(key: string): string {
  return translateOrFallback(
    `tools:pdfWorkflow.controls.${key}`,
    formatControlKey(key)
  );
}

// Option values such as '0.5' or 'PDF/A-2b' are not valid key segments.
export function translateControlOption(
  controlKey: string,
  value: string,
  label: string
): string {
  const slug = value.replace(/[^A-Za-z0-9_-]/g, '_');
  return translateOrFallback(
    `tools:pdfWorkflow.options.${controlKey}.${slug}`,
    label
  );
}
