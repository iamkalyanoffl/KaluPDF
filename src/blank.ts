import type { Doc } from './pdf'
export interface BlankScore { ratio: number; level: 'blank' | 'review' | 'content' }
/** Share of dark pixels (luminance < 170). <0.03% = looks empty, <0.4% = near-blank, needs human review. */
export function scoreInk(data: Uint8ClampedArray, w: number, h: number): BlankScore {
  let dark = 0
  for (let i = 0; i < data.length; i += 4) if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 170) dark++
  const ratio = dark / (w * h)
  return { ratio, level: ratio < 0.0003 ? 'blank' : ratio < 0.004 ? 'review' : 'content' }
}
/** Renders the page locally and measures ink, so scans with no text layer are judged by what is actually on them. */
export async function scorePage(doc: Doc, src: number): Promise<BlankScore> {
  const pg = await doc.js.getPage(src + 1), vp = pg.getViewport({ scale: 300 / pg.getViewport({ scale: 1 }).width })
  const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height)
  const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
  await pg.render({ canvasContext: ctx, viewport: vp }).promise
  const s = scoreInk(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height); c.width = 0; return s
}
