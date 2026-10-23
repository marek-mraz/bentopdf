import { describe, it, expect, vi } from 'vitest';
import enTools from '../../public/locales/en/tools.json';
import skTools from '../../public/locales/sk/tools.json';

vi.mock('heic2any', () => ({ default: vi.fn() }));

// Behaves like i18next after init: English strings, and a missing
// 'tools:a.b' comes back as 'a.b'.
vi.mock('../js/i18n/i18n', () => ({
  t: (key: string, options?: Record<string, unknown>) => {
    const path = key.slice(key.indexOf(':') + 1);
    let value = path
      .split('.')
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        enTools
      );
    if (typeof value !== 'string') return path;
    for (const [name, v] of Object.entries(options ?? {}))
      value = (value as string).replace(`{{${name}}}`, String(v));
    return value;
  },
}));

import { createNodeByType, nodeRegistry } from '@/js/workflow/nodes/registry';
import { getControlSpec } from '@/js/workflow/nodes/control-specs';
import {
  translateControlLabel,
  translateControlOption,
} from '@/js/workflow/i18n';
import { executeWorkflow } from '@/js/workflow/engine';

type Group = Record<string, unknown>;
const en = enTools.pdfWorkflow as Group;
const sk = skTools.pdfWorkflow as Group;

const flatten = (group: Group, prefix = ''): Record<string, string> =>
  Object.entries(group).reduce<Record<string, string>>((out, [k, v]) => {
    if (typeof v === 'string') out[prefix + k] = v;
    else Object.assign(out, flatten(v as Group, `${prefix}${k}.`));
    return out;
  }, {});

const placeholders = (s: string) =>
  (s.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();

const nodes = Object.keys(nodeRegistry).map((type) => createNodeByType(type)!);

describe('PDF Workflow Builder translations', () => {
  it('has an English label for every node control', () => {
    const labels = en.controls as Record<string, string>;
    const missing = nodes.flatMap((node) =>
      Object.keys(node.controls).filter((key) => !labels[key])
    );
    expect([...new Set(missing)]).toEqual([]);
  });

  it('keeps the English option labels of control-specs.ts', () => {
    const wrong: string[] = [];
    for (const node of nodes) {
      for (const key of Object.keys(node.controls)) {
        const spec = getControlSpec(node.nodeType, key);
        if (spec?.kind !== 'select') continue;
        for (const opt of spec.options) {
          const shown = translateControlOption(key, opt.value, opt.label);
          if (shown !== opt.label) wrong.push(`${key}.${opt.value}: ${shown}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('falls back to the formatted key for an unknown control', () => {
    expect(translateControlLabel('someNewControl')).toBe('Some New Control');
  });

  it('Slovak keys exist in English and keep their placeholders', () => {
    const enFlat = flatten(en);
    const problems: string[] = [];
    for (const [key, value] of Object.entries(flatten(sk))) {
      const base = key.replace(/_(one|few|many|other)$/, '_other');
      const source = enFlat[key] ?? enFlat[base];
      if (source === undefined) problems.push(`${key}: not in English`);
      else if (
        placeholders(value).join() !== placeholders(source).join() &&
        !key.startsWith('nodeCount_')
      )
        problems.push(`${key}: placeholders differ`);
    }
    expect(problems).toEqual([]);
  });

  it('rejects Encrypt before another step even when its label is translated', async () => {
    const encrypt = createNodeByType('EncryptNode')!;
    const compress = createNodeByType('CompressNode')!;
    const download = createNodeByType('DownloadNode')!;
    encrypt.label = 'Zašifrovať PDF';
    const all = [encrypt, compress, download];
    const connections = [
      { id: 'c1', source: encrypt.id, target: compress.id },
      { id: 'c2', source: compress.id, target: download.id },
    ];
    const editor = {
      getNodes: () => all,
      getConnections: () => connections,
      getNode: (id: string) => all.find((n) => n.id === id),
    };
    const area = { nodeViews: new Map() };
    await expect(
      executeWorkflow(
        editor as never,
        {} as never,
        area as never,
        () => undefined
      )
    ).rejects.toThrow(/Encrypt node feeds into/);
  });
});
