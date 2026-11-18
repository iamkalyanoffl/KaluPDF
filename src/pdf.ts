import { PDFDocument, PDFArray, PDFName, PDFRawStream, PDFRef, decodePDFRawStream, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList, StandardFonts, degrees, rgb, type PDFImage, type PDFPage } from '@cantoo/pdf-lib'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface FieldInfo { name: string; kind: 'text' | 'checkbox' | 'choice'; options?: string[] }
export interface Doc { id: string; name: string; size: number; bytes: Uint8Array; pageCount: number; flags: string[]; fields: FieldInfo[]; password?: string; js: pdfjs.PDFDocumentProxy }
/** Marks sit on the visual (rotated, cropped) page. x, y, w, h are fractions 0 to 1 from the top-left. */
export interface Mark { id: string; kind: 'text' | 'highlight' | 'box' | 'redact' | 'image' | 'cover' | 'ftext' | 'fcheck'; x: number; y: number; w: number; h: number; text?: string; ital?: boolean; img?: Uint8Array }
/** crop = visual margins in points: [top, right, bottom, left] */
export interface Page { id: string; docId: string; src: number; rot: number; crop?: [number, number, number, number]; marks?: Mark[] }

export const hasPdfSignature = (b: Uint8Array) => new TextDecoder('latin1').decode(b.subarray(0, 1024)).includes('%PDF-')
export const uid = () => crypto.randomUUID()

export function parseRanges(input: string, max: number): number[] {
  const out = new Set<number>()
  for (const part of input.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part)
    if (!m) throw new Error(`"${part}" is not a valid range. Use a format like 1-3, 5, 8-10.`)
    const a = +m[1], b = m[2] ? +m[2] : a
    if (a < 1 || b < a || b > max) throw new Error(`"${part}" is outside 1–${max}.`)
    for (let i = a; i <= b; i++) out.add(i)
  }
  return [...out].sort((x, y) => x - y)
}

export function sanitizeFilename(n: string): string {
  const base = n.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 120)
  if (!base) throw new Error('Enter a file name.')
  return base + '.pdf'
}

