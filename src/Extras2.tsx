import { useState } from 'react'
import type { Doc, Page, Mark } from './pdf'
import { KIND_LABEL, locatePage, type Kind, type Box } from './sensitive'
import { repairByRewrite, repairByImages } from './repair'
type Say = (k: 'ok' | 'warn' | 'err', t: string) => void
interface Found { id: number; pageId: string; pageNo: number; kind: Kind; text: string; box: Box }
export function FindRedact({ docs, pages, say, addMarks, toolId, route }: { docs: Doc[]; pages: Page[]; say: Say; addMarks(m: Record<string, Mark[]>): void; toolId?: string; route: string }) {
  const [kinds, setKinds] = useState<Kind[]>(['email', 'phone', 'pan', 'card']), [custom, setCustom] = useState(''), [found, setFound] = useState<Found[] | null>(null), [ticked, setTicked] = useState<Set<number>>(new Set()), [work, setWork] = useState<string | null>(null)
  async function find() {
    setFound(null); const out: Found[] = []; let noText = 0
    try {
      for (let i = 0; i < pages.length; i++) {
        setWork(`Looking at page ${i + 1} of ${pages.length}…`); const p = pages[i], pg = await docs.find(d => d.id === p.docId)!.js.getPage(p.src + 1), r = await locatePage(pg as never, p.rot, p.crop, kinds, custom.split(',').filter(x => x.trim()))
        if (!r.textItems) noText++; for (const h of r.hits) out.push({ id: out.length, pageId: p.id, pageNo: i + 1, kind: h.kind, text: h.text, box: h.box })
      }
      setFound(out); setTicked(new Set(out.map(o => o.id)))
      if (noText) say('warn', `${noText} page(s) have no selectable text, so nothing could be searched there. Run OCR first, then merge and search the result.`)
    } catch { say('err', 'The search failed on one of the pages. Nothing was changed.') } finally { setWork(null) }
  }
  function apply() {
    const by: Record<string, Mark[]> = {}; for (const f of found ?? []) if (ticked.has(f.id)) (by[f.pageId] ??= []).push({ id: crypto.randomUUID(), kind: 'redact', x: f.box.u, y: f.box.v, w: f.box.w, h: f.box.h })
    const n = Object.values(by).reduce((s, a) => s + a.length, 0); addMarks(by); setFound(null)
    say('ok', `${n} redaction box(es) added. Open any page to look at them or remove one. They take effect when you merge: those pages become images with the areas blacked out, and the result is checked for leftover text.`)
  }
  return (<details className="tool" key={'fr' + route} open={toolId === 'find-redact'}><summary>Find and redact personal data</summary>
    <p className="empty">Searches the text of your pages on this computer. You review every match before anything is added.</p>
    {work && <p role="status" className="msg warn">{work}</p>}
    {(Object.keys(KIND_LABEL) as Kind[]).filter(k => k !== 'custom').map(k => <label className="chk" key={k}><input type="checkbox" checked={kinds.includes(k)} onChange={e => setKinds(x => e.target.checked ? [...x, k] : x.filter(y => y !== k))} />{KIND_LABEL[k]}</label>)}
    <label>Your own words, separated by commas<input value={custom} onChange={e => { setCustom(e.target.value); setKinds(k => e.target.value.trim() ? (k.includes('custom') ? k : [...k, 'custom']) : k.filter(y => y !== 'custom')) }} /></label>
    <button disabled={!!work || !pages.length || !kinds.length} onClick={find}>Find matches</button>
    {found && (found.length ? <><ul className="blank">{found.map(f => <li key={f.id}><label className="chk"><input type="checkbox" checked={ticked.has(f.id)} onChange={e => setTicked(t => { const n = new Set(t); if (e.target.checked) n.add(f.id); else n.delete(f.id); return n })} />Page {f.pageNo}, {KIND_LABEL[f.kind].toLowerCase()}: <b>{f.text}</b></label></li>)}</ul>
      <button className="primary" disabled={!ticked.size} onClick={apply}>Add redaction boxes for {ticked.size} ticked match(es)</button></> : <p className="msg ok">No matches found in the selectable text.</p>)}
    <small>12-digit numbers are not checksum-checked, so ordinary references can match. Matching misses text split oddly or stored as pictures. Always look at the finished file.</small>
  </details>)
}
export function Repair({ say, offer, toolId, route }: { say: Say; offer(b: Blob, name: string): void; toolId?: string; route: string }) {
  const [work, setWork] = useState(false)
  async function go(f: File) {
    setWork(true)
    try {
      const bytes = new Uint8Array(await f.arrayBuffer()); let r = await repairByRewrite(bytes), method = 'rewrite'
      if (!r) { r = await repairByImages(bytes); method = 'images' }
      if (!r) return say('err', `${f.name} could not be repaired. It may be too damaged, password-protected, or not a PDF.`)
      offer(new Blob([r.bytes as BlobPart], { type: 'application/pdf' }), f.name.replace(/\.pdf$/i, '') + '_repaired.pdf')
      say(method === 'rewrite' ? 'ok' : 'warn', method === 'rewrite' ? `Repaired: ${r.pages} page(s) rewritten with a clean structure. Text and graphics are kept. Check every page, because damaged parts may be missing.` : `Partly repaired: ${r.pages} page(s) could be drawn and were rebuilt as pictures. Text is no longer selectable (use OCR) and pages that could not be drawn are missing. Check the page count against what you expect.`)
    } finally { setWork(false) }
  }
  return (<details className="tool" key={'rp' + route} open={toolId === 'repair-pdf'}><summary>Repair a damaged PDF</summary>
    <p className="empty">For files that will not open or fail to load here. The original is never changed.</p>
    <label className="lnk">{work ? 'Repairing…' : 'Choose a damaged PDF to repair'}<input type="file" accept=".pdf,application/pdf" hidden disabled={work} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) go(f) }} /></label>
  </details>)
}
