import { zipSync } from 'fflate'
export interface Item { str: string; x: number; y: number; w: number }
export function groupLines(items: Item[]): Item[][] {
  const its = items.filter(i => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x), lines: Item[][] = []
  for (const it of its) { const l = lines[lines.length - 1]; if (l && Math.abs(l[0].y - it.y) <= 3) l.push(it); else lines.push([it]) }
  return lines.map(l => l.sort((a, b) => a.x - b.x))
}
/** Cells: a new cell starts where the horizontal gap exceeds 10 points. A heuristic, not real table detection. */
export function cells(l: Item[]): string[] {
  const out: string[] = []; let end = -1e9
  for (const i of l) { if (out.length && i.x - end <= 10) out[out.length - 1] += (i.x - end > 1 ? ' ' : '') + i.str; else out.push(i.str); end = i.x + i.w }
  return out.map(s => s.trim())
}
export const lineStrings = (ls: Item[][]) => ls.map(l => cells(l).join(' '))
export const linesToCsv = (pages: Item[][][]) => '\ufeff' + pages.flatMap((ls, i) => [[`Page ${i + 1}`], ...ls.map(cells)]).map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n')
const esc = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))
const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', enc = (s: string) => new TextEncoder().encode(s)
/** Text-only Word file: one paragraph per line, a page break between pages. No fonts, columns, tables or images. */
export function makeDocx(pages: string[][]): Uint8Array {
  const body = pages.map((ls, i) => ls.map(l => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('') + (i < pages.length - 1 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '')).join('')
  return zipSync({
    '[Content_Types].xml': enc(`${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    '_rels/.rels': enc(`${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/document.xml': enc(`${H}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`) })
}
/** Which lines appear only on one side. Ignores order and position; compares text only. */
export function compareLines(a: string[], b: string[]) {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim(), cnt = new Map<string, number>()
  for (const l of b.map(norm).filter(Boolean)) cnt.set(l, (cnt.get(l) ?? 0) + 1)
  const onlyA: string[] = [], onlyB: string[] = []
  for (const l of a.map(norm).filter(Boolean)) { const c = cnt.get(l) ?? 0; if (c > 0) cnt.set(l, c - 1); else onlyA.push(l) }
  cnt.forEach((c, l) => { for (let i = 0; i < c; i++) onlyB.push(l) })
  return { onlyA, onlyB }
}