export class PasswordError extends Error { constructor(public wrong: boolean) { super(wrong ? 'That password is not correct.' : 'This PDF is password-protected.') } }
export async function loadPdf(file: File, password?: string): Promise<Doc> {
  if (file.size === 0) throw new Error('The file is empty.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!hasPdfSignature(bytes)) throw new Error('This is not a PDF file (missing PDF header).')
  let js: pdfjs.PDFDocumentProxy
  try { js = await pdfjs.getDocument({ data: bytes.slice(), password }).promise }
  catch (e) { if ((e as { name?: string }).name === 'PasswordException') throw new PasswordError(!!password); throw new Error('The PDF is damaged or uses an unsupported format.') }
  let fields: FieldInfo[] = []
  try { fields = readFields(await PDFDocument.load(bytes.slice(), { password })) } catch { js.destroy(); throw new Error('The PDF is damaged or uses an unsupported format.') }
  const flags = detectFlags(bytes)
  return { id: uid(), name: file.name, size: file.size, bytes, pageCount: js.numPages, flags, fields, js, password }
}


function detectFlags(b: Uint8Array): string[] {
  if (b.length > 150e6) return []
  const t = new TextDecoder('latin1').decode(b), f: string[] = []
  if (t.includes('/ByteRange')) f.push('a digital signature')
  if (t.includes('/AcroForm')) f.push('form fields')
  if (t.includes('/EmbeddedFile')) f.push('attachments')
  if (t.includes('/Outlines')) f.push('bookmarks')
  return f
}
const clean = (s: string) => s.replace(/[^\x20-\x7e]/g, '?')
export interface MergeOpts { numbering?: Numbering; replace?: TextRule[]; fills?: Record<string, Record<string, string | boolean>>; rasterize?: (p: Page) => Promise<{ bytes: Uint8Array; type: 'jpg' | 'png'; w: number; h: number }>; protect?: { userPassword: string }; watermark?: string; meta?: { title?: string; author?: string }; stamp?: boolean; separators?: boolean; index?: { types: Record<string, string> } }
export interface MergeResult { blob: Blob; pages: number; warnings: string[]; redacted: { page: number; allowed: string[] }[] }

export async function mergePages(docs: Doc[], pages: Page[], onProgress?: (n: number) => void, opts: MergeOpts = {}): Promise<MergeResult> {
  if (!pages.length) throw new Error('There are no pages to merge.')
  const byId = new Map(docs.map(d => [d.id, d]))
  const runs: { docId: string; items: Page[] }[] = []
  for (const p of pages) { const l = runs[runs.length - 1]; if (l && l.docId === p.docId) l.items.push(p); else runs.push({ docId: p.docId, items: [p] }) }
  const PER = 38, idxPages = opts.index ? Math.ceil(runs.length / PER) : 0
  const items: (Page | null)[] = []
  runs.forEach((r, i) => { if (opts.separators && i > 0) items.push(null); items.push(...r.items) })
  const total = idxPages + items.length
  let n = idxPages
  const rows = runs.map((r, i) => { if (opts.separators && i > 0) n++; const from = n + 1; n += r.items.length; return { name: byId.get(r.docId)?.name ?? '', type: opts.index?.types[r.docId] ?? 'Other', from, to: n } })
  const out = await PDFDocument.create()
  const font = await out.embedFont(StandardFonts.Helvetica), bold = await out.embedFont(StandardFonts.HelveticaBold)
  const expected: { w: number; h: number; rot: number }[] = []
  for (let c = 0; c < idxPages; c++) {
    const pg = out.addPage([595, 842]); expected.push({ w: 595, h: 842, rot: 0 })
    pg.drawText('Index of documents', { x: 50, y: 790, size: 18, font: bold })
    pg.drawText(`${runs.length} documents, ${total} pages in this file`, { x: 50, y: 770, size: 10, font })
    rows.slice(c * PER, (c + 1) * PER).forEach((r, k) => {
      const y = 735 - k * 18
      pg.drawText(clean(`${c * PER + k + 1}. ${r.name}`.slice(0, 56)), { x: 50, y, size: 10, font })
      pg.drawText(clean(r.type), { x: 360, y, size: 9, font })
      pg.drawText(r.from === r.to ? `p. ${r.from}` : `pp. ${r.from}-${r.to}`, { x: 480, y, size: 10, font })
    })
  }
  const ital = await out.embedFont(StandardFonts.TimesRomanItalic), imgs = new Map<Uint8Array, PDFImage>(), redacted: { page: number; allowed: string[] }[] = []
  const srcs = new Map<string, PDFDocument>()
  const flat: string[] = [], rules = opts.replace ?? [], counts: number[] = rules.map(() => 0)
  for (const r of rules) { if (!r.find) throw new Error('Enter the text to find.'); if (/[^\x20-\x7e\xa0-\xff]/.test(r.find + r.with)) throw new Error('Text replacement works with Latin letters and numbers only (no rupee sign or other scripts).') }
  for (const r of runs) if (!srcs.has(r.docId)) { const d = byId.get(r.docId)!, s = await PDFDocument.load(d.bytes.slice(), { password: d.password }); applyForm(s, d, opts.fills?.[d.id], flat); if (rules.length) replaceText(s, rules, counts); srcs.set(r.docId, s) }
  rules.forEach((r, i) => { if (!counts[i]) throw new Error(`The text "${r.find}" was not found in a form that can be replaced. Many PDFs store text with embedded fonts or split into pieces; only simple PDFs work. Nothing was changed.`) })
  for (let i = 0; i < items.length; i++) {
    const p = items[i]
    if (!p) { out.addPage([595, 842]); expected.push({ w: 595, h: 842, rot: 0 }) }
    else if (p.marks?.some(m => m.kind === 'redact')) {
      if (!opts.rasterize) throw new Error('Redaction needs the in-browser page renderer, which is not available here.')
      const r = await opts.rasterize(p), img = r.type === 'jpg' ? await out.embedJpg(r.bytes) : await out.embedPng(r.bytes)
      const pg = out.addPage([r.w, r.h]); pg.drawImage(img, { x: 0, y: 0, width: r.w, height: r.h }); expected.push({ w: r.w, h: r.h, rot: 0 })
      await drawMarks(pg, p.marks, 0, out, font, ital, imgs); redacted.push({ page: idxPages + i + 1, allowed: p.marks.filter(m => m.kind === 'text').map(m => m.text ?? '') })
    }
    else {
      const [cp] = await out.copyPages(srcs.get(p.docId)!, [p.src])
      const rot = (((cp.getRotation().angle + p.rot) % 360) + 360) % 360
      cp.setRotation(degrees(rot))
      if (p.crop) {
        const [t, r, b, l] = p.crop, cb = cp.getCropBox()
        const m = rot === 0 ? { L: l, R: r, T: t, B: b } : rot === 90 ? { L: t, T: r, R: b, B: l } : rot === 180 ? { B: t, L: r, T: b, R: l } : { R: t, B: r, L: b, T: l }
        const x = cb.x + m.L, y = cb.y + m.B, w = cb.width - m.L - m.R, h = cb.height - m.T - m.B
        if (w < 20 || h < 20) throw new Error('The crop is too large for one of the pages.')
        cp.setMediaBox(x, y, w, h); cp.setCropBox(x, y, w, h)
      }
      out.addPage(cp)
      const { width, height } = cp.getSize(); expected.push({ w: width, h: height, rot }); if (p.marks?.length) await drawMarks(cp, p.marks, rot, out, font, ital, imgs)
    }
    onProgress?.(i + 1)
  }
  const nb: Numbering | undefined = opts.numbering ?? (opts.stamp ? { ...DEFAULT_NB, style: 'Page n of N' } : undefined)
  if (nb) { if (/[^\x20-\x7e\xa0-\xff]/.test(nb.header + nb.footer + nb.prefix)) throw new Error('Header, footer and Bates prefix text can use Latin letters and numbers only.'); if (nb.digits < 1 || nb.digits > 12) throw new Error('Bates numbers need 1 to 12 digits.') }
  if (nb || opts.watermark) out.getPages().forEach((pg, i) => {
    const { width, height } = pg.getSize()
    if (nb) labelPage(pg, font, nb, i, total, expected[i].rot)
    if (opts.watermark) watermarkPage(pg, bold, clean(opts.watermark), expected[i].rot, width, height, pg.getMediaBox().x, pg.getMediaBox().y)
  })
  out.setTitle(opts.meta?.title ?? ''); out.setAuthor(opts.meta?.author ?? ''); out.setSubject(''); out.setKeywords([]); out.setProducer(''); out.setCreator('')
  if (opts.protect) {
    if (opts.protect.userPassword.length < 6) throw new Error('Use a password of at least 6 characters.')
    out.encrypt({ userPassword: opts.protect.userPassword, ownerPassword: crypto.randomUUID() + crypto.randomUUID(), permissions: { printing: 'highResolution', copying: true } })
  }
  const bytes = await out.save()
  if (!bytes.length || !hasPdfSignature(bytes)) throw new Error('Validation failed: output is not a valid PDF.')
  const check = await PDFDocument.load(bytes, { password: opts.protect?.userPassword })
  if (check.getPageCount() !== total) throw new Error(`Validation failed: expected ${total} pages, got ${check.getPageCount()}.`)
  check.getPages().forEach((pg, i) => {
    const s = pg.getSize(), e = expected[i]
    if (Math.abs(s.width - e.w) > 0.01 || Math.abs(s.height - e.h) > 0.01 || pg.getRotation().angle !== e.rot) throw new Error(`Validation failed at output page ${i + 1}.`)
  })
  const warnings = ['Digital signatures, form fields, bookmarks, attachments and some links may not survive merging. Signed documents will no longer verify.']
  for (const r of runs) { const d = byId.get(r.docId); if (d?.flags?.length) warnings.push(`${d.name} contains ${d.flags.join(', ')}. This may not carry over.`) }
  flat.forEach(w => warnings.push(w)); rules.forEach((r, i) => warnings.push(`Replaced "${r.find}" with "${r.with}" ${counts[i]} time(s) in the text layer. Layout is not adjusted, so longer text can overlap its neighbours. Look at the pages.`))
  if (pages.some(p => p.marks?.some(m => m.kind === 'cover'))) warnings.push('Covered areas are only hidden. The original text is still in the file under the white box. Use Redact to remove content permanently.')
  if (pages.some(p => p.marks?.length)) warnings.push('Added text, highlights, boxes, covers and signatures are drawn onto the pages and cannot be edited later. Form fields you created stay fillable.')
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), pages: total, warnings, redacted }
}

