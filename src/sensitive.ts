export type Kind = 'email' | 'phone' | 'aadhaar' | 'pan' | 'card' | 'custom'
export const KIND_LABEL: Record<Kind, string> = { email: 'Email addresses', phone: 'Indian mobile numbers', aadhaar: '12-digit numbers (Aadhaar-style)', pan: 'PAN numbers', card: 'Card numbers', custom: 'Your own words' }
export interface Hit { kind: Kind; text: string; start: number; end: number }
export function luhn(digits: string): boolean { let s = 0, alt = false; for (let i = digits.length - 1; i >= 0; i--) { let n = +digits[i]; if (alt) { n *= 2; if (n > 9) n -= 9 } s += n; alt = !alt } return digits.length >= 13 && s % 10 === 0 }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Finds sensitive-looking text in one line. 12-digit numbers are not checksum-verified, so ordinary 12-digit references can match too. */
export function findSensitive(line: string, kinds: Kind[], custom: string[]): Hit[] {
  const hits: Hit[] = [], add = (kind: Kind, re: RegExp, ok: (t: string) => boolean = () => true) => { for (const m of line.matchAll(re)) if (ok(m[0])) { const start = m.index!, end = start + m[0].length; if (!hits.some(h => start < h.end && end > h.start)) hits.push({ kind, text: m[0], start, end }) } }
  if (kinds.includes('email')) add('email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)
  if (kinds.includes('pan')) add('pan', /(?<![A-Za-z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Za-z0-9])/g)
  if (kinds.includes('card')) add('card', /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, t => luhn(t.replace(/\D/g, '')) && t.replace(/\D/g, '').length <= 19)
  if (kinds.includes('aadhaar')) add('aadhaar', /(?<!\d[ -]?)\d{4}[ -]?\d{4}[ -]?\d{4}(?![ -]?\d)/g)
  if (kinds.includes('phone')) add('phone', /(?<![\d+])(?<!\d[ -]?)(?:\+91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?![ -]?\d)/g)
  if (kinds.includes('custom')) for (const w of custom.map(x => x.trim()).filter(Boolean)) add('custom', new RegExp(esc(w), 'gi'))
  return hits.sort((a, b) => a.start - b.start)
}
export interface Box { u: number; v: number; w: number; h: number }
/** Rough width of each character, so a position inside a text piece is estimated better than evenly. Boxes are padded to stay on the safe side. */
type Cw = (c: string) => number
const crude: Cw = c => /[ijl.,:;'!|tfrI]/.test(c) ? 0.5 : /[mwMW@]/.test(c) ? 1.5 : /[A-Z0-9]/.test(c) ? 1.1 : 1
const cum = (s: string, n: number, cw: Cw) => { let t = 0; for (let i = 0; i < n && i < s.length; i++) t += cw(s[i]); return t }
interface Item { str: string; x: number; y: number; w: number; h: number }
/** Boxes every hit, as fractions of the visual page. `toFrac` converts raw page coordinates. Character positions inside a text piece are estimated evenly. */
export function locate(items: Item[], kinds: Kind[], custom: string[], toFrac: (x: number, y: number) => [number, number], cw: Cw = crude): { kind: Kind; text: string; box: Box }[] {
  const lines: Item[][] = []
  for (const it of items.filter(i => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) { const l = lines[lines.length - 1]; if (l && Math.abs(l[0].y - it.y) <= Math.max(2, it.h * 0.4)) l.push(it); else lines.push([it]) }
  const out: { kind: Kind; text: string; box: Box }[] = []
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x); let text = ''; const spans: { it: Item; s: number; e: number }[] = []; let prevEnd = -1e9
    for (const it of line) { if (text && it.x - prevEnd > it.h * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' '; spans.push({ it, s: text.length, e: text.length + it.str.length }); text += it.str; prevEnd = it.x + it.w }
    for (const h of findSensitive(text, kinds, custom)) {
      const ov = spans.filter(s => s.s < h.end && s.e > h.start); if (!ov.length) continue
      const at = (s: typeof ov[0], idx: number) => s.it.x + (s.it.w * cum(s.it.str, idx - s.s, cw)) / Math.max(1e-6, cum(s.it.str, s.it.str.length, cw)), x0 = at(ov[0], Math.max(h.start, ov[0].s)), x1 = at(ov[ov.length - 1], Math.min(h.end, ov[ov.length - 1].e))
      const padX = 0.35 * Math.max(...ov.map(s => s.it.h)), yb = Math.min(...ov.map(s => s.it.y - 0.22 * s.it.h)), yt = Math.max(...ov.map(s => s.it.y + 0.92 * s.it.h)), a = toFrac(x0 - padX, yb), b = toFrac(x1 + padX, yt), pad = 0.003
      out.push({ kind: h.kind, text: h.text, box: { u: Math.max(0, Math.min(a[0], b[0]) - pad), v: Math.max(0, Math.min(a[1], b[1]) - pad), w: Math.abs(b[0] - a[0]) + 2 * pad, h: Math.abs(b[1] - a[1]) + 2 * pad } })
    }
  }
  return out
}
export interface PageLike { rotate: number; getViewport(o: { scale: number; rotation: number }): { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] }; getTextContent(): Promise<{ items: unknown[] }> }
let hv: { widthOfTextAtSize(t: string, s: number): number } | null = null
async function helvetica() { if (!hv) { const { PDFDocument, StandardFonts } = await import('@cantoo/pdf-lib'); hv = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica) } return hv }
export async function locatePage(pg: PageLike, extraRot: number, crop: [number, number, number, number] | undefined, kinds: Kind[], custom: string[]) {
  const vp = pg.getViewport({ scale: 1, rotation: (pg.rotate + extraRot) % 360 }), [ct, cr, cb, cl] = crop ?? [0, 0, 0, 0], w = vp.width - cl - cr, h = vp.height - ct - cb
  const items = ((await pg.getTextContent()).items as { str?: unknown; transform: number[]; width: number; height: number }[]).filter(i => typeof i.str === 'string').map(i => ({ str: i.str as string, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]) }))
  const hf = await helvetica(), cw: Cw = c => { try { return hf.widthOfTextAtSize(c, 1) } catch { return 0.6 } }
  return { hits: locate(items, kinds, custom, (x, y) => { const [vx, vy] = vp.convertToViewportPoint(x, y); return [(vx - cl) / w, (vy - ct) / h] }, cw), textItems: items.length }
}
