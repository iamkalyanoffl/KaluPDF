import { useState } from 'react'
import type { Doc, Page } from './pdf'
import { groupLines, lineStrings, linesToCsv, makeDocx, compareLines, type Item } from './extract'
import { ocrPages, scanPages, OCR_LANGS, type OcrPage } from './ocr'
import { buildSearchable, checkSearchable } from './searchable'
import { loadFontBrowser } from './fonts'
import { pageTexts } from './pdf'
import { suspiciousAmounts } from './amounts'
interface P { redacted?: boolean; edited?: boolean; docs: Doc[]; pages: Page[]; toolId?: string; route: string; base: string; say(k: 'ok' | 'warn' | 'err', t: string): void; offer(b: Blob, name: string): void }
type Raw = { str?: unknown; transform: number[]; width: number }
async function pageItems(d: Doc, i: number): Promise<Item[][]> {
  const tc = await (await d.js.getPage(i + 1)).getTextContent()
  return groupLines((tc.items as unknown as Raw[]).filter(t => typeof t.str === 'string').map(t => ({ str: t.str as string, x: t.transform[4], y: t.transform[5], w: t.width })))
}
export default function Extras({ redacted, edited, docs, pages, toolId, route, base, say, offer }: P) {
  const [work, setWork] = useState<string | null>(null), [langs, setLangs] = useState(['eng']), [ocr, setOcr] = useState<OcrPage[] | null>(null)
  const [a, setA] = useState(0), [b, setB] = useState(1), [cmp, setCmp] = useState<string[] | null>(null)
  const blocked = () => { if (edited) { say('err', 'Annotations and form entries are not included in OCR. Merge first, then open the merged file here.'); return true }
   if (redacted) { say('err', 'Some pages have redactions. Text extraction and OCR read the original pages and would expose the redacted text. Merge first, then open the merged file here.'); return true } return false }
  async function exportText(kind: 'txt' | 'csv' | 'docx') {
    if (blocked()) return
    try {
      const pl: Item[][][] = []
      for (let i = 0; i < pages.length; i++) { setWork(`Reading page ${i + 1} of ${pages.length}…`); pl.push(await pageItems(docs.find(d => d.id === pages[i].docId)!, pages[i].src)) }
      const strs = pl.map(lineStrings)
      if (!strs.some(p => p.length)) return say('warn', 'No selectable text was found. These look like scans. Use “Read scanned pages (OCR)” instead.')
      if (kind === 'txt') offer(new Blob([strs.map((p, i) => `--- Page ${i + 1} ---\n${p.join('\n')}`).join('\n\n')], { type: 'text/plain' }), base + '.txt')
      else if (kind === 'csv') offer(new Blob([linesToCsv(pl)], { type: 'text/csv' }), base + '.csv')
      else offer(new Blob([makeDocx(strs) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), base + '.docx')
      say('warn', 'Limited export: this is the text from the PDF’s text layer only. Layout, fonts, tables, columns and images are not rebuilt. Check every figure against the original before relying on it.')
    } catch { say('err', 'Text could not be read from one of the pages.') } finally { setWork(null) }
  }
  async function runOcr() {
    if (blocked()) return
    try { setOcr(null); setWork('Starting the OCR engine…'); setOcr(await ocrPages(docs, pages, langs, n => setWork(`Reading page ${n} of ${pages.length}…`), tidy)); say('ok', 'OCR finished on this computer. Review the text below: OCR can misread digits, so check every amount against the page.') }
    catch { say('err', 'OCR failed. The engine or language data could not be loaded. Nothing was changed.') } finally { setWork(null) }
  }
  const [sOk, setSOk] = useState(false), [tidy, setTidy] = useState(true)
  async function makeSearchable() {
    if (blocked()) return
    try {
      setWork('Starting the OCR engine…'); const { scans, confidence } = await scanPages(docs, pages, langs, n => setWork(`Reading page ${n} of ${pages.length}…`), tidy)
      setWork('Building the searchable PDF…'); const { bytes, words, lossy } = await buildSearchable(scans, loadFontBrowser)
      setWork('Checking the hidden text…'); const chk = checkSearchable(await pageTexts(bytes), scans)
      if (!words) throw new Error('OCR found no text on these pages, so there is nothing to make searchable.')
      if (chk.missing / chk.total > 0.02) throw new Error(`The hidden text did not check out (${chk.missing} of ${chk.total} words could not be read back, for example “${chk.sample[0]}”). No file is offered.`)
      offer(new Blob([bytes as BlobPart], { type: 'application/pdf' }), base + '_searchable.pdf')
      say('ok', `Searchable PDF built and checked: ${pages.length} page(s), ${words} words, average OCR confidence ${confidence}%.${lossy ? ` ${lossy} character(s) could not be represented and became “?” in the hidden text.` : ''}`)
      say('warn', 'Every page is now an image with an invisible text layer. Original text, forms, links and signatures are not kept. OCR can misread digits, so check amounts against the page. Hindi and Tamil are less accurate than English.')
    } catch (e) { say('err', /^(The hidden|OCR found)/.test((e as Error).message) ? (e as Error).message : 'The searchable PDF could not be built. Nothing was changed.') } finally { setWork(null) }
  }
  async function compare() {
    if (docs.length < 2 || a === b) return say('err', 'Choose two different files to compare.')
    try {
      const get = async (d: Doc) => { const o: string[][] = []; for (let i = 0; i < d.pageCount; i++) { setWork(`Reading ${d.name}, page ${i + 1}…`); o.push(lineStrings(await pageItems(d, i))) } return o }
      const A = await get(docs[a]), B = await get(docs[b]), out = [`Pages: ${A.length} in the first file, ${B.length} in the second.`]
      if (!A.flat().length && !B.flat().length) return say('warn', 'Neither file has selectable text, so a text comparison is not possible. Run OCR first.')
      for (let i = 0; i < Math.max(A.length, B.length); i++) { const r = compareLines(A[i] ?? [], B[i] ?? []); if (r.onlyA.length || r.onlyB.length) out.push(`Page ${i + 1}: ${r.onlyA.length} line(s) only in the first, ${r.onlyB.length} only in the second. e.g. “${(r.onlyA[0] ?? r.onlyB[0]).slice(0, 80)}”`) }
      if (out.length === 1) out.push('No text differences found. This does not check images, layout or signatures.'); setCmp(out.slice(0, 40))
    } catch { say('err', 'Comparison failed on one of the pages.') } finally { setWork(null) }
  }
  const open = (id: string) => toolId === id
  return (<>
    {work && <p role="status" className="msg warn">{work}</p>}
    <details className="tool" key={'x' + route} open={open('extract-text')}><summary>Extract text and tables (limited)</summary>
      <p className="empty">Reads the PDF’s own text for your current pages. It does not rebuild layout. Scanned pages have no text: use OCR.</p>
      <button disabled={!!work || !pages.length} onClick={() => exportText('txt')}>Text (.txt)</button><button disabled={!!work || !pages.length} onClick={() => exportText('docx')}>Word, text only (.docx)</button><button disabled={!!work || !pages.length} onClick={() => exportText('csv')}>Spreadsheet guess (.csv)</button>
    </details>
    <details className="tool" key={'o' + route} open={open('ocr-pdf') || open('searchable-pdf')}><summary>Read scanned pages (OCR)</summary>
      <p className="empty">Runs on this computer using an engine bundled with the site. It gives reviewable text, or a searchable PDF.</p>
      <p className="msg warn">OCR can misread numbers. On a noisy, tilted test scan it read 1,011.60 as 101160 and 14-10-2026 as 1410-2026. Always check amounts and dates against the page.</p>
      <label className="chk"><input type="checkbox" checked={tidy} onChange={e => setTidy(e.target.checked)} />Clean up scans first (removes speckles and turns pages black and white). A searchable PDF then contains the cleaned copy.</label>
      {Object.entries(OCR_LANGS).map(([k, n]) => <label className="chk" key={k}><input type="checkbox" checked={langs.includes(k)} onChange={e => setLangs(l => e.target.checked ? [...l, k] : l.filter(x => x !== k))} />{n}</label>)}
      <button disabled={!!work || !pages.length || !langs.length} onClick={runOcr}>Read {pages.length} page(s)</button>
      <label className="chk"><input type="checkbox" checked={sOk} onChange={e => setSOk(e.target.checked)} />I understand a searchable PDF turns every page into an image with a hidden text layer, and original text, forms, links and signatures are not kept</label>
      <button disabled={!!work || !pages.length || !langs.length || !sOk} onClick={makeSearchable}>Make searchable PDF</button>
      {ocr && <><ul className="blank">{ocr.map(o => <li key={o.n}><b>Page {o.n}</b> <small>{o.confidence}% confidence{o.confidence < 80 ? '. Please check every figure' : ''}</small>
        <textarea aria-label={`OCR text for page ${o.n}`} rows={4} value={o.text} onChange={e => setOcr(r => r!.map(x => x.n === o.n ? { ...x, text: e.target.value } : x))} />{suspiciousAmounts(o.text).length > 0 && <small className="msg warn">Check against the page: {suspiciousAmounts(o.text).join('; ')}.</small>}</li>)}</ul>
        <button onClick={() => offer(new Blob([ocr.map(o => `--- Page ${o.n} ---\n${o.text}`).join('\n\n')], { type: 'text/plain' }), base + '_ocr.txt')}>Download reviewed text</button></>}
    </details>
    <details className="tool" key={'k' + route} open={open('compare-pdf')}><summary>Compare two PDFs</summary>
      <p className="empty">Compares the text of two files from your list, page by page.</p>
      {docs.length < 2 ? <p className="empty">Add at least two files.</p> : <><label>First file<select value={a} onChange={e => setA(+e.target.value)}>{docs.map((d, i) => <option key={d.id} value={i}>{d.name}</option>)}</select></label>
        <label>Second file<select value={b} onChange={e => setB(+e.target.value)}>{docs.map((d, i) => <option key={d.id} value={i}>{d.name}</option>)}</select></label><button disabled={!!work} onClick={compare}>Compare text</button></>}
      {cmp && <ul className="blank">{cmp.map((l, i) => <li key={i}><small>{l}</small></li>)}</ul>}
    </details></>)
}
