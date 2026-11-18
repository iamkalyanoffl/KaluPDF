import 'regenerator-runtime/runtime'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, StandardFonts, type PDFFont } from '@cantoo/pdf-lib'
export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number }
/** One scanned page: the image to show, its size in PDF points, the pixel size OCR saw, and the words OCR found (pixel boxes, top-left origin). */
export interface PageScan { img: Uint8Array; type: 'jpg' | 'png'; w: number; h: number; pxW: number; pxH: number; words: OcrWord[] }
export type FontName = 'lat' | 'latx' | 'deva' | 'tam'
const LATIN1 = /^[\x20-\x7e\xa0-\xff]*$/, nfc = (s: string) => s.normalize('NFC'), compact = (s: string) => nfc(s).replace(/\s+/g, '')
/**
 * Builds a PDF whose pages are the scanned images with an invisible text layer on top, so the text can be searched and copied.
 * Words are written without script shaping, so text extraction returns the characters in their original order (Hindi and Tamil included).
 */
export async function buildSearchable(scans: PageScan[], loadFont: (n: FontName) => Promise<Uint8Array>): Promise<{ bytes: Uint8Array; words: number; lossy: number }> {
  const out = await PDFDocument.create(); out.registerFontkit(fontkit)
  const helv = await out.embedFont(StandardFonts.Helvetica), fonts = new Map<FontName, { f: PDFFont; set: Set<number> }>()
  const get = async (n: FontName) => { let e = fonts.get(n); if (!e) { const f = await out.embedFont(await loadFont(n), { subset: false })
    // The text layer is invisible, so skip the font library's script shaping. Shaping reorders glyphs and inserts dotted circles, which would corrupt extracted Hindi and Tamil. One glyph per character keeps the original order.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fk = (f as any).embedder.font; fk.layout = (t: string) => ({ glyphs: [...t].map(c => fk.glyphForCodePoint(c.codePointAt(0))) })
    e = { f, set: new Set(f.getCharacterSet()) }; fonts.set(n, e) } return e }
  let words = 0, lossy = 0
  const pick = async (c: string): Promise<{ f: PDFFont; c: string }> => {
    if (LATIN1.test(c)) return { f: helv, c }
    const cp = c.codePointAt(0)!, order: FontName[] = cp >= 0x900 && cp <= 0x97f ? ['deva', 'lat', 'latx'] : cp >= 0xb80 && cp <= 0xbff ? ['tam', 'lat', 'latx'] : ['lat', 'latx', 'deva', 'tam']
    for (const n of order) { const e = await get(n); if (e.set.has(cp)) return { f: e.f, c } }
    lossy++; return { f: helv, c: '?' }
  }
  for (const s of scans) {
    const img = s.type === 'jpg' ? await out.embedJpg(s.img) : await out.embedPng(s.img), pg = out.addPage([s.w, s.h]), k = s.w / s.pxW
    pg.drawImage(img, { x: 0, y: 0, width: s.w, height: s.h })
    for (const wd of s.words) {
      const t = nfc(wd.text).replace(/\s+/g, ' ').trim(); if (!t) continue; words++
      const size = Math.max(4, (wd.y1 - wd.y0) * k * 0.85), x = wd.x0 * k, y = s.h - wd.y1 * k + size * 0.2
      const runs: { f: PDFFont; t: string }[] = []
      for (const c of [...t]) { const p = await pick(c), last = runs[runs.length - 1]; if (last && last.f === p.f) last.t += p.c; else runs.push({ f: p.f, t: p.c }) }
      let cx = x; for (const r of runs) { pg.drawText(r.t, { x: cx, y, size, font: r.f, opacity: 0 }); cx += r.f.widthOfTextAtSize(r.t, size) }
    }
  }
  return { bytes: await out.save(), words, lossy }
}
/** Compares the text a viewer can extract from the result with what OCR found, page by page (ignoring spaces). */
export function checkSearchable(extracted: string[], scans: PageScan[]): { total: number; missing: number; sample: string[] } {
  let total = 0, missing = 0; const sample: string[] = []
  scans.forEach((s, i) => { const got = compact(extracted[i] ?? ''); for (const w of s.words) { const t = compact(w.text); if (!t) continue; total++; if (!got.includes(t)) { missing++; if (sample.length < 3) sample.push(t) } } })
  return { total, missing, sample }
}
