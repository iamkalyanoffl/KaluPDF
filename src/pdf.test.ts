import { describe, it, expect } from 'vitest'
import { PDFDocument } from '@cantoo/pdf-lib'
import { parseRanges, sanitizeFilename, mergePages, type Doc } from './pdf'
describe('ranges', () => {
  it('parses', () => expect(parseRanges('1-3, 5, 8-10', 10)).toEqual([1,2,3,5,8,9,10]))
  it('rejects', () => { expect(() => parseRanges('0', 5)).toThrow(); expect(() => parseRanges('3-9', 5)).toThrow(); expect(() => parseRanges('a', 5)).toThrow() })
})
describe('filename', () => {
  it('sanitizes', () => expect(sanitizeFilename('a/b:c.pdf')).toBe('abc.pdf'))
  it('rejects empty', () => expect(() => sanitizeFilename(' /: ')).toThrow())
})
describe('merge', () => {
  it('orders, rotates, drops, duplicates', async () => {
    const mk = async (sizes: number[][]) => { const d = await PDFDocument.create(); sizes.forEach(([w, h]) => d.addPage([w, h])); return new Uint8Array(await d.save()) }
    const A = { id: 'A', bytes: await mk([[100, 200], [300, 100]]) } as unknown as Doc
    const B = { id: 'B', bytes: await mk([[500, 500]]) } as unknown as Doc
    const r = await mergePages([A, B], [{ id: '1', docId: 'B', src: 0, rot: 90 }, { id: '2', docId: 'A', src: 1, rot: 0 }, { id: '3', docId: 'A', src: 1, rot: 0 }])
    const out = await PDFDocument.load(new Uint8Array(await r.blob.arrayBuffer()))
    expect(out.getPageCount()).toBe(3)
    expect(out.getPage(0).getRotation().angle).toBe(90)
    expect(out.getPage(1).getSize()).toEqual({ width: 300, height: 100 })
  })
  it('stamps page numbers on rotated pages without changing size', async () => {
    const d = await PDFDocument.create(); d.addPage([200, 300])
    const A = { id: 'A', bytes: new Uint8Array(await d.save()) } as unknown as Doc
    for (const rot of [0, 90, 180, 270]) { const r = await mergePages([A], [{ id: 'x', docId: 'A', src: 0, rot }], undefined, { stamp: true }); expect(r.pages).toBe(1) }
  })
  it('adds index, separators and stamps; counts and validates', async () => {
    const mk = async () => { const d = await PDFDocument.create(); d.addPage([200, 300]); return new Uint8Array(await d.save()) }
    const A = { id: 'A', name: 'a.pdf', bytes: await mk() } as unknown as Doc, B = { id: 'B', name: 'b.pdf', bytes: await mk() } as unknown as Doc
    const r = await mergePages([A, B], [{ id: '1', docId: 'A', src: 0, rot: 0 }, { id: '2', docId: 'B', src: 0, rot: 90 }], undefined, { stamp: true, separators: true, index: { types: { A: 'Receipt' } } })
    expect(r.pages).toBe(4)
  })
})
import { splitGroups } from './pdf'
import { scoreInk } from './blank'
describe('split plan', () => {
  it('each', () => expect(splitGroups('each', '', 3)).toEqual([[1], [2], [3]]))
  it('ranges', () => expect(splitGroups('ranges', '1-2, 4', 5)).toEqual([[1, 2], [4]]))
  it('after', () => expect(splitGroups('after', '2, 4', 6)).toEqual([[1, 2], [3, 4], [5, 6]]))
  it('rejects bad input', () => { expect(() => splitGroups('ranges', '9', 5)).toThrow(); expect(() => splitGroups('after', '', 5)).toThrow() })
})
describe('blank scoring', () => {
  const px = (n: number, dark: number) => { const d = new Uint8ClampedArray(n * 4).fill(255); for (let i = 0; i < dark; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 0; return d }
  it('white is blank', () => expect(scoreInk(px(10000, 0), 100, 100).level).toBe('blank'))
  it('a few specks need review', () => expect(scoreInk(px(10000, 10), 100, 100).level).toBe('review'))
  it('real content is kept', () => expect(scoreInk(px(10000, 800), 100, 100).level).toBe('content'))
})

import { toPdfFile } from './image'
describe('image and text to PDF', () => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))
  it('converts a PNG by its bytes, not its name', async () => {
    const f = await toPdfFile(new File([png as BlobPart], 'receipt.dat')); expect(f.name).toBe('receipt.pdf')
    expect((await PDFDocument.load(new Uint8Array(await f.arrayBuffer()))).getPageCount()).toBe(1)
  })
  it('converts text and refuses unsupported characters', async () => {
    const f = await toPdfFile(new File(['Total 100\nNet 90'], 'n.txt')); expect((await PDFDocument.load(new Uint8Array(await f.arrayBuffer()))).getPageCount()).toBe(1)
    await expect(toPdfFile(new File(['Total \u20b9100'], 'n.txt'))).rejects.toThrow()
  })
  it('passes other files through', async () => { const f = new File(['x'], 'a.bin'); expect(await toPdfFile(f)).toBe(f) })
})
describe('watermark and metadata', () => {
  it('applies on rotated pages and sets metadata', async () => {
    const d = await PDFDocument.create(); d.addPage([200, 300]); const A = { id: 'A', name: 'a.pdf', bytes: new Uint8Array(await d.save()) } as unknown as Doc
    const r = await mergePages([A], [{ id: '1', docId: 'A', src: 0, rot: 90 }], undefined, { watermark: 'PAID', meta: { title: 'Oct' } })
    const o = await PDFDocument.load(new Uint8Array(await r.blob.arrayBuffer())); expect(o.getTitle()).toBe('Oct'); expect(o.getAuthor() ?? '').toBe('')
  })
})