type F = Awaited<ReturnType<PDFDocument['embedFont']>>

const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
/** Split plan over output positions (1-based). 'ranges': each comma item is one file. 'after': cut after these pages. */
export function splitGroups(mode: 'each' | 'ranges' | 'after', input: string, total: number): number[][] {
  if (mode === 'each') return span(1, total).map(n => [n])
  if (!input.trim()) throw new Error('Enter at least one page or range.')
  if (mode === 'ranges') return input.split(',').map(s => s.trim()).filter(Boolean).map(part => parseRanges(part, total))
  const cuts = parseRanges(input, total).filter(n => n < total), out: number[][] = []; let start = 1
  for (const c of cuts) { out.push(span(start, c)); start = c + 1 }
  out.push(span(start, total)); return out
}

function watermarkPage(pg: import('@cantoo/pdf-lib').PDFPage, font: F, text: string, rot: number, w: number, h: number, ox = 0, oy = 0) {
  const size = Math.max(14, Math.min(64, (Math.hypot(w, h) * 0.7) / (text.length * 0.6))), tw = font.widthOfTextAtSize(text, size), a = ((45 + rot) * Math.PI) / 180
  pg.drawText(text, { font, size, color: rgb(0.5, 0.5, 0.5), opacity: 0.18, rotate: degrees(45 + rot),
    x: ox + w / 2 - (tw / 2) * Math.cos(a) + size * 0.35 * Math.sin(a), y: oy + h / 2 - (tw / 2) * Math.sin(a) - size * 0.35 * Math.cos(a) })
}

