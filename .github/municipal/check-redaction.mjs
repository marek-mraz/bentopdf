#!/usr/bin/env node
// Redaction regression check for the PDF engine the image ships. Builds a PDF
// whose line is one TJ, with an invisible OCR copy on top (lowercase, kerned
// so every word starts where the visible one does; identical text would be
// merged by PDFium's text extraction and hide a difference), marks two separate areas of it the way the PDF editor does (one
// REDACT annotation each, then EPDFPage_ApplyRedactions) and checks the text
// left on the page. The engine bundled up to 3f6b6114b166 kept the second
// area's text and deleted unmarked words instead. Page 2 holds a gray JPEG and
// a 1-bit image with a dark block under a mark each: the block must be gone
// and the images must keep their encoding (that engine wrote both as 8-bit
// RGB, a scan grew 3x). The result is saved and reopened before checking.
// Usage: check-redaction.mjs <engine> [<glue engine> [<viewer>]], each a
// tarball or unpacked package dir. With <glue engine> (bentopdf-pdfium) its
// editcore.js loads the first engine's editcore.wasm, as in the browser: the
// viewer ships prebuilt JS for upstream's wasm, so a patched wasm must fit
// that JS. <viewer> (bentopdf-viewer) adds that prebuilt copy to the import
// comparison.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) {
  console.error('usage: check-redaction.mjs <engine .tgz or dir> [<glue engine>]');
  process.exit(2);
}
const tmps = [];
const unpack = (path) => {
  if (!statSync(path).isFile()) {
    return path;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'engine-'));
  tmps.push(tmp);
  execFileSync('tar', ['xzf', path, '-C', tmp]);
  return join(tmp, 'package');
};
const dir = unpack(process.argv[2]);
const glueDir = process.argv[3] ? unpack(process.argv[3]) : dir;
const fail = (why) => {
  console.error(`check-redaction: FAIL\n  ${why}`);
  for (const tmp of tmps) rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
};
// The wasm's imports are named by call count: a patch that changes the counts
// renames them and the prebuilt JS would call the wrong functions.
const importMap = (file) => {
  const map = readFileSync(file, 'utf8')
    .match(/wasmImports\s*=\s*\{[^}]*\}/)?.[0]
    ?.replace(/\s+/g, '');
  return map ?? fail(`no wasmImports in ${file}`);
};
const glues = [join(glueDir, 'editcore.js')];
if (process.argv[4]) {
  const dist = join(unpack(process.argv[4]), 'dist');
  const found = readdirSync(dist)
    .filter((name) => name.endsWith('.js'))
    .map((name) => join(dist, name))
    .filter((file) => readFileSync(file, 'utf8').includes('wasmImports'));
  if (found.length !== 1) fail(`expected one engine JS in ${dist}, found ${found.length}`);
  glues.push(found[0]);
}
if (glueDir !== dir) {
  const own = importMap(join(dir, 'editcore.js'));
  for (const glue of glues) {
    if (importMap(glue) !== own) fail(`the engine imports differ from ${glue}`);
  }
}

const visible =
  '[(Alpha)-250(Bravo)-250(Charlie)-250(Delta)-250(Echo)-250(Foxtrot)]TJ';
const ocr =
  '[(alpha)-361(bravo)-361(charlie)-472(delta)-416(echo)-361(foxtrot)]TJ';
const content = `BT /F1 12 Tf 72 700 Td ${visible} ET\nBT 3 Tr /F1 12 Tf 72 700 Td ${ocr} ET\n`;
// 64x64 px images at 1 pt per px, gray 200 with a dark block at px 16-32
// (top-down): Im1 a gray JPEG, Im2 1-bit (white, black block).
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCABAAEABAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APSKKKKKKKKKKKKKKKKKK+S6K+tKKKKKK+S6K+tKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK//9k=',
  'base64'
).toString('latin1');
const bits = Array.from({ length: 64 }, (_, y) =>
  y >= 16 && y < 32 ? '\xff\xff\x00\x00\xff\xff\xff\xff' : '\xff'.repeat(8)
).join('');
const images = 'q 64 0 0 64 300 300 cm /Im1 Do Q q 64 0 0 64 400 300 cm /Im2 Do Q\n';
const stream = (dict, data) => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 8 0 R /Im2 9 0 R >> >> /Contents 7 0 R >>',
  stream('', images),
  stream('/Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode', jpeg),
  stream('/Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceGray /BitsPerComponent 1', bits),
];
let pdf = '%PDF-1.7\n';
const offsets = objects.map((body, i) => {
  const at = pdf.length;
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  return at;
});
const xref = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

// Helvetica 12 pt on this line: Alpha 72-103, Bravo 106-137, Charlie 140-178,
// Delta 181-209, Echo 212-239, Foxtrot 242-280 (x), glyphs 697-709 (y).
const marks = [
  [
    [70, 690, 104, 715], // Alpha: the start of the text object
    [139, 690, 210, 715], // Charlie Delta: a second area on the same object
  ],
  [
    [312, 328, 336, 352], // Im1 px 12-36 around the block
    [412, 328, 436, 352], // Im2 likewise
  ],
];
const expected = ['BravoEchoFoxtrot', 'bravoechofoxtrot'];

