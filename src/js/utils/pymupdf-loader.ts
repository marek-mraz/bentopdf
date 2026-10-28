import { WasmProvider } from './wasm-provider.js';
import type {
  PyMuPDFInstance,
  PyMuPDFCompressOptions,
  PyMuPDFExtractTextOptions,
  PyMuPDFRasterizeOptions,
} from '@/types';

import { t } from '../i18n/i18n.js';

let cachedPyMuPDF: PyMuPDFInstance | null = null;
let loadPromise: Promise<PyMuPDFInstance> | null = null;

export interface PyMuPDFInterface {
  load(): Promise<void>;
  compressPdf(
    file: Blob,
    options: PyMuPDFCompressOptions
  ): Promise<{ blob: Blob; compressedSize: number }>;
  convertToPdf(file: Blob, ext: string): Promise<Blob>;
  extractText(file: Blob, options?: PyMuPDFExtractTextOptions): Promise<string>;
  extractImages(file: Blob): Promise<Array<{ data: Uint8Array; ext: string }>>;
  extractTables(file: Blob): Promise<unknown[]>;
  toSvg(file: Blob, pageNum: number): Promise<string>;
  renderPageToImage(file: Blob, pageNum: number, scale: number): Promise<Blob>;
  getPageCount(file: Blob): Promise<number>;
  rasterizePdf(
    file: Blob | File,
    options: PyMuPDFRasterizeOptions
  ): Promise<Blob>;
}

export async function loadPyMuPDF(): Promise<PyMuPDFInstance> {
  if (cachedPyMuPDF) {
    return cachedPyMuPDF;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    if (!WasmProvider.isConfigured('pymupdf')) {
      throw new Error(
        t('msg.pymupdfLoader.pymupdfIsNotConfiguredPleaseConfigure')
      );
    }
    if (!WasmProvider.isConfigured('ghostscript')) {
      throw new Error(
        t('msg.pymupdfLoader.ghostscriptIsNotConfiguredPymupdfRequire')
      );
    }

    const pymupdfUrl = WasmProvider.getUrl('pymupdf')!;
    const normalizedPymupdf = pymupdfUrl.endsWith('/')
      ? pymupdfUrl
      : `${pymupdfUrl}/`;

    try {
      const wrapperUrl = `${normalizedPymupdf}dist/index.js`;
      const module = await import(/* @vite-ignore */ wrapperUrl);

      if (typeof module.PyMuPDF !== 'function') {
        throw new Error(
          'PyMuPDF module did not export expected PyMuPDF class.'
        );
      }

      cachedPyMuPDF = new module.PyMuPDF({
        assetPath: `${normalizedPymupdf}assets/`,
      });

      await cachedPyMuPDF.load();

      console.log('[PyMuPDF Loader] Successfully loaded from CDN');
      return cachedPyMuPDF;
    } catch (error: unknown) {
      loadPromise = null;
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        t('msg.pymupdfLoader.failedToLoadPymupdfFromCdn', { msg }),
        {
          cause: error,
        }
      );
    }
  })();

  return loadPromise;
}

export function isPyMuPDFAvailable(): boolean {
  return (
    WasmProvider.isConfigured('pymupdf') &&
    WasmProvider.isConfigured('ghostscript')
  );
}

export function clearPyMuPDFCache(): void {
  cachedPyMuPDF = null;
  loadPromise = null;
}