/** Draws marks onto a page. Visual (u, v) fractions are mapped to raw page space for each rotation. */
async function drawMarks(pg: PDFPage, marks: Mark[], rot: number, out: PDFDocument, font: F, ital: F, imgs: Map<Uint8Array, PDFImage>) {
  const mb = pg.getMediaBox(), W = mb.width, H = mb.height, vw = rot % 180 ? H : W, vh = rot % 180 ? W : H, a = (rot * Math.PI) / 180
  const at = (u: number, v: number) => rawAt(mb, rot, u, v)
  for (const m of marks) {
    if (m.kind === 'redact') continue
    const [x, y] = at(m.x, m.y + m.h), width = m.w * vw, height = m.h * vh, rotate = degrees(rot)
    if (m.kind === 'highlight') pg.drawRectangle({ x, y, width, height, rotate, color: rgb(1, 0.9, 0.2), opacity: 0.35 })
    else if (m.kind === 'box') pg.drawRectangle({ x, y, width, height, rotate, borderColor: rgb(0, 0, 0), borderWidth: 1.5 })
    else if (m.kind === 'cover') pg.drawRectangle({ x, y, width, height, rotate, color: rgb(1, 1, 1) })
    else if (m.kind === 'ftext' || m.kind === 'fcheck') {
      const name = (m.text ?? '').trim(); if (!/^[\w .-]{1,60}$/.test(name)) throw new Error(`The form field name "${name}" is not allowed. Use letters, numbers, spaces, dots, dashes or underscores.`)
      const o = { x, y, width, height, borderWidth: 1, borderColor: rgb(0.1, 0.3, 0.7), rotate }
      try { const form = out.getForm(); if (m.kind === 'ftext') form.createTextField(name).addToPage(pg, o); else form.createCheckBox(name).addToPage(pg, o) }
      catch { throw new Error(`Could not create the form field "${name}". Field names must be unique in the whole file.`) }
    }
    else if (m.kind === 'text') {
      if (/[^\x20-\x7e\xa0-\xff]/.test(m.text ?? '')) throw new Error('An added text box has characters the built-in font cannot show (for example the rupee sign). Nothing was changed; edit that text and try again.')
      const size = height * 0.7
      pg.drawText(m.text ?? '', { x: x - Math.sin(a) * 0.2 * size, y: y + Math.cos(a) * 0.2 * size, size, font: m.ital ? ital : font, color: rgb(0, 0, 0), rotate })
    } else if (m.img) {
      let img = imgs.get(m.img); if (!img) { img = m.img[0] === 0xff ? await out.embedJpg(m.img) : await out.embedPng(m.img); imgs.set(m.img, img) }
      pg.drawImage(img, { x, y, width, height, rotate })
    }
  }
}
/** Extracted text of every page, as a viewer would return it. */
export async function pageTexts(bytes: Uint8Array, password?: string): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), password }).promise, out: string[] = []
  for (let i = 1; i <= doc.numPages; i++) out.push(((await (await doc.getPage(i)).getTextContent()).items as unknown as { str?: string }[]).map(t => t.str ?? '').join(' '))
  await doc.destroy(); return out
}
/** Counts text items on redacted output pages that are not text the user added. Must be 0. */
export async function foreignText(bytes: Uint8Array, redacted: { page: number; allowed: string[] }[], password?: string): Promise<number> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), password }).promise; let n = 0
  for (const r of redacted) { const items = (await (await doc.getPage(r.page)).getTextContent()).items as unknown as { str?: string }[]; n += items.filter(i => typeof i.str === 'string' && i.str.trim() && !r.allowed.includes(i.str)).length }
  await doc.destroy(); return n
}

