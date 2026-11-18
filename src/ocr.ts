import { createWorker } from 'tesseract.js'
import type { Doc, Page } from './pdf'
import type { PageScan } from './searchable'
import { cleanGray, toGray } from './clean'
export const OCR_LANGS: Record<string, string> = { eng: 'English', hin: 'Hindi', tam: 'Tamil' }
export interface OcrPage { n: number; text: string; confidence: number }
const DPI = 200
async function start(langs: string[]) { return createWorker(langs.join('+'), 1, { workerPath: '/tesseract/worker.min.js', corePath: '/tesseract/core', langPath: '/tesseract/lang', workerBlobURL: false, cacheMethod: 'none' }) }
async function render(docs: Doc[], p: Page, tidy: boolean) {
  const pg = await docs.find(d => d.id === p.docId)!.js.getPage(p.src + 1), vp = pg.getViewport({ scale: DPI / 72, rotation: (pg.rotate + p.rot) % 360 })
  const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height)
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); await pg.render({ canvasContext: ctx, viewport: vp }).promise
  if (tidy) { const im = ctx.getImageData(0, 0, c.width, c.height), { gray } = cleanGray(toGray(im.data), c.width, c.height); for (let i = 0, j = 0; i < gray.length; i++, j += 4) { im.data[j] = im.data[j + 1] = im.data[j + 2] = gray[i]; im.data[j + 3] = 255 } ctx.putImageData(im, 0, 0) }
  return c
}
/** Runs the OCR engine bundled with this site (no network). Pages are rendered at 200 dpi and read one at a time. */
export async function ocrPages(docs: Doc[], pages: Page[], langs: string[], onProgress?: (n: number) => void, tidy = false): Promise<OcrPage[]> {
  const worker = await start(langs), out: OcrPage[] = []
  try { for (let i = 0; i < pages.length; i++) { const c = await render(docs, pages[i], tidy), { data } = await worker.recognize(c); out.push({ n: i + 1, text: data.text.trim(), confidence: Math.round(data.confidence) }); c.width = 0; onProgress?.(i + 1) } }
  finally { await worker.terminate() }
  return out
}
/** Same reading, but also keeps each page's image and the position of every word, for building a searchable PDF. */
export async function scanPages(docs: Doc[], pages: Page[], langs: string[], onProgress?: (n: number) => void, tidy = false): Promise<{ scans: PageScan[]; confidence: number }> {
  const worker = await start(langs), scans: PageScan[] = []; let conf = 0
  try {
    for (let i = 0; i < pages.length; i++) {
      const c = await render(docs, pages[i], tidy), { data } = await worker.recognize(c), blob = await new Promise<Blob>((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('Image encoding failed.')), 'image/jpeg', 0.85))
      scans.push({ img: new Uint8Array(await blob.arrayBuffer()), type: 'jpg', w: c.width * 72 / DPI, h: c.height * 72 / DPI, pxW: c.width, pxH: c.height,
        words: (data.words ?? []).filter(w => w.text.trim()).map(w => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 })) })
      conf += data.confidence; c.width = 0; onProgress?.(i + 1)
    }
  } finally { await worker.terminate() }
  return { scans, confidence: Math.round(conf / Math.max(1, pages.length)) }
}
