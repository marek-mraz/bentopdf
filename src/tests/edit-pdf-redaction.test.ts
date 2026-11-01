import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  PendingRedactionChange,
  PendingRedactionItem,
  RedactionGlyph,
  RedactionPluginEvent,
  RedactionPluginLite,
  RedactionTextEngine,
} from '../js/types/edit-pdf-redaction-type.js';

const { redactDocumentData } = vi.hoisted(() => ({
  redactDocumentData: vi.fn(
    async (pdf: Uint8Array, terms: readonly string[] = []) =>
      Uint8Array.from([...pdf, terms.length])
  ),
}));

vi.mock('../js/utils/redact-document-data.js', () => ({
  redactDocumentData,
}));

vi.mock('../js/utils/disabled-tools.js', () => ({
  getEditorDisabledCategories: (): string[] => [],
}));

const {
  trackAppliedRedactions,
  redactionScrubTerms,
  scrubRedactedText,
  readTextUnderMarks,
} = await import('../js/logic/edit-pdf-page.js');

function mockRedactionPlugin() {
  const pendingListeners = new Set<(event: PendingRedactionChange) => void>();
  const eventListeners = new Set<(event: RedactionPluginEvent) => void>();
  const plugin: RedactionPluginLite = {
    getState: () => ({ pendingCount: 0 }),
    commitAllPending: () => ({ toPromise: async () => true }),
    onPendingChange: (listener) => {
      pendingListeners.add(listener);
      return () => pendingListeners.delete(listener);
    },
    onRedactionEvent: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };
  const pending = new Map<string, PendingRedactionItem[]>();
  const publish = (documentId: string) => {
    const items = pending.get(documentId) ?? [];
    for (const listener of pendingListeners) {
      listener({ documentId, pending: items.length ? { 0: items } : {} });
    }
  };
  const emit = (event: RedactionPluginEvent) => {
    for (const listener of eventListeners) listener(event);
  };
  return {
    plugin,
    mark(documentId: string, item: PendingRedactionItem) {
      pending.set(documentId, [...(pending.get(documentId) ?? []), item]);
      publish(documentId);
      emit({ type: 'add', documentId });
    },
    unmark(documentId: string, id: string) {
      pending.set(
        documentId,
        (pending.get(documentId) ?? []).filter((item) => item.id !== id)
      );
      publish(documentId);
      emit({ type: 'remove', documentId, id });
    },
    clearAll(documentId: string) {
      pending.set(documentId, []);
      publish(documentId);
      emit({ type: 'clear', documentId });
    },
    apply(documentId: string, ids?: string[]) {
      pending.set(
        documentId,
        ids
          ? (pending.get(documentId) ?? []).filter(
              (item) => !ids.includes(item.id)
            )
          : []
      );
      publish(documentId);
      emit({ type: 'commit', documentId });
    },
  };
}

describe('trackAppliedRedactions', () => {
  it('reports nothing when no redaction was applied', () => {
    const viewer = mockRedactionPlugin();
    const tracker = trackAppliedRedactions(viewer.plugin);
    viewer.mark('doc', { id: 'a', kind: 'text', text: 'Jane Doe' });
    expect(tracker.appliedTexts('doc')).toEqual([]);
  });

  it('keeps the text of applied text marks and skips removed marks', () => {
    const viewer = mockRedactionPlugin();
    const tracker = trackAppliedRedactions(viewer.plugin);
    viewer.mark('doc', { id: 'a', kind: 'text', text: 'Jane Doe' });
    viewer.mark('doc', { id: 'b', kind: 'text', text: 'Removed Mark' });
    viewer.unmark('doc', 'b');
    viewer.mark('doc', { id: 'c', kind: 'area' });
    viewer.apply('doc');
    expect(tracker.appliedTexts('doc')).toEqual(['Jane Doe', undefined]);
  });

  it('does not count marks removed with Clear all as applied', () => {
    const viewer = mockRedactionPlugin();
    const tracker = trackAppliedRedactions(viewer.plugin);
    viewer.mark('doc', { id: 'a', kind: 'text', text: 'Applied Text' });
    viewer.apply('doc');
    viewer.mark('doc', { id: 'b', kind: 'text', text: 'Acme Corp' });
    viewer.clearAll('doc');
    expect(tracker.appliedTexts('doc')).toEqual(['Applied Text']);
  });

  it('counts a single applied mark while others stay pending', () => {
    const viewer = mockRedactionPlugin();
    const tracker = trackAppliedRedactions(viewer.plugin);
    viewer.mark('doc', { id: 'a', kind: 'text', text: 'First' });
    viewer.mark('doc', { id: 'b', kind: 'text', text: 'Second' });
    viewer.apply('doc', ['a']);
    expect(tracker.appliedTexts('doc')).toEqual(['First']);
    viewer.apply('doc', ['b']);
    expect(tracker.appliedTexts('doc')).toEqual(['First', 'Second']);
  });

  it('keeps applied marks separate per document and forgets closed ones', () => {
    const viewer = mockRedactionPlugin();
    const tracker = trackAppliedRedactions(viewer.plugin);
    viewer.mark('one', { id: 'a', kind: 'text', text: 'Alpha' });
    viewer.mark('two', { id: 'b', kind: 'area' });
    viewer.apply('one');
    expect(tracker.appliedTexts('one')).toEqual(['Alpha']);
    expect(tracker.appliedTexts('two')).toEqual([]);
    tracker.forget('one');
    expect(tracker.appliedTexts('one')).toEqual([]);
  });

  it('treats a mark that comes back after a reload as pending again', () => {
    const viewer = mockRedactionPlugin();
    const tracker = trackAppliedRedactions(viewer.plugin);
    const item: PendingRedactionItem = { id: 'a', kind: 'text', text: 'X' };
    viewer.mark('doc', item);
    viewer.apply('doc');
    viewer.mark('doc', item);
    expect(tracker.appliedTexts('doc')).toEqual([]);
  });
});

