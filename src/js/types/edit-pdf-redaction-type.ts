export interface RedactionMarkRect {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}

export interface PendingRedactionItem {
  id: string;
  kind: 'text' | 'area';
  text?: string;
  page?: number;
  rect?: RedactionMarkRect;
  rects?: RedactionMarkRect[];
}

export interface PendingRedactionChange {
  documentId: string;
  pending: Record<number, PendingRedactionItem[]>;
}

export interface RedactionPluginEvent {
  type: string;
  documentId: string;
  id?: string;
}

export interface RedactionPluginLite {
  getState: () => {
    pendingCount: number;
    pending?: Record<number, PendingRedactionItem[]>;
  };
  commitAllPending: () => { toPromise: () => Promise<boolean> };
  onPendingChange: (
    listener: (event: PendingRedactionChange) => void
  ) => () => void;
  onRedactionEvent: (
    listener: (event: RedactionPluginEvent) => void
  ) => () => void;
}

export interface ActiveDocumentSource {
  getActiveDocumentId: () => string | null;
}

export interface AppliedRedactionTracker {
  appliedTexts: (documentId: string) => (string | undefined)[];
  setPendingText: (documentId: string, id: string, text: string) => void;
  forget: (documentId: string) => void;
}

interface EngineTask<T> {
  toPromise: () => Promise<T>;
}

export interface RedactionTextPage {
  index: number;
}

export interface RedactionTextDocument {
  pages: RedactionTextPage[];
}

export interface RedactionGlyph {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}

export interface RedactionTextSlice {
  pageIndex: number;
  charIndex: number;
  charCount: number;
}

export interface RedactionTextEngine {
  getPageGlyphs: (
    doc: RedactionTextDocument,
    page: RedactionTextPage
  ) => EngineTask<(RedactionGlyph | undefined)[]>;
  getTextSlices: (
    doc: RedactionTextDocument,
    slices: RedactionTextSlice[]
  ) => EngineTask<string[]>;
}

export interface RedactionTextSource {
  getEngine: () => RedactionTextEngine;
  getStore: () => {
    getState: () => {
      core: {
        documents: Record<
          string,
          { document?: RedactionTextDocument | null } | undefined
        >;
      };
    };
  };
}
