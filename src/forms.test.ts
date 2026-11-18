import { describe, it, expect } from 'vitest'
import { PDFDocument } from '@cantoo/pdf-lib'
import * as pjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { mergePages, type Doc } from './pdf'
import { verifySignatures } from './verify'
import { makeSignedPdf } from '../e2e/signedFixture'
describe('form filling', () => {
  const make = async () => { const d = await PDFDocument.create(), pg = d.addPage([300, 400]), f = d.getForm(); f.createTextField('amount').addToPage(pg, { x: 40, y: 300, width: 200, height: 24 }); f.createCheckBox('paid').addToPage(pg, { x: 40, y: 250, width: 16, height: 16 })
    return { id: 'A', name: 'form.pdf', bytes: new Uint8Array(await d.save()), fields: [{ name: 'amount', kind: 'text' }, { name: 'paid', kind: 'checkbox' }] } as unknown as Doc }
  const page = [{ id: '1', docId: 'A', src: 0, rot: 0 }]
  it('fills fields, flattens, and the value is visible text in the output', async () => {
    const A = await make(), r = await mergePages([A], page, undefined, { fills: { A: { amount: '1250.00', paid: true } } }), out = new Uint8Array(await r.blob.arrayBuffer())
    expect((await PDFDocument.load(out.slice())).getForm().getFields().length).toBe(0)
    const doc = await pjs.getDocument({ data: out.slice(), useSystemFonts: true }).promise, items = (await (await doc.getPage(1)).getTextContent()).items as unknown as { str: string }[]
    expect(items.map(i => i.str).join(' ')).toContain('1250.00'); expect(r.warnings.join(' ')).toContain('flattened')
  })
  it('refuses unknown fields and unsupported characters without producing output', async () => {
    const A = await make()
    await expect(mergePages([A], page, undefined, { fills: { A: { nosuch: 'x' } } })).rejects.toThrow(/Could not fill/)
    await expect(mergePages([A], page, undefined, { fills: { A: { amount: 'Rs \u20b9100' } } })).rejects.toThrow(/Could not fill/)
  })
})
describe('signature verification', () => {
  it('reports an untouched signed file as intact and names the signer', async () => {
    const r = await verifySignatures(new Uint8Array(await makeSignedPdf())); expect(r).toHaveLength(1); expect(r[0].status).toBe('intact'); expect(r[0].detail).toContain('Test Signer'); expect(r[0].detail).toContain('whole file')
  }, 30000)
  it('reports a changed file as invalid', async () => { expect((await verifySignatures(new Uint8Array(await makeSignedPdf({ tamper: true }))))[0].status).toBe('invalid') }, 30000)
  it('flags content added after signing', async () => { const r = await verifySignatures(new Uint8Array(await makeSignedPdf({ append: true }))); expect(r[0].status).toBe('intact'); expect(r[0].detail).toContain('added after') }, 30000)
  it('says so when a signature cannot be read', async () => { expect((await verifySignatures(new TextEncoder().encode('%PDF /ByteRange [0 5 9 3] /Contents <zz> xxxxxxxxxxxx')))[0].status).toBe('unreadable') })
})
import { readFileSync } from 'node:fs'
import { buildSearchable, checkSearchable, type PageScan, type FontName } from './searchable'
describe('searchable pdf', () => {
  const F: Record<FontName, string> = { lat: 'noto-lat.ttf', latx: 'noto-latx.ttf', deva: 'noto-deva.ttf', tam: 'noto-tam.ttf' }
  const load = async (n: FontName) => new Uint8Array(readFileSync(`src/assets/fonts/${F[n]}`)), PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))
  const words = ['Invoice', '1250.00', '\u20b9500', '\u0939\u093f\u0928\u094d\u0926\u0940', '\u092d\u093e\u0937\u093e', '\u0ba4\u0bae\u0bbf\u0bb4\u0bcd', '\u0b87\u0ba8\u0bcd\u0ba4\u0bbf\u0baf\u0bbe'], scan: PageScan = { img: PNG, type: 'png', w: 300, h: 200, pxW: 600, pxH: 400, words: words.map((text, i) => ({ text, x0: 20, y0: 20 + i * 45, x1: 220, y1: 55 + i * 45 })) }
  it('hides text that reads back in the original order for English, rupee, Hindi and Tamil', async () => {
    const { bytes, words: n, lossy } = await buildSearchable([scan], load); expect(n).toBe(words.length); expect(lossy).toBe(0)
    const doc = await pjs.getDocument({ data: bytes.slice(), useSystemFonts: true }).promise, text = ((await (await doc.getPage(1)).getTextContent()).items as unknown as { str: string }[]).map(i => i.str).join(' ')
    const chk = checkSearchable([text], [scan]); expect(chk.sample).toEqual([]); expect(chk.missing).toBe(0); expect(chk.total).toBe(words.length)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  }, 30000)
  it('detects text that does not read back', () => expect(checkSearchable(['Invoice'], [scan]).missing).toBe(words.length - 1))
})
import { toPdfFile, xlsxSheets, parseCsv } from './image'
import { makeDocx } from './extract'
import { resolvePattern } from './pdf'
import { makeChainedSignedPdf } from '../e2e/signedFixture'
describe('file name patterns', () => { it('fills month name, year and number', () => { expect(resolvePattern('{Month}_{Year}_Accounts', '2026-03')).toBe('March_2026_Accounts'); expect(resolvePattern('{Year}-{MM}', '2026-10')).toBe('2026-10') }) })
describe('word and unicode text to pdf', () => {
  const fl = async (n: FontName) => new Uint8Array(readFileSync(`src/assets/fonts/noto-${n}.ttf`))
  it('turns a docx with rupee, Hindi and Tamil into pages, and refuses what no font can show', async () => {
    const f = new File([makeDocx([['Invoice \u20b9500 & tax', '\u0939\u093f\u0928\u094d\u0926\u0940 \u0ba4\u0bae\u0bbf\u0bb4\u0bcd'], ['Second page']]) as BlobPart], 'a.docx'), out = await toPdfFile(f, fl)
    expect(out.name).toBe('a.pdf'); const b = new Uint8Array(await out.arrayBuffer()); expect((await PDFDocument.load(b)).getPageCount()).toBe(1)
    const doc = await pjs.getDocument({ data: b.slice(), useSystemFonts: true }).promise, t = ((await (await doc.getPage(1)).getTextContent()).items as unknown as { str: string }[]).map(i => i.str).join(' ')
    expect(t).toContain('Invoice'); expect(t).toContain('500')
    await expect(toPdfFile(new File(['smile \u{1F600}'], 'e.txt'), fl)).rejects.toThrow(/cannot be shown/); await expect(toPdfFile(new File(['x'], 'bad.docx'), fl)).rejects.toThrow(/could not be read/)
  }, 30000)
})
describe('annotation extras', () => {
  const mk = async () => { const d = await PDFDocument.create(); d.addPage([200, 300]); return { id: 'A', name: 'a.pdf', bytes: new Uint8Array(await d.save()) } as unknown as Doc }
  const field = (rot: number, marks: object[]) => ({ id: '1', docId: 'A', src: 0, rot, marks } as never)
  it('creates real fillable fields in the right place on rotated pages', async () => {
    for (const [rot, want] of [[0, { x: 20, y: 210, width: 100, height: 30 }], [90, { x: 40, y: 30, width: 20, height: 150 }]] as const) {
      const r = await mergePages([await mk()], [field(rot, [{ id: 'm', kind: 'ftext', x: 0.1, y: 0.2, w: 0.5, h: 0.1, text: 'amount' }, { id: 'n', kind: 'fcheck', x: 0.7, y: 0.2, w: 0.1, h: 0.1, text: 'paid' }])])
      const f = (await PDFDocument.load(new Uint8Array(await r.blob.arrayBuffer()))).getForm(); expect(f.getFields().map(x => x.getName()).sort()).toEqual(['amount', 'paid'])
      const rect = f.getTextField('amount').acroField.getWidgets()[0].getRectangle(); for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(rect[k] - want[k])).toBeLessThanOrEqual(1)
    }
  })
  it('refuses duplicate or bad field names', async () => {
    const two = [{ id: 'a', kind: 'ftext', x: 0, y: 0, w: 0.2, h: 0.1, text: 'x' }, { id: 'b', kind: 'ftext', x: 0.5, y: 0.5, w: 0.2, h: 0.1, text: 'x' }]
    await expect(mergePages([await mk()], [field(0, two)])).rejects.toThrow(/unique/); await expect(mergePages([await mk()], [field(0, [{ ...two[0], text: '<bad>' }])])).rejects.toThrow(/not allowed/)
  })
  it('draws a cover and warns that the text stays underneath', async () => { const r = await mergePages([await mk()], [field(0, [{ id: 'c', kind: 'cover', x: 0.1, y: 0.1, w: 0.3, h: 0.1 }])]); expect(r.warnings.join(' ')).toContain('only hidden') })
})
describe('signature trust roots', () => {
  it('trusts a chain to a supplied root, and not to a stranger', async () => {
    const { pdf, rootDer, strangerDer } = await makeChainedSignedPdf(), b = new Uint8Array(pdf)
    expect((await verifySignatures(b, [new Uint8Array(rootDer)]))[0].detail).toContain('chains to a root you supplied')
    expect((await verifySignatures(b, [new Uint8Array(strangerDer)]))[0].detail).toContain('NOT established')
    const none = (await verifySignatures(b))[0]; expect(none.status).toBe('intact'); expect(none.detail).toContain('not checked')
  }, 60000)
})
import { zipSync } from 'fflate'
describe('excel, csv and powerpoint to pdf', () => {
  const fl2 = async (n: FontName) => new Uint8Array(readFileSync(`src/assets/fonts/noto-${n}.ttf`)), enc = (s: string) => new TextEncoder().encode(s), H = '<?xml version="1.0" encoding="UTF-8"?>'
  const xlsx = () => zipSync({
    'xl/workbook.xml': enc(`${H}<workbook xmlns:r="x"><sheets><sheet name="Ledger" sheetId="1" r:id="rId1"/></sheets></workbook>`), 'xl/_rels/workbook.xml.rels': enc(`${H}<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/sharedStrings.xml': enc(`${H}<sst><si><t>Item</t></si><si><t>Amount \u20b9</t></si><si><t>Rent &amp; rates</t></si></sst>`),
    'xl/styles.xml': enc(`${H}<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mm\\-yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`),
    'xl/worksheets/sheet1.xml': enc(`${H}<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12500.5</v></c><c r="C2" s="1"><v>46309</v></c></row></sheetData></worksheet>`) })
  it('reads shared strings, numbers and date styles from an xlsx', () => {
    const s = xlsxSheets(xlsx()); expect(s[0].name).toBe('Ledger'); expect(s[0].rows[1]).toEqual(['Rent & rates', '12500.5', '14-10-2026'])
  })
  it('parses quoted csv and detects the separator', () => { expect(parseCsv('a;b\n"x;y";"he said ""hi"""\n')).toEqual([['a', 'b'], ['x;y', 'he said "hi"']]) })
  it('makes table and slide pages that read back, and refuses what cannot be shown', async () => {
    const t = await toPdfFile(new File([xlsx() as BlobPart], 'l.xlsx'), fl2), tb = new Uint8Array(await t.arrayBuffer()); expect((await PDFDocument.load(tb)).getPageCount()).toBe(1)
    const doc = await pjs.getDocument({ data: tb.slice(), useSystemFonts: true }).promise, txt = ((await (await doc.getPage(1)).getTextContent()).items as unknown as { str: string }[]).map(i => i.str).join(' ')
    expect(txt).toContain('Rent & rates'); expect(txt).toContain('12500.5'); expect(txt).toContain('14-10-2026')
    const sl = (n: number) => enc(`${H}<p:sld><a:p><a:r><a:t>Title ${n}</a:t></a:r></a:p><a:p><a:r><a:t>Point &amp; more</a:t></a:r></a:p></p:sld>`), p = await toPdfFile(new File([zipSync({ 'ppt/slides/slide2.xml': sl(2), 'ppt/slides/slide10.xml': sl(10), 'ppt/slides/slide1.xml': sl(1) }) as BlobPart], 'd.pptx'))
    expect((await PDFDocument.load(new Uint8Array(await p.arrayBuffer()))).getPageCount()).toBe(3)
    await expect(toPdfFile(new File([xlsx() as BlobPart], 'l.xlsx'))).rejects.toThrow(/cannot show/); await expect(toPdfFile(new File(['x'], 'bad.xlsx'), fl2)).rejects.toThrow(/could not be read/)
    const wide = Array.from({ length: 40 }, (_, i) => `Heading number ${i}`).join(','), c = await toPdfFile(new File([`${wide}\n${wide}`], 'w.csv')).catch(e => e); expect(String(c)).toMatch(/too wide/)
  }, 30000)
})
import { PDFName } from '@cantoo/pdf-lib'
describe('replace text in simple pdfs', () => {
  const text = async (b: Uint8Array) => { const d = await pjs.getDocument({ data: b.slice(), useSystemFonts: true }).promise; return ((await (await d.getPage(1)).getTextContent()).items as unknown as { str: string }[]).map(i => i.str).join(' ') }
  const make = async (literal: boolean) => { const d = await PDFDocument.create(), pg = d.addPage([300, 200]), f = await d.embedFont((await import('@cantoo/pdf-lib')).StandardFonts.Helvetica)
    if (literal) { pg.drawText(' ', { font: f }); pg.node.set(PDFName.of('Contents'), d.context.register(d.context.stream(`BT /${f.name} 12 Tf 20 150 Td (Paid \\(cash\\) 200.00) Tj ET`))) } else pg.drawText('Total 100.00 due', { x: 20, y: 150, size: 12, font: f })
    return { id: 'A', name: 'a.pdf', bytes: new Uint8Array(await d.save()) } as unknown as Doc }
  const pg1 = [{ id: '1', docId: 'A', src: 0, rot: 0 }]
  it('replaces text stored as hex and as literal strings, and reports it', async () => {
    for (const lit of [false, true]) {
      const find = lit ? '200.00' : '100.00', r = await mergePages([await make(lit)], pg1, undefined, { replace: [{ find, with: '150.00' }] }), t = await text(new Uint8Array(await r.blob.arrayBuffer()))
      expect(t).toContain('150.00'); expect(t).not.toContain(find); expect(r.warnings.join(' ')).toContain('Replaced')
    }
    expect(await text(new Uint8Array(await (await mergePages([await make(true)], pg1, undefined, { replace: [{ find: '(cash)', with: '[bank]' }] })).blob.arrayBuffer()))).toContain('Paid [bank] 200.00')
  })
  it('refuses text it cannot find or cannot write, instead of pretending', async () => {
    await expect(mergePages([await make(false)], pg1, undefined, { replace: [{ find: 'nowhere', with: 'x' }] })).rejects.toThrow(/not found/)
    await expect(mergePages([await make(false)], pg1, undefined, { replace: [{ find: '100.00', with: '\u20b9100' }] })).rejects.toThrow(/Latin letters/)
  })
})
import { pageLabel, DEFAULT_NB } from './pdf'
describe('page numbering and Bates numbers', () => {
  const mk = async (n: number) => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([200, 300]); return { id: 'A', name: 'a.pdf', bytes: new Uint8Array(await d.save()) } as unknown as Doc }
  const nbOf = (p: Partial<typeof DEFAULT_NB>) => ({ ...DEFAULT_NB, ...p })
  it('builds labels for each style, start number and skipped cover pages', () => {
    expect(pageLabel(nbOf({ style: 'Page n of N', skip: 1 }), 0, 5)).toBe(''); expect(pageLabel(nbOf({ style: 'Page n of N', skip: 1 }), 1, 5)).toBe('Page 1 of 4')
    expect(pageLabel(nbOf({ style: 'n', start: 10 }), 2, 5)).toBe('12'); expect(pageLabel(nbOf({ style: 'n of N', start: 10 }), 0, 3)).toBe('10 of 12')
    expect(pageLabel(nbOf({ style: 'bates', prefix: 'INV-', digits: 4, start: 7 }), 1, 3)).toBe('INV-0008'); expect(pageLabel(nbOf({ style: 'none' }), 0, 3)).toBe('')
  })
  it('puts each label where a viewer shows it, on every rotation and corner', async () => {
    for (const rot of [0, 90, 180, 270]) for (const [pos, right, bottom] of [['br', true, true], ['tl', false, false], ['bc', null, true]] as const) {
      const r = await mergePages([await mk(1)], [{ id: '1', docId: 'A', src: 0, rot }], undefined, { numbering: nbOf({ style: 'bates', prefix: 'X-', digits: 3, pos }) })
      const doc = await pjs.getDocument({ data: new Uint8Array(await r.blob.arrayBuffer()), useSystemFonts: true }).promise, pg = await doc.getPage(1), vp = pg.getViewport({ scale: 1 })
      const it = ((await pg.getTextContent()).items as unknown as { str: string; transform: number[] }[]).find(i => i.str === 'X-001')!, [vx, vy] = vp.convertToViewportPoint(it.transform[4], it.transform[5])
      expect(vy > vp.height / 2).toBe(bottom); if (right !== null) expect(vx > vp.width / 2).toBe(right); else expect(Math.abs(vx - vp.width / 2)).toBeLessThan(25)
    }
  })
  it('draws header and footer text and refuses unsupported text', async () => {
    const r = await mergePages([await mk(2)], [{ id: '1', docId: 'A', src: 0, rot: 0 }, { id: '2', docId: 'A', src: 1, rot: 0 }], undefined, { numbering: nbOf({ header: 'CONFIDENTIAL', footer: 'Audit 2026' }) }); expect(r.pages).toBe(2)
    await expect(mergePages([await mk(1)], [{ id: '1', docId: 'A', src: 0, rot: 0 }], undefined, { numbering: nbOf({ footer: '\u20b9' }) })).rejects.toThrow(/Latin/)
  })
})
import { pickFit, buildFromJpegs, LADDER } from './compress'
describe('compress to a target size', () => {
  const jpg = Uint8Array.from(atob(readFileSync('/tmp/jpg.b64', 'utf8')), c => c.charCodeAt(0))
  it('picks the sharpest setting that fits, or none', () => {
    const sizes = Object.fromEntries(LADDER.map((l, i) => [`${l.dpi}/${l.q}`, 1000 - i * 100]))
    expect(pickFit(sizes, 1e6)).toEqual(LADDER[0]); expect(pickFit(sizes, 650)).toEqual(LADDER[4]); expect(pickFit(sizes, 50)).toBeNull()
  })
  it('builds a validated PDF from encoded pages', async () => {
    const b = await buildFromJpegs([{ bytes: jpg, w: 200, h: 300 }, { bytes: jpg, w: 300, h: 200 }]), d = await PDFDocument.load(new Uint8Array(await b.arrayBuffer()))
    expect(d.getPageCount()).toBe(2); expect(d.getPage(1).getSize()).toEqual({ width: 300, height: 200 })
  })
})
import { findSensitive, locatePage, luhn } from './sensitive'
import { repairByRewrite } from './repair'
describe('find sensitive data', () => {
  const kinds = ['email', 'phone', 'aadhaar', 'pan', 'card', 'custom'] as const
  it('recognises emails, PAN, phones, 12-digit numbers, valid card numbers and custom words', () => {
    const f = (s: string) => findSensitive(s, [...kinds], ['Acme Traders']).map(h => `${h.kind}:${h.text}`)
    expect(f('Mail ravi.k@example.co.in now')).toEqual(['email:ravi.k@example.co.in']); expect(f('PAN ABCDE1234F ok')).toEqual(['pan:ABCDE1234F'])
    expect(f('Call +91 98765 43210 or 9123456780')).toEqual(['phone:+91 98765 43210', 'phone:9123456780']); expect(f('ID 1234 5678 9012')).toEqual(['aadhaar:1234 5678 9012'])
    expect(f('Card 4111 1111 1111 1111 paid')).toEqual(['card:4111 1111 1111 1111']); expect(f('Ref 4111 1111 1111 1112')).toEqual([]); expect(f('Bill from ACME traders')).toEqual(['custom:ACME traders'])
    expect(luhn('4111111111111111')).toBe(true); expect(f('Invoice 2026/0417 total 6,631.60 dated 14-10-2026')).toEqual([])
  })
  it('boxes a match where the text sits, even on a rotated page', async () => {
    const d = await PDFDocument.create(), pg0 = d.addPage([595, 842]), font = await d.embedFont((await import('@cantoo/pdf-lib')).StandardFonts.Helvetica), lead = 'Mail ', mail = 'ravi@example.com'
    pg0.drawText(`${lead}${mail} now`, { x: 50, y: 700, size: 12, font }); const doc = await pjs.getDocument({ data: new Uint8Array(await d.save()), useSystemFonts: true }).promise, pg = await doc.getPage(1)
    const r0 = (await locatePage(pg as never, 0, undefined, ['email'], [])).hits[0], x0 = 50 + font.widthOfTextAtSize(lead, 12), tw = font.widthOfTextAtSize(mail, 12)
    expect(r0.text).toBe(mail); expect(r0.box.u * 595).toBeLessThanOrEqual(x0 + 0.5); expect((r0.box.u + r0.box.w) * 595).toBeGreaterThanOrEqual(x0 + tw - 0.5); expect(r0.box.w * 595).toBeLessThan(tw + 20); expect(r0.box.v * 842).toBeLessThanOrEqual(842 - 709); expect((r0.box.v + r0.box.h) * 842).toBeGreaterThanOrEqual(842 - 697.4 - 0.5); expect(r0.box.h * 842).toBeLessThan(30)
    const r90 = (await locatePage(pg as never, 90, undefined, ['email'], [])).hits[0]; expect(r90.box.h * 595).toBeGreaterThanOrEqual(tw - 0.5); expect(r90.box.h * 595).toBeLessThan(tw + 25); expect(r90.box.w * 842).toBeLessThan(40); expect(r90.box.u).toBeGreaterThan(0.3); expect(r90.box.u + r90.box.w).toBeLessThanOrEqual(1)
  })
})
describe('repair', () => {
  const make = async () => { const d = await PDFDocument.create(); for (let i = 0; i < 3; i++) d.addPage([200, 300]); return new Uint8Array(await d.save({ useObjectStreams: false })) }
  it('rewrites a PDF with junk before the header, and gives up cleanly on garbage', async () => {
    const good = await make(), junk = new Uint8Array([...new TextEncoder().encode('GARBAGE\r\n\r\n'), ...good]), r = await repairByRewrite(junk); expect(r?.pages).toBe(3); expect((await PDFDocument.load(r!.bytes)).getPageCount()).toBe(3)
    expect(await repairByRewrite(new TextEncoder().encode('this is not a pdf at all'))).toBeNull()
    const cut = good.slice(0, good.length - 90), c = await repairByRewrite(cut); expect(c === null || c.pages === 3).toBe(true)
  })
})
