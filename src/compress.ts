import { PDFDocument } from '@cantoo/pdf-lib'
import type { Doc, Page } from './pdf'
export type Level = 'low' | 'balanced' | 'high'
export const LEVELS: Record<Level, { dpi: number; q: number; label: string }> = {
  low: { dpi: 170, q: 0.8, label: 'Light: sharpest, smallest saving' }, balanced: { dpi: 130, q: 0.65, label: 'Balanced' }, high: { dpi: 100, q: 0.5, label: 'Strong: smallest, softer text' } }
/** Never reports a saving that did not happen. */
export const verdict = (orig: number, out: number) => out < orig ? { ok: true, pct: Math.round((1 - out / orig) * 100) } : { ok: false, pct: Math.round((out / orig - 1) * 100) }
/** Explicit fallback: every page is re-rendered as a JPEG. Text, forms and signatures are NOT kept. Best for scans. */
export async function compressByRaster(docs: Doc[], pages: Page[], level: Level, gray: boolean, onProgress?: (n: number) => void): Promise<Blob> {
  const out = await PDFDocument.create(), L = LEVELS[level], byId = new Map(docs.map(d => [d.id, d])), dims: { w: number; h: number }[] = []
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i], pg = await byId.get(p.docId)!.js.getPage(p.src + 1), rot = (pg.rotate + p.rot) % 360, base = pg.getViewport({ scale: 1, rotation: rot })
    const [ct, cr, cb, cl] = p.crop ?? [0, 0, 0, 0], w = base.width - cl - cr, h = base.height - ct - cb, sc = L.dpi / 72
    const vp = pg.getViewport({ scale: sc, rotation: rot, offsetX: -cl * sc, offsetY: -ct * sc })
    const c = document.createElement('canvas'); c.width = Math.ceil(w * sc); c.height = Math.ceil(h * sc)
    const ctx = c.getContext('2d', { willReadFrequently: gray })!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    await pg.render({ canvasContext: ctx, viewport: vp }).promise
    if (gray) { const im = ctx.getImageData(0, 0, c.width, c.height), d = im.data; for (let k = 0; k < d.length; k += 4) d[k] = d[k + 1] = d[k + 2] = (0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]) | 0; ctx.putImageData(im, 0, 0) }
    const blob = await new Promise<Blob>((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('Image encoding failed.')), 'image/jpeg', L.q)); c.width = 0
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer())); out.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h }); dims.push({ w, h }); onProgress?.(i + 1)
  }
  const bytes = await out.save(), chk = await PDFDocument.load(bytes)
  if (chk.getPageCount() !== pages.length) throw new Error('Validation failed: the page count changed.')
  chk.getPages().forEach((pg, i) => { const s = pg.getSize(); if (Math.abs(s.width - dims[i].w) > 0.5 || Math.abs(s.height - dims[i].h) > 0.5) throw new Error(`Validation failed at page ${i + 1}.`) })
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}

export const LIMITS = [200e3, 500e3, 1e6, 2e6, 5e6, 10e6]
/** Settings from sharpest to softest. The first one whose result fits the limit wins. */
export const LADDER: { dpi: number; q: number }[] = [{ dpi: 150, q: 0.85 }, { dpi: 150, q: 0.7 }, { dpi: 130, q: 0.7 }, { dpi: 130, q: 0.55 }, { dpi: 110, q: 0.55 }, { dpi: 110, q: 0.45 }, { dpi: 90, q: 0.45 }, { dpi: 90, q: 0.35 }, { dpi: 72, q: 0.35 }, { dpi: 72, q: 0.25 }]
/** Chooses the sharpest setting whose size fits, or null. `sizes` maps "dpi/quality" to bytes. */
export function pickFit(sizes: Record<string, number>, limit: number): { dpi: number; q: number } | null { return LADDER.find(l => sizes[`${l.dpi}/${l.q}`] !== undefined && sizes[`${l.dpi}/${l.q}`] <= limit) ?? null }
export async function buildFromJpegs(items: { bytes: Uint8Array; w: number; h: number }[]): Promise<Blob> {
  const out = await PDFDocument.create()
  for (const it of items) { const img = await out.embedJpg(it.bytes); out.addPage([it.w, it.h]).drawImage(img, { x: 0, y: 0, width: it.w, height: it.h }) }
  const bytes = await out.save(), chk = await PDFDocument.load(bytes)
  if (chk.getPageCount() !== items.length) throw new Error('Validation failed: the page count changed.')
  chk.getPages().forEach((pg, i) => { const s = pg.getSize(); if (Math.abs(s.width - items[i].w) > 0.5 || Math.abs(s.height - items[i].h) > 0.5) throw new Error(`Validation failed at page ${i + 1}.`) })
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}
const OVERHEAD = 1200
/** Finds the sharpest setting that gets the file under `limit`. Each page is rendered once per resolution and encoded at every quality for it. Returns blob null when even the softest setting is too big. */
export async function compressToTarget(docs: Doc[], pages: Page[], limit: number, gray: boolean, onProgress?: (n: number) => void): Promise<{ blob: Blob | null; smallest: number; used?: { dpi: number; q: number } }> {
  const byId = new Map(docs.map(d => [d.id, d])); let smallest = Infinity, done = 0
  for (const dpi of [...new Set(LADDER.map(l => l.dpi))]) {
    const qs = LADDER.filter(l => l.dpi === dpi).map(l => l.q), enc = new Map<number, { bytes: Uint8Array; w: number; h: number }[]>(qs.map(q => [q, []]))
    for (const p of pages) {
      const pg = await byId.get(p.docId)!.js.getPage(p.src + 1), rot = (pg.rotate + p.rot) % 360, base = pg.getViewport({ scale: 1, rotation: rot }), [ct, cr, cb, cl] = p.crop ?? [0, 0, 0, 0], w = base.width - cl - cr, h = base.height - ct - cb, sc = dpi / 72
      const c = document.createElement('canvas'); c.width = Math.ceil(w * sc); c.height = Math.ceil(h * sc); const ctx = c.getContext('2d', { willReadFrequently: gray })!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
      await pg.render({ canvasContext: ctx, viewport: pg.getViewport({ scale: sc, rotation: rot, offsetX: -cl * sc, offsetY: -ct * sc }) }).promise
      if (gray) { const im = ctx.getImageData(0, 0, c.width, c.height), d = im.data; for (let k = 0; k < d.length; k += 4) d[k] = d[k + 1] = d[k + 2] = (0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]) | 0; ctx.putImageData(im, 0, 0) }
      for (const q of qs) { const b = await new Promise<Blob>((ok, no) => c.toBlob(x => x ? ok(x) : no(new Error('Image encoding failed.')), 'image/jpeg', q)); enc.get(q)!.push({ bytes: new Uint8Array(await b.arrayBuffer()), w, h }) }
      c.width = 0; onProgress?.(++done)
    }
    const sizes: Record<string, number> = {}; for (const q of qs) { const sz = enc.get(q)!.reduce((s, x) => s + x.bytes.length + OVERHEAD, 0); sizes[`${dpi}/${q}`] = sz; smallest = Math.min(smallest, sz) }
    const fit = pickFit(sizes, limit); if (fit) { const blob = await buildFromJpegs(enc.get(fit.q)!); if (blob.size <= limit) return { blob, smallest: blob.size, used: fit } }
  }
  return { blob: null, smallest }
}
