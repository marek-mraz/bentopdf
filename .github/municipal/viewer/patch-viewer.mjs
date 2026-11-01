// node patch-viewer.mjs <package dir>: backports two embedpdf fixes (in
// embedpdf since 2.14) into the prebuilt bentopdf-viewer, which is built on
// embedpdf 2.9.1. Both the main-thread engine and the copy the worker runs
// (one single-quoted string inside worker-engine-*.js) get the same change:
//  1. Device and page coordinates include the crop box origin (embedpdf
//     getPageOrigin). Without it a mark drawn on a page whose CropBox or
//     MediaBox does not start at 0,0 lands that far off, and the text the
//     user marked stays in the file.
//  2. Annotation rects keep their fractions (embedpdf setPageAnnoRect and
//     setAnnotUnrotatedRect). The old code floored all four edges, so a mark
//     lost up to 1 pt on its right and bottom edge.
// Every replacement must match exactly once; a different viewer build stops
// here. Once upstream's viewer has getPageOrigin, delete this step.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const dist = `${process.argv[2]}/dist`;
const one = (prefix) => {
  const found = readdirSync(dist).filter((n) => n.startsWith(prefix) && n.endsWith('.js'));
  if (found.length !== 1) throw new Error(`${prefix}*.js: expected one file, found ${found.length}`);
  return `${dist}/${found[0]}`;
};

// Box type 1 is the crop box; PDFium falls back to the MediaBox without one.
const MAIN = [
  [
    'convertDevicePointToPagePoint(e,t,n){',
    'convertDevicePointToPagePoint(e,t,n){const p=this.municipalDeviceToPage(e,t,n),o=this.municipalPageOrigin(e,t);return{x:p.x+o.x,y:p.y+o.y}}' +
      'municipalPageOrigin(e,t){const n=this.cache.getContext(e.id);if(!n)return{x:0,y:0};const r=this.memoryManager.malloc(16),a=this.pdfiumModule.pdfium;' +
      'try{return a._EPDF_GetPageBoxByIndex(n.docPtr,t.index,1,r)?{x:a.getValue(r,"float"),y:a.getValue(r+12,"float")}:{x:0,y:0}}finally{this.memoryManager.free(r)}}' +
      'municipalDeviceToPage(e,t,n){',
  ],
  [
    'convertPagePointToDevicePoint(e,t,n){',
    'convertPagePointToDevicePoint(e,t,n){const o=this.municipalPageOrigin(e,t);return this.municipalPageToDevice(e,t,{x:n.x-o.x,y:n.y-o.y})}' +
      'municipalPageToDevice(e,t,n){',
  ],
  ...['setPageAnnoRect', 'setAnnotUnrotatedRect'].map((fn) => [
    `${fn}(e,t,n,r){const o=Math.floor(r.origin.x),a=Math.floor(r.origin.y),i=Math.floor(r.origin.x+r.size.width),u=Math.floor(r.origin.y+r.size.height),`,
    `${fn}(e,t,n,r){const o=r.origin.x,a=r.origin.y,i=r.origin.x+r.size.width,u=r.origin.y+r.size.height,`,
  ]),
];

// Inside the worker string a newline is the two characters \n.
const nl = (lines) => lines.join('\\n');
const WORKER = [
  [
    '  convertDevicePointToPagePoint(doc, page, position) {',
    nl([
      '  convertDevicePointToPagePoint(doc, page, position) {',
      '    const p = this.municipalDeviceToPage(doc, page, position);',
      '    const o = this.municipalPageOrigin(doc, page);',
      '    return { x: p.x + o.x, y: p.y + o.y };',
      '  }',
      '  municipalPageOrigin(doc, page) {',
      '    const ctx = this.cache.getContext(doc.id);',
      '    if (!ctx) return { x: 0, y: 0 };',
      '    const box = this.memoryManager.malloc(16);',
      '    const pdf = this.pdfiumModule.pdfium;',
      '    try {',
      '      if (!pdf._EPDF_GetPageBoxByIndex(ctx.docPtr, page.index, 1, box)) return { x: 0, y: 0 };',
      '      return { x: pdf.getValue(box, "float"), y: pdf.getValue(box + 12, "float") };',
      '    } finally {',
      '      this.memoryManager.free(box);',
      '    }',
      '  }',
      '  municipalDeviceToPage(doc, page, position) {',
    ]),
  ],
  [
    '  convertPagePointToDevicePoint(doc, page, position) {',
    nl([
      '  convertPagePointToDevicePoint(doc, page, position) {',
      '    const o = this.municipalPageOrigin(doc, page);',
      '    return this.municipalPageToDevice(doc, page, { x: position.x - o.x, y: position.y - o.y });',
      '  }',
      '  municipalPageToDevice(doc, page, position) {',
    ]),
  ],
  ...['setPageAnnoRect', 'setAnnotUnrotatedRect'].map((fn) => [
    nl([
      `  ${fn}(doc, page, annotPtr, rect) {`,
      '    const x0d = Math.floor(rect.origin.x);',
      '    const y0d = Math.floor(rect.origin.y);',
      '    const x1d = Math.floor(rect.origin.x + rect.size.width);',
      '    const y1d = Math.floor(rect.origin.y + rect.size.height);',
    ]),
    nl([
      `  ${fn}(doc, page, annotPtr, rect) {`,
      '    const x0d = rect.origin.x;',
      '    const y0d = rect.origin.y;',
      '    const x1d = rect.origin.x + rect.size.width;',
      '    const y1d = rect.origin.y + rect.size.height;',
    ]),
  ]),
];

for (const [path, edits] of [
  [one('direct-engine-'), MAIN],
  [one('worker-engine-'), WORKER],
]) {
  let src = readFileSync(path, 'utf8');
  if (src.includes('municipalPageOrigin')) throw new Error(`${path}: already patched`);
  if (src.includes('getPageOrigin')) {
    throw new Error(`${path}: the viewer already has upstream's page origin fix; delete this patch step`);
  }
  for (const [from, to] of edits) {
    const n = src.split(from).length - 1;
    if (n !== 1) throw new Error(`${path}: expected one "${from.slice(0, 60)}", found ${n}`);
    src = src.replace(from, () => to);
  }
  writeFileSync(path, src);
  console.log(`patch-viewer: ${path.split('/').pop()} (${edits.length} edits)`);
}