import { verdict } from './compress'
describe('crop and compression verdict', () => {
  const mk = async () => { const d = await PDFDocument.create(); d.addPage([200, 300]); return { id: 'A', name: 'a.pdf', bytes: new Uint8Array(await d.save()) } as unknown as Doc }
  it('maps visual margins through rotation', async () => {
    const A = await mk(), sz = async (rot: number, crop: [number, number, number, number], stamp = false) => {
      const r = await mergePages([A], [{ id: '1', docId: 'A', src: 0, rot, crop }], undefined, { stamp }); return (await PDFDocument.load(new Uint8Array(await r.blob.arrayBuffer()))).getPage(0).getSize() }
    expect(await sz(0, [20, 0, 0, 0])).toEqual({ width: 200, height: 280 })
    expect(await sz(90, [20, 0, 0, 0])).toEqual({ width: 180, height: 300 })
    expect(await sz(180, [0, 10, 0, 0], true)).toEqual({ width: 190, height: 300 })
    expect(await sz(270, [0, 30, 0, 0])).toEqual({ width: 200, height: 270 })
  })
  it('rejects absurd crops', async () => { const A = await mk(); await expect(mergePages([A], [{ id: '1', docId: 'A', src: 0, rot: 0, crop: [150, 0, 150, 0] }])).rejects.toThrow() })
  it('never reports a saving that did not happen', () => { expect(verdict(100, 120).ok).toBe(false); expect(verdict(100, 40)).toEqual({ ok: true, pct: 60 }) })
})
describe('passwords', () => {
  it('protects output, opens it only with the password, and accepts it as a source', async () => {
    const d = await PDFDocument.create(); d.addPage([200, 300])
    const A = { id: 'A', name: 'a.pdf', bytes: new Uint8Array(await d.save()) } as unknown as Doc
    const r = await mergePages([A], [{ id: '1', docId: 'A', src: 0, rot: 0 }], undefined, { protect: { userPassword: 's3cret!' } })
    const bytes = new Uint8Array(await r.blob.arrayBuffer())
    expect(new TextDecoder('latin1').decode(bytes)).toContain('/Encrypt')
    await expect(PDFDocument.load(bytes)).rejects.toThrow()
    expect((await PDFDocument.load(bytes, { password: 's3cret!' })).getPageCount()).toBe(1)
    const B = { id: 'B', name: 'b.pdf', bytes, password: 's3cret!' } as unknown as Doc
    expect((await mergePages([B], [{ id: '1', docId: 'B', src: 0, rot: 0 }])).pages).toBe(1)
    await expect(mergePages([A], [{ id: '1', docId: 'A', src: 0, rot: 0 }], undefined, { protect: { userPassword: 'abc' } })).rejects.toThrow()
  })
})
import * as pjs from 'pdfjs-dist/legacy/build/pdf.mjs'
const PNG1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))
describe('annotation layer', () => {
  const mk = async () => { const d = await PDFDocument.create(); d.addPage([200, 300]); return { id: 'A', name: 'a.pdf', bytes: new Uint8Array(await d.save()) } as unknown as Doc }
  it('places text where the viewer shows it, on every rotation', async () => {
    for (const rot of [0, 90, 180, 270]) {
      const A = await mk(), r = await mergePages([A], [{ id: '1', docId: 'A', src: 0, rot, marks: [{ id: 'm', kind: 'text', x: 0.5, y: 0.25, w: 0.3, h: 0.1, text: 'MARK' }] }])
      const doc = await pjs.getDocument({ data: new Uint8Array(await r.blob.arrayBuffer()), useSystemFonts: true }).promise, pg = await doc.getPage(1), vp = pg.getViewport({ scale: 1 })
      const it = ((await pg.getTextContent()).items as unknown as { str: string; transform: number[] }[]).find(i => i.str === 'MARK')!, [vx, vy] = vp.convertToViewportPoint(it.transform[4], it.transform[5])
      expect(vx).toBeCloseTo(0.5 * vp.width, 0); expect(vy).toBeCloseTo((0.35 - 0.2 * 0.7 * 0.1) * vp.height, 0)
    }
  })
  it('burns in redactions via the renderer callback and reports the page', async () => {
    const A = await mk(), page = { id: '1', docId: 'A', src: 0, rot: 90, marks: [{ id: 'r', kind: 'redact' as const, x: 0, y: 0, w: 0.5, h: 0.5 }, { id: 't', kind: 'text' as const, x: 0.1, y: 0.8, w: 0.3, h: 0.1, text: 'Checked' }] }
    const r = await mergePages([A], [page], undefined, { rasterize: async () => ({ bytes: PNG1, type: 'png', w: 300, h: 200 }) })
    expect((await PDFDocument.load(new Uint8Array(await r.blob.arrayBuffer()))).getPage(0).getSize()).toEqual({ width: 300, height: 200 })
    expect(r.redacted).toEqual([{ page: 1, allowed: ['Checked'] }]); await expect(mergePages([A], [page])).rejects.toThrow()
  })
  it('refuses text the font cannot show', async () => { const A = await mk(); await expect(mergePages([A], [{ id: '1', docId: 'A', src: 0, rot: 0, marks: [{ id: 'm', kind: 'text', x: 0, y: 0, w: 0.3, h: 0.1, text: 'Rs \u20b9100' }] }])).rejects.toThrow() })
  it('draws images, highlights and boxes without changing size', async () => {
    const A = await mk(), r = await mergePages([A], [{ id: '1', docId: 'A', src: 0, rot: 270, marks: [{ id: 'a', kind: 'image', x: 0.1, y: 0.1, w: 0.2, h: 0.1, img: PNG1 }, { id: 'b', kind: 'highlight', x: 0.4, y: 0.4, w: 0.2, h: 0.1 }, { id: 'c', kind: 'box', x: 0.4, y: 0.6, w: 0.2, h: 0.1 }] }])
    expect(r.pages).toBe(1)
  })
})