function readFields(pdf: PDFDocument): FieldInfo[] {
  try {
    return pdf.getForm().getFields().flatMap((f): FieldInfo[] => f instanceof PDFTextField ? [{ name: f.getName(), kind: 'text' }] : f instanceof PDFCheckBox ? [{ name: f.getName(), kind: 'checkbox' }]
      : f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup ? [{ name: f.getName(), kind: 'choice', options: f.getOptions() }] : [])
  } catch { return [] }
}
/** Fills the chosen fields, then flattens the form so the values become part of the pages (merging cannot carry live fields over). */
function applyForm(s: PDFDocument, d: Doc, fills: Record<string, string | boolean> = {}, notes: string[]) {
  if (!d.fields?.length) return
  const form = s.getForm()
  for (const [name, v] of Object.entries(fills)) {
    try {
      const f = form.getField(name)
      if (f instanceof PDFTextField) { if (/[^\x20-\x7e\xa0-\xff]/.test(String(v))) throw new Error('unsupported characters'); f.setText(v === '' ? undefined : String(v)) }
      else if (f instanceof PDFCheckBox) { if (v) f.check(); else f.uncheck() }
      else if ((f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup) && v !== '') f.select(String(v))
    } catch { throw new Error(`Could not fill the field "${name}" in ${d.name}. The value may contain characters the form font cannot show (for example the rupee sign), or may not be an allowed choice. Nothing was changed.`) }
  }
  try { form.flatten(); notes.push(`${d.name}: form fields were flattened into the pages, so they can no longer be edited.`) }
  catch { if (Object.keys(fills).length) throw new Error(`Could not fill the form in ${d.name}. A value may contain characters the form font cannot show (for example the rupee sign). Nothing was changed.`); notes.push(`${d.name}: the form fields could not be flattened and will not be fillable or visible as filled in the merged file.`) }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** Fills {Month}, {Year} and {MM} in a file name pattern from a value like "2026-03". */
export function resolvePattern(pattern: string, month: string): string {
  const [y, m] = month.split('-')
  return pattern.replace(/\{Month\}/gi, MONTHS[+m - 1] ?? '').replace(/\{Year\}/gi, y ?? '').replace(/\{MM\}/gi, m ?? '')
}

export interface TextRule { find: string; with: string }
const unesc = (s: string) => s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, g: string) => /^[0-7]/.test(g) ? String.fromCharCode(parseInt(g, 8)) : ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[g] ?? g)
const esc = (s: string) => s.replace(/[\\()]/g, '\\$&').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
const bin2str = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return s }
function applyRules(t: string, rules: TextRule[], counts: number[]): string { let o = t; rules.forEach((r, i) => { const parts = o.split(r.find); if (parts.length > 1) { counts[i] += parts.length - 1; o = parts.join(r.with) } }); return o }
function editContent(src: string, rules: TextRule[], counts: number[]): string {
  return src.replace(/\((?:\\[\s\S]|[^\\()])*\)|(?<!<)<([0-9A-Fa-f\s]*)>(?!>)/g, (m, hex: string | undefined) => {
    if (hex === undefined) { const t = unesc(m.slice(1, -1)), o = applyRules(t, rules, counts); return o === t ? m : `(${esc(o)})` }
    const h = hex.replace(/\s+/g, ''); if (!h || h.length % 2) return m
    const t = String.fromCharCode(...(h.match(/../g) ?? []).map(x => parseInt(x, 16))), o = applyRules(t, rules, counts)
    return o === t ? m : '<' + [...o].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase() + '>'
  })
}
/** Replaces text inside the page content of simple PDFs (single-byte fonts, text not split into pieces). Returns nothing; `counts` collects hits per rule. */
export function replaceText(pdf: PDFDocument, rules: TextRule[], counts: number[]) {
  for (const page of pdf.getPages()) {
    const c = page.node.get(PDFName.of('Contents')), refs = c instanceof PDFArray ? c.asArray() : c ? [c] : []
    for (const r of refs) {
      const st = pdf.context.lookup(r); if (!(st instanceof PDFRawStream)) continue
      const before = counts.join(','), out = editContent(bin2str(decodePDFRawStream(st).decode()), rules, counts)
      if (counts.join(',') !== before && r instanceof PDFRef) pdf.context.assign(r, pdf.context.flateStream(Uint8Array.from(out, ch => ch.charCodeAt(0))))
    }
  }
}

