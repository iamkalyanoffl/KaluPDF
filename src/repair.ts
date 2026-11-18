import { PDFDocument } from '@cantoo/pdf-lib'
import * as pdfjs from 'pdfjs-dist'
import { buildFromJpegs } from './compress'
export interface Repaired { bytes: Uint8Array; method: 'rewrite' | 'images'; pages: number }
/** Tries to read the file leniently (skipping junk before the header and bad objects) and write it out cleanly. Keeps text and vectors. */
export async function repairByRewrite(input: Uint8Array): Promise<Repaired | null> {
  const at = new TextDecoder('latin1').decode(input.subarray(0, 4096)).indexOf('%PDF-'), bytes = at > 0 ? input.slice(at) : input
  try { const d = await PDFDocument.load(bytes, { throwOnInvalidObject: false, updateMetadata: false }); if (!d.getPageCount()) return null; return { bytes: await d.save(), method: 'rewrite', pages: d.getPageCount() } } catch { return null }
}
/** Last resort: PDF.js is more forgiving. Pages it can draw are rebuilt as pictures. Text and forms are lost. */
export async function repairByImages(input: Uint8Array): Promise<Repaired | null> {
  try {
    const doc = await pdfjs.getDocument({ data: input.slice() }).promise, items: { bytes: Uint8Array; w: number; h: number }[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      try {
        const pg = await doc.getPage(i), base = pg.getViewport({ scale: 1 }), c = document.createElement('canvas'), sc = 150 / 72; c.width = Math.ceil(base.width * sc); c.height = Math.ceil(base.height * sc)
        const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); await pg.render({ canvasContext: x, viewport: pg.getViewport({ scale: sc }) }).promise
        const b = await new Promise<Blob>((ok, no) => c.toBlob(v => v ? ok(v) : no(new Error('x')), 'image/jpeg', 0.85)); items.push({ bytes: new Uint8Array(await b.arrayBuffer()), w: base.width, h: base.height }); c.width = 0
      } catch { /* a page that cannot be drawn is skipped; the count is reported */ }
    }
    await doc.destroy(); if (!items.length) return null
    return { bytes: new Uint8Array(await (await buildFromJpegs(items)).arrayBuffer()), method: 'images', pages: items.length }
  } catch { return null }
}
