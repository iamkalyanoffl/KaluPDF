/** Scan cleanup on 8-bit grayscale pixels: remove speckles, straighten, then separate ink from paper. Pure functions, no browser needed. */
export const toGray = (rgba: Uint8ClampedArray): Uint8Array => { const g = new Uint8Array(rgba.length / 4); for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) | 0; return g }
export function median3(g: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(g.length), a = new Uint8Array(9)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = Math.min(h - 1, Math.max(0, y + dy)), xx = Math.min(w - 1, Math.max(0, x + dx)), v = g[yy * w + xx]; let k = n++; while (k > 0 && a[k - 1] > v) { a[k] = a[k - 1]; k-- } a[k] = v }
    o[y * w + x] = a[4]
  }
  return o
}
export function otsu(g: Uint8Array): number {
  const hist = new Array(256).fill(0); for (const v of g) hist[v]++
  const total = g.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i]
  let wB = 0, sB = 0, best = 0, thr = 128
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break; sB += t * hist[t]; const d = sB / wB - (sum - sB) / wF, v = wB * wF * d * d; if (v > best) { best = v; thr = t } }
  return thr
}
/** Angle in degrees by which the text lines tilt (positive = lines run downhill to the right), found where the row profile of the ink is sharpest. */
export function skewAngle(g: Uint8Array, w: number, h: number): number {
  const f = Math.max(1, Math.round(w / 700)), t = otsu(g), pts: number[] = []
  for (let y = 0; y < h; y += f) for (let x = 0; x < w; x += f) if (g[y * w + x] <= t) pts.push(x, y)
  if (pts.length < 200) return 0
  let best = -1, ang = 0
  for (let a = -6; a <= 6.001; a += 0.25) {
    const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180), bins = new Float64Array(h + w + 2)
    for (let i = 0; i < pts.length; i += 2) bins[Math.round(pts[i + 1] * c - pts[i] * s + w)]++
    let score = 0; for (const v of bins) score += v * v
    if (score > best) { best = score; ang = a }
  }
  return ang
}
/** Rotates so that lines tilted by `deg` become level. Same size, white fill, bilinear. */
export function rotateGray(g: Uint8Array, w: number, h: number, deg: number): Uint8Array {
  const o = new Uint8Array(g.length).fill(255), c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180), cx = w / 2, cy = h / 2
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy, sx = dx * c - dy * s + cx, sy = dx * s + dy * c + cy
    if (sx < 0 || sy < 0 || sx >= w - 1 || sy >= h - 1) continue
    const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0, i = y0 * w + x0
    o[y * w + x] = g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + w] * (1 - fx) * fy + g[i + w + 1] * fx * fy
  }
  return o
}
/** Straightening is off by default: it is only proven on synthetic tilts, not on real scans. */
export function cleanGray(g: Uint8Array, w: number, h: number, binarize = true, deskew = false): { gray: Uint8Array; angle: number } {
  const d = median3(g, w, h), angle = deskew ? skewAngle(d, w, h) : 0; let o = Math.abs(angle) >= 0.3 ? rotateGray(d, w, h, angle) : d
  if (binarize) { const t = otsu(o); o = o.map(v => (v > t ? 255 : 0)) }
  return { gray: o, angle }
}

const maxF = (a: Float32Array, w: number, h: number, r: number): Float32Array => {
  const t = new Float32Array(a.length), o = new Float32Array(a.length)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, a[y * w + k]); t[y * w + x] = m }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, t[k * w + x]); o[y * w + x] = m }
  return o
}
const blurF = (a: Float32Array, w: number, h: number, r: number): Float32Array => {
  const t = new Float32Array(a.length), o = new Float32Array(a.length)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { s += a[y * w + k]; n++ } t[y * w + x] = s / n }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { s += t[k * w + x]; n++ } o[y * w + x] = s / n }
  return o
}
/** Evens out shadows and uneven light: estimates the paper brightness around each pixel (looking past the writing) and divides it out. */
export function flatten(g: Uint8Array, w: number, h: number): Uint8Array {
  const f = Math.max(2, Math.round(Math.max(w, h) / 160)), sw = Math.ceil(w / f), sh = Math.ceil(h / f), small = new Float32Array(sw * sh)
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let m = 0; for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) m = Math.max(m, g[Math.min(h - 1, y * f + dy) * w + Math.min(w - 1, x * f + dx)]); small[y * sw + x] = m }
  const bg = blurF(maxF(small, sw, sh, 4), sw, sh, 3), o = new Uint8Array(g.length)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = Math.min(sw - 1.001, x / f), fy = Math.min(sh - 1.001, y / f), x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, i = y0 * sw + x0
    const b = bg[i] * (1 - ax) * (1 - ay) + bg[i + 1] * ax * (1 - ay) + bg[i + sw] * (1 - ax) * ay + bg[i + sw + 1] * ax * ay
    o[y * w + x] = Math.min(255, (g[y * w + x] * 255) / Math.max(b, 40))
  }
  return o
}
export type Look = 'document' | 'bw'
/** Camera photo of a page to a scan look: even lighting, then either levels (grayscale) or pure black and white. */
export function enhanceGray(g: Uint8Array, w: number, h: number, look: Look): Uint8Array {
  const f = flatten(g, w, h)
  if (look === 'bw') { const t = otsu(f); return f.map(v => (v > t ? 255 : 0)) }
  return f.map(v => Math.max(0, Math.min(255, ((v - 40) * 255) / 185)))
}