describe('readTextUnderMarks', () => {
  // One line per row of the page, 10 pt per character, 20 pt per row; spaces
  // are empty glyphs, as the engine reports them.
  function fakeEngine(lines: string[]) {
    const text = lines.join('\r\n');
    const glyphs: (RedactionGlyph | undefined)[] = [];
    let row = 0;
    let col = 0;
    for (const c of text) {
      if (c === '\n') {
        row++;
        col = 0;
        glyphs.push(undefined);
        continue;
      }
      glyphs.push(
        c === ' ' || c === '\r'
          ? undefined
          : {
              origin: { x: col * 10, y: row * 20 },
              size: { width: 10, height: 12 },
            }
      );
      col++;
    }
    const engine: RedactionTextEngine = {
      getPageGlyphs: () => ({ toPromise: async () => glyphs }),
      getTextSlices: (_doc, slices) => ({
        toPromise: async () =>
          slices.map((s) => text.slice(s.charIndex, s.charIndex + s.charCount)),
      }),
    };
    return engine;
  }
  const doc = { pages: [{ index: 0 }] };
  const rect = (x: number, y: number, width: number, height: number) => ({
    origin: { x, y },
    size: { width, height },
  });

  it('reads the words an area mark covers, spaces included', async () => {
    const engine = fakeEngine(['Name Jane Doe born 1970']);
    const found = await readTextUnderMarks(engine, doc, [
      { id: 'a', kind: 'area', page: 0, rect: rect(50, 0, 80, 12) },
    ]);
    expect(found.get('a')).toBe('Jane Doe');
  });

  it('skips a neighbour that only touches the mark edge', async () => {
    const engine = fakeEngine(['Name Jane Doe born']);
    const found = await readTextUnderMarks(engine, doc, [
      { id: 'a', kind: 'area', page: 0, rect: rect(38, 0, 94, 12) },
    ]);
    expect(found.get('a')).toBe('Jane Doe');
  });

  it('returns one line per covered row and skips marks that have text', async () => {
    const engine = fakeEngine(['Jane Doe', 'Main St 5', 'keep']);
    const found = await readTextUnderMarks(engine, doc, [
      { id: 'a', kind: 'area', page: 0, rect: rect(0, 0, 90, 32) },
      {
        id: 'b',
        kind: 'text',
        text: 'Jane',
        page: 0,
        rect: rect(0, 0, 40, 12),
      },
      { id: 'c', kind: 'area', page: 0, rect: rect(0, 60, 90, 12) },
      { id: 'd', kind: 'area', page: 3, rect: rect(0, 0, 90, 12) },
    ]);
    expect(found.get('a')).toBe('Jane Doe\r\nMain St 5');
    expect(redactionScrubTerms(found.values())).toEqual([
      'Main St 5',
      'Jane Doe',
    ]);
    expect([...found.keys()]).toEqual(['a']);
  });

  it('uses the segment rects of a text mark loaded without its text', async () => {
    const engine = fakeEngine(['Name Jane Doe born']);
    const found = await readTextUnderMarks(engine, doc, [
      {
        id: 'a',
        kind: 'text',
        page: 0,
        rect: rect(0, 0, 180, 12),
        rects: [rect(50, 0, 80, 12)],
      },
    ]);
    expect(found.get('a')).toBe('Jane Doe');
  });

  it('hands the text to the tracker, which reports it once applied', () => {
    const viewer = mockRedactionPlugin();
    const tracker = trackAppliedRedactions(viewer.plugin);
    viewer.mark('doc', { id: 'a', kind: 'area' });
    tracker.setPendingText('doc', 'a', 'Jane Doe');
    tracker.setPendingText('doc', 'unknown', 'ignored');
    viewer.apply('doc');
    expect(tracker.appliedTexts('doc')).toEqual(['Jane Doe']);
  });
});

describe('redactionScrubTerms', () => {
  it('splits lines, trims, dedupes case-insensitively and sorts longest first', () => {
    expect(
      redactionScrubTerms([
        'John',
        undefined,
        ' John Smith \r\nAcme Corp',
        'john',
        '\n',
      ])
    ).toEqual(['John Smith', 'Acme Corp', 'John']);
  });

  it('returns no terms for area-only redactions', () => {
    expect(redactionScrubTerms([undefined, undefined])).toEqual([]);
  });
});

describe('scrubRedactedText', () => {
  beforeEach(() => {
    redactDocumentData.mockClear();
  });

  it('runs one termless pass when no text is known', async () => {
    const out = await scrubRedactedText(Uint8Array.from([1]), []);
    expect(redactDocumentData).toHaveBeenCalledTimes(1);
    expect(redactDocumentData.mock.calls[0][1]).toEqual([]);
    expect([...out]).toEqual([1, 0]);
  });

  it('removes every term in a single pass', async () => {
    const out = await scrubRedactedText(Uint8Array.from([1]), ['abc', 'de']);
    expect(redactDocumentData).toHaveBeenCalledTimes(1);
    expect(redactDocumentData.mock.calls[0][1]).toEqual(['abc', 'de']);
    expect([...out]).toEqual([1, 2]);
  });
});
