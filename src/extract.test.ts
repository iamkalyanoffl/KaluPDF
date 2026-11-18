import { describe, it, expect } from 'vitest'
import { unzipSync } from 'fflate'
import { groupLines, cells, linesToCsv, makeDocx, compareLines } from './extract'
const it_ = (str: string, x: number, y: number, w = 30) => ({ str, x, y, w })
describe('text extraction', () => {
  it('groups lines top to bottom and splits cells at wide gaps', () => {
    const ls = groupLines([it_('Total', 50, 100), it_('1,250.00', 300, 101), it_('Invoice', 50, 700), it_('12', 82, 700, 10)])
    expect(ls.length).toBe(2); expect(cells(ls[0])).toEqual(['Invoice 12']); expect(cells(ls[1])).toEqual(['Total', '1,250.00'])
  })
  it('csv escapes quotes', () => expect(linesToCsv([[[it_('a"b', 0, 0)]]])).toContain('"a""b"'))
  it('docx holds the text and escapes markup', () => {
    const z = unzipSync(makeDocx([['A & B <1>'], ['p2']])), x = new TextDecoder().decode(z['word/document.xml'])
    expect(x).toContain('A &amp; B &lt;1&gt;'); expect(x).toContain('w:type="page"'); expect(Object.keys(z)).toContain('[Content_Types].xml')
  })
})
describe('compare', () => {
  it('finds differing amounts regardless of position', () => expect(compareLines(['Total 100', 'Paid'], ['Paid', 'Total 120'])).toEqual({ onlyA: ['Total 100'], onlyB: ['Total 120'] }))
  it('reports no difference', () => expect(compareLines(['a  b'], ['a b'])).toEqual({ onlyA: [], onlyB: [] }))
})
