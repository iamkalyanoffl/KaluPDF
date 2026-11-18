import 'regenerator-runtime/runtime'
import fontkit from '@pdf-lib/fontkit'
import { unzipSync } from 'fflate'
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from '@cantoo/pdf-lib'
const A4: [number, number] = [595.28, 841.89]
type Kind = 'jpg' | 'png' | 'img' | null
function kind(b: Uint8Array): Kind {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  const s = String.fromCharCode(...b)
  return s.startsWith('BM') || s.startsWith('GIF8') || (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') ? 'img' : null
}
const asFile = (bytes: Uint8Array, name: string) => new File([bytes as BlobPart], name.replace(/\.[^.]+$/, '') + '.pdf', { type: 'application/pdf' })
async function toPng(f: File): Promise<Uint8Array> {
  const bm = await createImageBitmap(f), c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height
  const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bm, 0, 0)
  return new Uint8Array(await (await new Promise<Blob>((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('Image conversion failed.')), 'image/png'))).arrayBuffer())
}
/** Images (detected by their bytes, not their names) and .txt files become PDFs; PDFs and anything else pass through unchanged. */
export type FontLoader = (n: 'lat' | 'latx' | 'deva' | 'tam') => Promise<Uint8Array>
export async function toPdfFile(f: File, loadFont?: FontLoader): Promise<File> {
  if (f.size === 0) return f
  const k = kind(new Uint8Array(await f.slice(0, 12).arrayBuffer()))
  if (!k) {
    if (/\.txt$/i.test(f.name)) { if (f.size > 2e6) throw new Error('Text files over 2 MB are not supported.'); return textPdf(await f.text(), f.name, loadFont) }
    if (/\.docx$/i.test(f.name)) return textPdf(await docxText(f), f.name, loadFont)
    if (/\.pptx$/i.test(f.name)) return textPdf(await pptxText(f), f.name, loadFont)
    if (/\.xlsx$/i.test(f.name)) { if (f.size > 25e6) throw new Error('Excel files over 25 MB are not supported.'); return tablePdf(xlsxSheets(new Uint8Array(await f.arrayBuffer())), f.name, loadFont) }
    if (/\.csv$/i.test(f.name)) { if (f.size > 5e6) throw new Error('CSV files over 5 MB are not supported.'); return tablePdf([{ name: f.name, rows: parseCsv(await f.text()) }], f.name, loadFont) }
    return f
  }
  const pdf = await PDFDocument.create(); let bytes: Uint8Array = new Uint8Array(await f.arrayBuffer())
  try {
    const img = k === 'jpg' ? await pdf.embedJpg(bytes) : (k === 'img' && (bytes = await toPng(f)), await pdf.embedPng(bytes))
    const land = img.width > img.height, pw = land ? A4[1] : A4[0], ph = land ? A4[0] : A4[1], m = 28
    const sc = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height), w = img.width * sc, h = img.height * sc
    pdf.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h })
  } catch { throw new Error('This image could not be read or is in an unsupported variant.') }
  return asFile(await pdf.save(), f.name)
}
async function docxText(f: File): Promise<string> {
  if (f.size > 25e6) throw new Error('Word files over 25 MB are not supported.')
  let xml = ''
  try { xml = new TextDecoder().decode(unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: e => e.name === 'word/document.xml' })['word/document.xml']) }
  catch { throw new Error('This Word file could not be read. Only .docx files are supported, not old .doc files.') }
  const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  return xml.split('</w:p>').map(p => dec((p.match(/<w:t[^>]*>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) ?? []).map(t => t === '<w:tab/>' ? '    ' : t === '<w:br/>' ? ' ' : t.replace(/<[^>]+>/g, '')).join(''))).join('\n')
}
const REFUSE = 'This text contains characters (for example the rupee sign or non-Latin scripts) that the built-in PDF font cannot show. Nothing was converted, so no characters were replaced.'
const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const attr = (s: string, n: string) => new RegExp(`(?:^|\\s)${n}="([^"]*)"`).exec(s)?.[1] ?? ''
async function pptxText(f: File): Promise<string> {
  if (f.size > 50e6) throw new Error('PowerPoint files over 50 MB are not supported.')
  let z: Record<string, Uint8Array>; try { z = unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: e => /^ppt\/slides\/slide\d+\.xml$/.test(e.name) }) } catch { throw new Error('This PowerPoint file could not be read. Only .pptx files are supported, not old .ppt files.') }
  const names = Object.keys(z).sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')))
  if (!names.length) throw new Error('No slides were found in this file.')
  return names.map((n, i) => `Slide ${i + 1}\n\n` + new TextDecoder().decode(z[n]).split('</a:p>').map(p => dec([...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join(''))).filter(Boolean).join('\n')).join('\n\f\n')
}
interface Sheet { name: string; rows: string[][] }
export function parseCsv(t: string): string[][] {
  const first = t.split(/\r?\n/)[0] ?? '', d = [',', ';', '\t'].map(c => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0], rows: string[][] = []; let row: string[] = [], cell = '', q = false
  for (let i = 0; i < t.length; i++) { const c = t[i]
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c }
    else if (c === '"') q = true; else if (c === d) { row.push(cell); cell = '' } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x.trim())) rows.push(row); row = [] } else cell += c }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row); return rows.map(r => r.map(x => x.trim()))
}
/** Reads the stored values of every sheet. Number formats are not applied (except dates); formulas show their last saved result. */
export function xlsxSheets(bytes: Uint8Array): Sheet[] {
  let z: Record<string, Uint8Array>; try { z = unzipSync(bytes) } catch { throw new Error('This Excel file could not be read. Only .xlsx files are supported, not old .xls files.') }
  const txt = (p: string) => (z[p] ? new TextDecoder().decode(z[p]) : ''), styles = txt('xl/styles.xml')
  const shared = [...txt('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => dec([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(x => x[1]).join('')))
  const fmts = new Map([...styles.matchAll(/<numFmt\b([^>]*)\/>/g)].map(m => [+attr(m[1], 'numFmtId'), dec(attr(m[1], 'formatCode'))] as const))
  const isDate = (id: number) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (id >= 164 && /[dmyh]/i.test((fmts.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')))
  const xfs = [...(/<cellXfs[\s\S]*?<\/cellXfs>/.exec(styles)?.[0] ?? '').matchAll(/<xf\b([^>]*)>/g)].map(m => isDate(+attr(m[1], 'numFmtId')))
  const rels = new Map([...txt('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)>/g)].map(m => [attr(m[1], 'Id'), attr(m[1], 'Target')] as const))
  const out: Sheet[] = []
  for (const m of txt('xl/workbook.xml').matchAll(/<sheet\b([^>]*)>/g)) {
    const t = (rels.get(attr(m[1], 'r:id')) ?? '').replace(/^\//, ''), xml = txt(t.startsWith('xl/') ? t : 'xl/' + t), grid = new Map<number, Map<number, string>>()
    if (!xml) continue
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /^([A-Z]+)(\d+)$/.exec(attr(c[1], 'r')); if (!ref) continue
      const col = [...ref[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1, row = +ref[2], type = attr(c[1], 't'), inner = c[2] ?? '', v = /<v>([^<]*)<\/v>/.exec(inner)?.[1] ?? ''
      let val = ''
      if (type === 's') val = shared[+v] ?? ''; else if (type === 'inlineStr') val = dec([...inner.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(x => x[1]).join('')); else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE'
      else if (type === 'str' || type === 'e') val = dec(v); else if (v !== '' && !isNaN(+v)) { if (xfs[+attr(c[1], 's')] && +v > 0) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 864e5); val = `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}` } else val = String(+(+v).toPrecision(12)) }
      if (val !== '') { if (!grid.has(row)) grid.set(row, new Map()); grid.get(row)!.set(col, val) }
    }
    if (grid.size > 20000) throw new Error(`The sheet "${dec(attr(m[1], 'name'))}" has more than 20,000 rows, which is too many to convert.`)
    out.push({ name: dec(attr(m[1], 'name')), rows: [...grid.keys()].sort((a, b) => a - b).map(r => { const g = grid.get(r)!, w = Math.max(...g.keys()) + 1; return Array.from({ length: w }, (_, i) => g.get(i) ?? '') }) })
  }
  if (!out.length) throw new Error('No sheets were found in this file.')
  return out
}
type FontSet = { runs(s: string): { f: PDFFont; t: string }[]; width(s: string, size: number): number }
async function fontSet(pdf: PDFDocument, text: string, loadFont?: FontLoader): Promise<FontSet> {
  const plain = !/[^\r\n\x20-\x7e\xa0-\xff]/.test(text)
  if (!plain && !loadFont) throw new Error(REFUSE)
  if (!plain) pdf.registerFontkit(fontkit)
  const helv = await pdf.embedFont(StandardFonts.Helvetica), fonts = new Map<string, { f: PDFFont; set: Set<number> }>(), of = new Map<string, PDFFont>()
  for (const c of new Set([...text])) {
    if (c === '\n' || c === '\r') continue
    if (/[\x20-\x7e\xa0-\xff]/.test(c)) { of.set(c, helv); continue }
    const cp = c.codePointAt(0)!, order = cp >= 0x900 && cp <= 0x97f ? ['deva', 'lat', 'latx'] : cp >= 0xb80 && cp <= 0xbff ? ['tam', 'lat', 'latx'] : ['lat', 'latx', 'deva', 'tam']; let hit: PDFFont | undefined
    for (const n of order) { let e = fonts.get(n); if (!e) { const f = await pdf.embedFont(await loadFont!(n as 'lat'), { subset: false }); e = { f, set: new Set(f.getCharacterSet()) }; fonts.set(n, e) } if (e.set.has(cp)) { hit = e.f; break } }
    if (!hit) throw new Error(`The character "${c}" cannot be shown with the bundled fonts. Nothing was converted, so no characters were replaced.`)
    of.set(c, hit)
  }
  const runs = (s: string) => { const r: { f: PDFFont; t: string }[] = []; for (const c of [...s]) { const f = of.get(c) ?? helv, l = r[r.length - 1]; if (l && l.f === f) l.t += c; else r.push({ f, t: c }) } return r }
  return { runs, width: (s, size) => runs(s).reduce((w, r) => w + r.f.widthOfTextAtSize(r.t, size), 0) }
}
const draw = (pg: PDFPage, fs: FontSet, s: string, x: number, y: number, size: number) => { for (const r of fs.runs(s)) { pg.drawText(r.t, { x, y, size, font: r.f }); x += r.f.widthOfTextAtSize(r.t, size) } }
/** Plain text to PDF pages. A line holding only a form feed starts a new page. Anything that cannot be shown is refused, never replaced. */
async function textPdf(text: string, name: string, loadFont?: FontLoader): Promise<File> {
  text = text.replace(/\t/g, '    '); const pdf = await PDFDocument.create(), fs = await fontSet(pdf, text.replace(/\f/g, ''), loadFont), size = 10, m = 50, lh = 14, maxW = A4[0] - 2 * m, lines: string[] = []
  for (const para of text.split(/\r?\n/)) { if (para === '\f') { lines.push('\f'); continue } let cur = ''; for (const w of para.split(' ')) { const t = cur ? cur + ' ' + w : w; if (cur && fs.width(t, size) > maxW) { lines.push(cur); cur = w } else cur = t } lines.push(cur) }
  const per = Math.floor((A4[1] - 2 * m) / lh), pages: string[][] = [[]]
  for (const l of lines) { if (l === '\f') { pages.push([]); continue } const cur = pages[pages.length - 1]; if (cur.length >= per) pages.push([l]); else cur.push(l) }
  for (const pl of pages) if (pl.length) { const pg = pdf.addPage(A4); pl.forEach((l, j) => draw(pg, fs, l, m, A4[1] - m - j * lh, size)) }
  return asFile(await pdf.save(), name)
}
/** Sheets to PDF as plain tables of stored values. Wide sheets switch to landscape and shrink; if still unreadable they are refused. */
async function tablePdf(sheets: Sheet[], name: string, loadFont?: FontLoader): Promise<File> {
  if (!sheets.some(s => s.rows.length)) throw new Error('This file has no cells with values.')
  const pdf = await PDFDocument.create(), fs = await fontSet(pdf, sheets.flatMap(s => [s.name, ...s.rows.flat()]).join('\n'), loadFont), m = 36
  for (const sh of sheets) {
    if (!sh.rows.length) continue
    const cols = Math.max(...sh.rows.map(r => r.length)), cw = Array.from({ length: cols }, (_, c) => Math.max(...sh.rows.map(r => fs.width(r[c] ?? '', 10))) + 10), total = cw.reduce((a, b) => a + b, 0)
    const land = total > A4[0] - 2 * m, pw = land ? A4[1] : A4[0], ph = land ? A4[0] : A4[1], size = Math.min(10, (10 * (pw - 2 * m)) / total)
    if (size < 5) throw new Error(`The sheet "${sh.name}" is too wide to fit a page legibly (${cols} columns). Nothing was converted.`)
    const k = size / 10, lh = size * 1.5, per = Math.floor((ph - 2 * m - 20) / lh)
    for (let i = 0; i < sh.rows.length; i += per) {
      const pg = pdf.addPage([pw, ph]); draw(pg, fs, `${sh.name}${i ? ' (continued)' : ''}`, m, ph - m, size + 2)
      sh.rows.slice(i, i + per).forEach((row, j) => { let x = m; row.forEach((cell, c) => { const w = fs.width(cell, size); draw(pg, fs, cell, /^-?[\d,.]+%?$/.test(cell) ? x + cw[c] * k - 5 * k - w : x, ph - m - 20 - j * lh, size); x += cw[c] * k }) })
    }
  }
  return asFile(await pdf.save(), name)
}