export interface Numbering { style: 'none' | 'n' | 'n of N' | 'Page n' | 'Page n of N' | 'bates'; pos: 'bl' | 'bc' | 'br' | 'tl' | 'tc' | 'tr'; start: number; skip: number; prefix: string; digits: number; header: string; footer: string }
export const DEFAULT_NB: Numbering = { style: 'none', pos: 'bc', start: 1, skip: 0, prefix: '', digits: 6, header: '', footer: '' }
/** Maps a point on the visual page (fractions from the top-left) to raw page coordinates for a page shown rotated by `rot`. */
export function rawAt(mb: { x: number; y: number; width: number; height: number }, rot: number, u: number, v: number): [number, number] {
  const W = mb.width, H = mb.height
  return rot === 0 ? [mb.x + u * W, mb.y + H - v * H] : rot === 90 ? [mb.x + v * W, mb.y + u * H] : rot === 180 ? [mb.x + W - u * W, mb.y + v * H] : [mb.x + W - v * W, mb.y + H - u * H]
}
/** The number text for output page i (0-based), or '' when that page is left unnumbered. */
export function pageLabel(nb: Numbering, i: number, total: number): string {
  if (nb.style === 'none' || i < nb.skip) return ''
  const n = i - nb.skip + nb.start, last = total - nb.skip + nb.start - 1
  switch (nb.style) { case 'n': return `${n}`; case 'n of N': return `${n} of ${last}`; case 'Page n': return `Page ${n}`; case 'Page n of N': return `Page ${n} of ${last}`; case 'bates': return nb.prefix + String(n).padStart(nb.digits, '0') }
  return ''
}
function labelPage(pg: PDFPage, font: F, nb: Numbering, i: number, total: number, rot: number) {
  const mb = pg.getMediaBox(), vw = rot % 180 ? mb.height : mb.width, vh = rot % 180 ? mb.width : mb.height, m = 20, size = 9
  const put = (text: string, col: string, top: boolean) => {
    if (!text) return; const tw = font.widthOfTextAtSize(text, size), xv = col === 'l' ? m : col === 'c' ? (vw - tw) / 2 : vw - m - tw, [x, y] = rawAt(mb, rot, xv / vw, (top ? m + size : vh - m) / vh)
    pg.drawText(text, { x, y, size, font, color: rgb(0.25, 0.25, 0.25), rotate: degrees(rot) })
  }
  put(pageLabel(nb, i, total), nb.pos[1], nb.pos[0] === 't'); put(nb.header, 'c', true); put(nb.footer, 'l', false)
}