try {
  const { default: createPdfium } = await import(
    pathToFileURL(join(glueDir, 'editcore.js')).href
  );
  const m = await createPdfium({
    wasmBinary: readFileSync(join(dir, 'editcore.wasm')),
  });
  m._PDFiumExt_Init();
  const bytes = Buffer.from(pdf, 'latin1');
  const buf = m._malloc(bytes.length);
  m.HEAPU8.set(bytes, buf);
  const doc = m._FPDF_LoadMemDocument64(buf, bytes.length, 0);
  if (!doc) throw new Error('the engine could not open the test PDF');
  const floats = (values) => {
    const p = m._malloc(4 * values.length);
    values.forEach((v, i) => m.setValue(p + 4 * i, v, 'float'));
    return p;
  };
  marks.forEach((pageMarks, index) => {
    const page = m._FPDF_LoadPage(doc, index);
    for (const [l, b, r, t] of pageMarks) {
      const annot = m._FPDFPage_CreateAnnot(page, 28); // FPDF_ANNOT_REDACT
      const rect = floats([l, t, r, b]);
      const quad = floats([l, t, r, t, l, b, r, b]);
      const ok =
        m._FPDFAnnot_SetRect(annot, rect) &&
        m._FPDFAnnot_AppendAttachmentPoints(annot, quad);
      m._free(rect);
      m._free(quad);
      m._FPDFPage_CloseAnnot(annot);
      if (!ok) throw new Error('could not create a redaction mark');
    }
    if (!m._EPDFPage_ApplyRedactions(page)) {
      throw new Error('EPDFPage_ApplyRedactions failed');
    }
    m._FPDFPage_GenerateContent(page);
    m._FPDF_ClosePage(page);
  });
  const writer = m._PDFiumExt_OpenFileWriter();
  if (!m._PDFiumExt_SaveAsCopy(doc, writer)) throw new Error('save failed');
  const size = m._PDFiumExt_GetFileWriterSize(writer);
  const saved = m._malloc(size);
  m._PDFiumExt_GetFileWriterData(writer, saved, size);
  m._PDFiumExt_CloseFileWriter(writer);
  const out = m._FPDF_LoadMemDocument64(saved, size, 0);
  if (!out) throw new Error('the engine could not reopen its output');
  const objectsOf = (page, type) =>
    Array.from({ length: m._FPDFPage_CountObjects(page) }, (_, i) =>
      m._FPDFPage_GetObject(page, i)
    ).filter((obj) => m._FPDFPageObj_GetType(obj) === type);

  const page1 = m._FPDF_LoadPage(out, 0);
  const textPage = m._FPDFText_LoadPage(page1);
  const layers = objectsOf(page1, 1).map((obj) => {
    // FPDF_PAGEOBJ_TEXT
    const n = m._FPDFTextObj_GetText(obj, textPage, 0, 0);
    const p = m._malloc(n);
    m._FPDFTextObj_GetText(obj, textPage, p, n);
    const text = String.fromCharCode(...new Uint16Array(m.HEAPU8.buffer, p, n / 2 - 1));
    m._free(p);
    return text;
  });
  // Each layer must read exactly its unmarked words.
  const words = layers.map((t) => t.replace(/\s+/g, '')).join(' ');
  const want = expected.join(' ');
  if (words !== want) fail(`expected: ${want}\n  found:    ${words}`);

  const page2 = m._FPDF_LoadPage(out, 1);
  const [im1, im2] = objectsOf(page2, 3); // FPDF_PAGEOBJ_IMAGE
  if (!im2) fail('the images are missing after redaction');
  const filter = (obj) => {
    if (m._FPDFImageObj_GetImageFilterCount(obj) !== 1) return '';
    const p = m._malloc(32);
    m._FPDFImageObj_GetImageFilter(obj, 0, p, 32);
    const name = m.UTF8ToString(p);
    m._free(p);
    return name;
  };
  // Im1: still a JPEG; the block (px 16-32) white, the gray around the box kept.
  const bitmap = m._FPDFImageObj_GetBitmap(im1);
  const bpp = [0, 1, 3, 4, 4][m._FPDFBitmap_GetFormat(bitmap)] ?? 0;
  const stride = m._FPDFBitmap_GetStride(bitmap);
  const base = m._FPDFBitmap_GetBuffer(bitmap);
  const at = (x, y) => m.HEAPU8[base + y * stride + x * bpp];
  let block = 255;
  for (let y = 16; y < 32; y++) for (let x = 16; x < 32; x++) block = Math.min(block, at(x, y));
  const around = at(4, 4);
  m._FPDFBitmap_Destroy(bitmap);
  if (filter(im1) !== 'DCTDecode') fail(`JPEG written back as "${filter(im1)}", not DCTDecode`);
  if (!bpp || block < 240) fail(`JPEG pixels under the mark kept (darkest ${block})`);
  if (Math.abs(around - 200) > 8) fail(`JPEG pixels outside the mark changed (${around})`);
  // Im2: still 1 bit per pixel, the block white.
  const meta = m._malloc(28);
  m._FPDFImageObj_GetImageMetadata(im2, page2, meta);
  const bits2 = m.getValue(meta + 16, 'i32');
  m._free(meta);
  const n = m._FPDFImageObj_GetImageDataDecoded(im2, 0, 0);
  const data = m._malloc(n);
  m._FPDFImageObj_GetImageDataDecoded(im2, data, n);
  const rows = n === 64 * 8 ? Array.from({ length: 16 }, (_, i) => m.HEAPU8[data + (16 + i) * 8 + 2] & m.HEAPU8[data + (16 + i) * 8 + 3]) : [];
  m._free(data);
  if (bits2 !== 1 || n !== 64 * 8) fail(`1-bit image written back with ${bits2} bits per pixel`);
  if (rows.some((v) => v !== 0xff)) fail('1-bit pixels under the mark kept');

  console.log(`check-redaction: OK (${words}; JPEG stays DCTDecode, 1-bit stays 1-bit, marked pixels wiped)`);
} finally {
  for (const tmp of tmps) rmSync(tmp, { recursive: true, force: true });
}
