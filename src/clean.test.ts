import { describe, it, expect } from 'vitest'
import { median3, otsu, skewAngle, rotateGray, cleanGray } from './clean'
const lines = (w: number, h: number) => { const g = new Uint8Array(w * h).fill(235); for (let r = 0; r < 6; r++) for (let y = 40 + r * 60; y < 52 + r * 60; y++) for (let x = 40; x < w - 40; x++) if ((x / 14 | 0) % 5) g[y * w + x] = 30; return g }
describe('scan cleanup', () => {
  it('removes isolated speckles but keeps strokes', () => {
    const g = new Uint8Array(100 * 100).fill(240); g[50 * 100 + 50] = 0; for (let x = 10; x < 90; x++) for (let y = 20; y < 24; y++) g[y * 100 + x] = 20
    const m = median3(g, 100, 100); expect(m[50 * 100 + 50]).toBe(240); expect(m[21 * 100 + 50]).toBe(20)
  })
  it('splits dark ink from light paper', () => { const g = new Uint8Array(1000); g.fill(230, 0, 900); g.fill(30, 900); const t = otsu(g); expect(t).toBeGreaterThanOrEqual(30); expect(t).toBeLessThan(230) })
  it('finds a known tilt and straightens it', () => {
    const w = 900, h = 480, level = lines(w, h)
    for (const a of [-3, 1.5, 4]) { const tilted = rotateGray(level, w, h, -a), est = skewAngle(tilted, w, h); expect(Math.abs(est - a)).toBeLessThanOrEqual(0.5); expect(Math.abs(skewAngle(cleanGray(tilted, w, h, true, true).gray, w, h))).toBeLessThanOrEqual(0.5) }
  })
  it('leaves an already level page alone', () => expect(Math.abs(skewAngle(lines(900, 480), 900, 480))).toBeLessThanOrEqual(0.25))
})
import { suspiciousAmounts } from './amounts'
describe('suspicious amounts', () => {
  it('flags long unseparated numbers and odd commas', () => {
    expect(suspiciousAmounts('GST 18% 101160 and Total 663160')).toEqual(['101160 is a long number with no comma or decimal point', '663160 is a long number with no comma or decimal point'])
    expect(suspiciousAmounts('Paid 1,01160 today')[0]).toContain('odd comma')
  })
  it('leaves normal amounts, dates and years alone', () => expect(suspiciousAmounts('Total 6,631.60 on 14-10-2026, rate 450.00, qty 12, 2026/0417, ₹1,25,000.00')).toEqual([]))
})
import { flatten, enhanceGray } from './clean'
describe('camera scan enhancement', () => {
  const W = 400, H = 300, make = () => { const g = new Uint8Array(W * H), ink = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const paper = 110 + (130 * x) / W, bar = y % 40 > 10 && y % 40 < 18 && x > 30 && x < W - 30; ink[y * W + x] = bar ? 1 : 0; g[y * W + x] = bar ? paper * 0.25 : paper } return { g, ink } }
  const mean = (a: Uint8Array, ink: Uint8Array, want: number, x0 = 0, x1 = W) => { let s = 0, n = 0; for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) if (ink[y * W + x] === want) { s += a[y * W + x]; n++ } return s / n }
  it('removes a lighting gradient so paper is white at both ends while writing stays dark', () => {
    const { g, ink } = make(), f = flatten(g, W, H)
    expect(mean(g, ink, 0, 0, 60)).toBeLessThan(140); expect(mean(f, ink, 0, 0, 60)).toBeGreaterThan(235); expect(mean(f, ink, 0, W - 60, W)).toBeGreaterThan(235)
    expect(mean(f, ink, 1, 60, W - 60)).toBeLessThan(110)
  })
  it('black and white output holds only ink and paper and keeps the writing area right', () => {
    const { g, ink } = make(), b = enhanceGray(g, W, H, 'bw'); let inkPx = 0, wrong = 0; for (let i = 0; i < b.length; i++) { if (b[i] !== 0 && b[i] !== 255) wrong++; if (ink[i]) inkPx += b[i] === 0 ? 1 : 0 }
    expect(wrong).toBe(0); expect(inkPx / ink.reduce((a, c) => a + c, 0)).toBeGreaterThan(0.95); let darkPaper = 0; for (let i = 0; i < b.length; i++) if (!ink[i] && b[i] === 0) darkPaper++; expect(darkPaper / b.length).toBeLessThan(0.01)
  })
})
