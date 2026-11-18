import { useEffect, useRef, useState } from 'react'
import { zipSync } from 'fflate'
import { toPdfFile } from './image'
import { loadFontBrowser } from './fonts'
import Extras from './Extras'
import Forms from './Forms'
import { FindRedact, Repair } from './Extras2'
import Camera from './Camera'
import { compressByRaster, compressToTarget, LIMITS, verdict, LEVELS, type Level } from './compress'
import { TOOLS, PLANNED, ACC, type Tool } from './tools'
import { scorePage, type BlankScore } from './blank'
import { rasterizePage } from './raster'
import { MarkLayer, Tools, revokeMarkUrls, type ToolId } from './Marks'
import { DEFAULT_NB, type Numbering, resolvePattern, type TextRule, pageTexts, foreignText, type MergeResult, type Mark, loadPdf, PasswordError, mergePages, parseRanges, sanitizeFilename, splitGroups, uid, type Doc, type Page } from './pdf'

type Msg = { kind: 'ok' | 'warn' | 'err'; text: string }
type WS = { docs: Doc[]; pages: Page[] }
const CATS = ['Sales invoice', 'Purchase invoice', 'Receipt', 'Bank statement', 'Payment voucher', 'Purchase order', 'Expense report', 'Tax document', 'Other']
const PRESETS: Record<string, { pat: string; order: string[] }> = {
  'Monthly Accounts': { pat: '{Month}_{Year}_Accounts', order: ['Bank statement', 'Sales invoice', 'Purchase invoice', 'Payment voucher', 'Receipt', 'Expense report', 'Tax document', 'Other'] },
  'Purchase Invoices': { pat: '{Month}_{Year}_Purchase_Invoices', order: ['Purchase order', 'Purchase invoice', 'Payment voucher', 'Other'] },
  'Sales Invoices': { pat: '{Month}_{Year}_Sales_Invoices', order: ['Sales invoice', 'Receipt', 'Other'] },
  'Bank Statements': { pat: '{Month}_{Year}_Bank_Statements', order: ['Bank statement', 'Other'] },
  'Expense Receipts': { pat: '{Month}_{Year}_Expenses', order: ['Expense report', 'Receipt', 'Other'] },
  'Tax Supporting Documents': { pat: '{Year}_Tax_Supporting_Documents', order: ['Tax document', 'Bank statement', 'Sales invoice', 'Purchase invoice', 'Other'] },
}
const fmt = (n: number) => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.ceil(n / 1e3) + ' KB'

function Thumb({ doc, p, n }: { doc: Doc; p: Page; n: number }) {
  const ref = useRef<HTMLCanvasElement>(null); const [seen, setSeen] = useState(false)
  useEffect(() => { const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: '300px' }); io.observe(ref.current!); return () => io.disconnect() }, [])
  useEffect(() => {
    if (!seen) return; let task: { cancel(): void; promise: Promise<unknown> } | undefined; let dead = false
    doc.js.getPage(p.src + 1).then(pg => {
      if (dead) return; const [ct, cr, cb, cl] = p.crop ?? [0, 0, 0, 0]; const sc = 150 / pg.getViewport({ scale: 1 }).width; const vp = pg.getViewport({ scale: sc, rotation: (pg.rotate + p.rot) % 360, offsetX: -cl * sc, offsetY: -ct * sc }); const c = ref.current!
      c.width = Math.max(1, vp.width - (cl + cr) * sc); c.height = Math.max(1, vp.height - (ct + cb) * sc); task = pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }); task.promise.catch(() => {})
    }).catch(() => {})
    return () => { dead = true; task?.cancel() }
  }, [seen, doc, p.src, p.rot, p.crop])
  return <canvas ref={ref} aria-label={`Output page ${n}`} />
}

function Preview({ doc, p, n, total, onNav, onClose, sig, setSig, onMarks }: { doc: Doc; p: Page; n: number; total: number; onNav: (d: number) => void; onClose: () => void; sig: Uint8Array | null; setSig(b: Uint8Array | null): void; onMarks: (f: (m: Mark[]) => Mark[], record?: boolean) => void }) {
  const [tool, setTool] = useState<ToolId>('view'); const [sel, setSel] = useState<string | null>(null); const [dim, setDim] = useState({ w: 1, h: 1 })
  const ref = useRef<HTMLCanvasElement>(null); const box = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1); const [fit, setFit] = useState<'width' | 'page' | 'manual'>('page'); const [err, setErr] = useState(false)
  useEffect(() => {
    let dead = false; let task: { cancel(): void; promise: Promise<unknown> } | undefined; setErr(false)
    doc.js.getPage(p.src + 1).then(pg => {
      if (dead) return; const rot = (pg.rotate + p.rot) % 360; const base = pg.getViewport({ scale: 1, rotation: rot }); const b = box.current!; const [ct, cr, cb, cl] = p.crop ?? [0, 0, 0, 0]; const bw = base.width - cl - cr, bh = base.height - ct - cb
      const sc = fit === 'width' ? (b.clientWidth - 24) / bw : fit === 'page' ? Math.min((b.clientWidth - 24) / bw, (b.clientHeight - 24) / bh) : zoom
      const vp = pg.getViewport({ scale: sc, rotation: rot, offsetX: -cl * sc, offsetY: -ct * sc }); const c = ref.current!; c.width = Math.max(1, vp.width - (cl + cr) * sc); c.height = Math.max(1, vp.height - (ct + cb) * sc); setDim({ w: c.width, h: c.height })
      task = pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }); task.promise.catch(() => {})
      if (fit !== 'manual') setZoom(sc)
    }).catch(() => setErr(true))
    return () => { dead = true; task?.cancel() }
  }, [doc, p.src, p.rot, p.crop, fit, zoom])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) && e.key !== 'Escape') return; if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') onNav(1); if (e.key === 'ArrowLeft') onNav(-1) }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) })
  return <div className="modal" role="dialog" aria-modal="true" aria-label="Page preview"><div className="mbar">
    <b>Output page {n} of {total}</b><span>{doc.name}, original page {p.src + 1}</span>
    <button onClick={() => onNav(-1)} disabled={n === 1}>Previous</button><button onClick={() => onNav(1)} disabled={n === total}>Next</button>
    <button onClick={() => { setFit('manual'); setZoom(z => z * 0.8) }}>Zoom out</button><button onClick={() => { setFit('manual'); setZoom(z => z * 1.25) }}>Zoom in</button>
    <button onClick={() => setFit('width')}>Fit width</button><button onClick={() => setFit('page')}>Fit page</button><button className="primary" autoFocus onClick={onClose}>Close</button></div>
    <Tools tool={tool} setTool={setTool} sel={sel} setSel={setSel} marks={p.marks ?? []} sig={sig} setSig={setSig} onChange={onMarks} />
    <div className="mbody" ref={box}>{err ? <p className="msg err">This page could not be displayed.</p> : <div className="stage"><canvas ref={ref} /><MarkLayer marks={p.marks ?? []} tool={tool} sig={sig} sel={sel} setSel={setSel} dim={dim} onChange={onMarks} /></div>}</div></div>
}

export default function App() {
  const [ws, setWs] = useState<WS>({ docs: [], pages: [] }); const { docs, pages } = ws
  const hist = useRef<{ past: WS[]; future: WS[] }>({ past: [], future: [] }); const seq = useRef<string[]>([]); const [, tick] = useState(0)
  const [cat, setCat] = useState<Record<string, string>>({}); const [sel, setSel] = useState<Set<string>>(new Set()); const [range, setRange] = useState('')
  const [pat, setPat] = useState('{Month}_{Year}_Accounts'); const [preset, setPreset] = useState('')
  const now = new Date(); const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [nb, setNb] = useState<Numbering>(DEFAULT_NB); const [sep, setSep] = useState(false); const [idx, setIdx] = useState(false); const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto'); const [help, setHelp] = useState(false); const [blank, setBlank] = useState<{ id: string; ratio: number; level: string }[] | null>(null); const [bsel, setBsel] = useState<Set<string>>(new Set()); const [scan, setScan] = useState<number | null>(null); const [smode, setSmode] = useState<'each' | 'ranges' | 'after'>('each'); const [sinp, setSinp] = useState(''); const [wm, setWm] = useState(''); const [prot, setProt] = useState(''); const [pwq, setPwq] = useState<{ file: File; wrong: boolean }[]>([]); const [pwv, setPwv] = useState(''); const [clevel, setClevel] = useState<Level>('balanced'); const [cgray, setCgray] = useState(false); const [target, setTarget] = useState(0); const [cok, setCok] = useState(false); const [cropv, setCropv] = useState(['0', '0', '0', '0']); const [title, setTitle] = useState(''); const [author, setAuthor] = useState(''); const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false); const [prog, setProg] = useState(0)
  const [done, setDone] = useState<{ url: string; name: string } | null>(null); const [dragId, setDragId] = useState<string | null>(null); const [view, setView] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const [route, setRoute] = useState(() => location.pathname); const [q, setQ] = useState('')
  const [recent, setRecent] = useState<string[]>(() => { try { return (JSON.parse(localStorage.getItem('aps.recent') || '[]') as unknown[]).filter((x): x is string => typeof x === 'string' && TOOLS.some(t => t.id === x)).slice(0, 4) } catch { return [] } })
  const tool = TOOLS.find(t => '/' + t.id === route), onHome = !tool
  const go = (p: string) => { history.pushState(null, '', p); setRoute(p); scrollTo(0, 0); const id = p.slice(1); if (TOOLS.some(t => t.id === id)) setRecent(r => { const n = [id, ...r.filter(x => x !== id)].slice(0, 4); try { localStorage.setItem('aps.recent', JSON.stringify(n)) } catch { /* ignore */ } return n }) }
  useEffect(() => { const f = () => setRoute(location.pathname); addEventListener('popstate', f); return () => removeEventListener('popstate', f) }, [])
  useEffect(() => { document.title = tool ? `${tool.name} · Accountant PDF Studio` : 'Accountant PDF Studio' }, [tool])
  useEffect(() => { if (theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme) }, [theme])
  const say = (kind: Msg['kind'], text: string) => setMsgs(m => [...m, { kind, text }])
  const dmap = new Map(docs.map(d => [d.id, d])); const rz = (p: Page) => rasterizePage(dmap.get(p.docId)!, p); const [sig, setSig] = useState<Uint8Array | null>(null); const [fills, setFills] = useState<Record<string, Record<string, string | boolean>>>({}); const [rules, setRules] = useState<TextRule[]>([])
  const drop = () => setDone(d => { if (d) URL.revokeObjectURL(d.url); return null })
  useEffect(() => () => { if (done) URL.revokeObjectURL(done.url) }, [done])
  const apply = (f: (w: WS) => WS) => { drop(); setWs(w => { hist.current.past = [...hist.current.past.slice(-49), w]; hist.current.future = []; return f(w) }); tick(x => x + 1) }
  const undo = () => { const h = hist.current; const prev = h.past.pop(); if (!prev) return; drop(); setWs(w => { h.future.push(w); return prev }); setSel(new Set()); tick(x => x + 1) }
  const redo = () => { const h = hist.current; const nx = h.future.pop(); if (!nx) return; drop(); setWs(w => { h.past.push(w); return nx }); setSel(new Set()); tick(x => x + 1) }
  const resolved = resolvePattern(pat, month)
  const fname = (() => { try { return sanitizeFilename(resolved) } catch { return '' } })()

  async function add(files: FileList | File[]) {
    setMsgs([]); setLoading(true)
    for (const f of Array.from(files)) {
      if (docs.some(d => d.name === f.name && d.size === f.size) && !confirm(`"${f.name}" is already in the list. Add it again?`)) continue
      try {
        const d = await loadPdf(await toPdfFile(f, loadFontBrowser)); seq.current.push(d.id)
        apply(w => ({ docs: [...w.docs, d], pages: [...w.pages, ...Array.from({ length: d.pageCount }, (_, i) => ({ id: uid(), docId: d.id, src: i, rot: 0 }))] }))
      } catch (e) { if (e instanceof PasswordError) setPwq(q => [...q, { file: f, wrong: false }]); else say('err', `${f.name}: ${(e as Error).message}${/damaged/.test((e as Error).message) ? ' You can try “Repair a damaged PDF” under More tools.' : ''}`) }
    }
    setLoading(false)
  }
  async function verifyRedactions(r: MergeResult) {
    if (!r.redacted.length) return
    const left = await foreignText(new Uint8Array(await r.blob.arrayBuffer()), r.redacted, prot || undefined)
    if (left > 0) throw new Error('Redaction check failed: extractable text was still found on a redacted page, so no file is offered.')
    say('ok', `Redaction verified: no extractable original text on ${r.redacted.length} redacted page(s). Those pages are now images. Your originals are unchanged.`)
  }
  async function verifyReplacements(r: MergeResult) {
    if (!rules.length) return
    const all = (await pageTexts(new Uint8Array(await r.blob.arrayBuffer()), prot || undefined)).join(' ')
    for (const x of rules) if (!all.includes(x.with) || (!x.with.includes(x.find) && all.includes(x.find))) throw new Error(`The replacement of "${x.find}" could not be confirmed in the finished file, so no file is offered.`)
  }
  async function openWithPw() {
    const item = pwq[0]; if (!item) return
    try {
      const d = await loadPdf(await toPdfFile(item.file, loadFontBrowser), pwv); seq.current.push(d.id)
      apply(w => ({ docs: [...w.docs, d], pages: [...w.pages, ...Array.from({ length: d.pageCount }, (_, i) => ({ id: uid(), docId: d.id, src: i, rot: 0 }))] })); setPwq(q => q.slice(1)); setPwv('')
      say('warn', `${d.name} was opened with your password. A merged file is NOT password-protected unless you set a password in step 3.`)
    } catch (e) { if (e instanceof PasswordError) setPwq(q => [{ ...q[0], wrong: true }, ...q.slice(1)]); else { say('err', `${item.file.name}: ${(e as Error).message}`); setPwq(q => q.slice(1)) } }
  }
  const regroup = (nd: Doc[], ps: Page[]) => nd.flatMap(d => ps.filter(p => p.docId === d.id))
  const moveDoc = (id: string, dir: -1 | 1) => apply(w => { const i = w.docs.findIndex(d => d.id === id), j = i + dir; if (j < 0 || j >= w.docs.length) return w; const nd = [...w.docs];[nd[i], nd[j]] = [nd[j], nd[i]]; return { docs: nd, pages: regroup(nd, w.pages) } })
  const removeDoc = (id: string) => { setSel(new Set()); apply(w => ({ docs: w.docs.filter(d => d.id !== id), pages: w.pages.filter(p => p.docId !== id) })) }
  const pg = (f: (p: Page[]) => Page[]) => apply(w => ({ ...w, pages: f(w.pages) }))
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const rotate = (d: number) => pg(p => p.map(x => sel.has(x.id) ? { ...x, rot: (x.rot + d + 360) % 360 } : x))
  const del = () => { pg(p => p.filter(x => !sel.has(x.id))); setSel(new Set()) }
  const dup = () => pg(p => p.flatMap(x => sel.has(x.id) ? [x, { ...x, id: uid() }] : [x]))
  const nudge = (dir: -1 | 1) => pg(p => { const a = [...p]; const idx = a.map((x, i) => sel.has(x.id) ? i : -1).filter(i => i >= 0); if (dir === -1) { for (const i of idx) if (i > 0 && !sel.has(a[i - 1].id)) [a[i - 1], a[i]] = [a[i], a[i - 1]] } else { for (const i of idx.reverse()) if (i < a.length - 1 && !sel.has(a[i + 1].id)) [a[i + 1], a[i]] = [a[i], a[i + 1]] } return a })
  const moveTo = (to: string) => { if (!dragId || dragId === to) return; const ids = sel.has(dragId) ? sel : new Set([dragId]); pg(p => { const mv = p.filter(x => ids.has(x.id)), rest = p.filter(x => !ids.has(x.id)); const at = rest.findIndex(x => x.id === to); rest.splice(at < 0 ? rest.length : at, 0, ...mv); return rest }) }
  const selectRange = () => { try { setSel(new Set(parseRanges(range, pages.length).map(n => pages[n - 1].id))); setMsgs([]) } catch (e) { say('err', (e as Error).message) } }
  const applyPreset = (name: string) => { setPreset(name); if (name) setPat(PRESETS[name].pat) }
  const sortByCategory = () => { const order = PRESETS[preset]?.order ?? CATS; const rank = (d: Doc) => { const r = order.indexOf(cat[d.id] ?? 'Other'); return r < 0 ? order.length : r }; apply(w => { const nd = [...w.docs].sort((a, b) => rank(a) - rank(b)); return { docs: nd, pages: regroup(nd, w.pages) } }) }
  function clearAll() {
    if (!confirm('Remove all files and pages from this workspace? This cannot be undone.')) return
    const all = new Set<Doc>([...docs, ...hist.current.past.flatMap(w => w.docs), ...hist.current.future.flatMap(w => w.docs)]); all.forEach(d => d.js.destroy())
    drop(); hist.current = { past: [], future: [] }; seq.current = []; setWs({ docs: [], pages: [] }); setCat({}); setSel(new Set()); setMsgs([]); setProg(0); setView(null); setSig(null); setFills({}); setRules([]); revokeMarkUrls()
  }
  async function merge() {
    setMsgs([]); drop(); if (!fname) return say('err', 'Enter a valid file name.')
    setBusy(true); setProg(0)
    try {
      const r = await mergePages(docs, pages, setProg, { rasterize: rz, fills, replace: rules, numbering: nb, separators: sep, watermark: wm.trim() || undefined, meta: { title, author }, protect: prot ? { userPassword: prot } : undefined, index: idx ? { types: cat } : undefined }); await verifyRedactions(r); await verifyReplacements(r); setDone({ url: URL.createObjectURL(r.blob), name: fname })
      say('ok', 'Validation passed: page count, order, sizes and rotation match your layout.'); if (prot) say('warn', 'The merged PDF is password-protected (AES-256). Keep the password safe: it cannot be recovered.')
      const srcSize = docs.filter(d => pages.some(p => p.docId === d.id)).reduce((t, d) => t + d.size, 0), pct = Math.round(Math.abs(1 - r.blob.size / srcSize) * 100)
      say(r.blob.size > srcSize ? 'warn' : 'ok', `Output ${fmt(r.blob.size)} from ${fmt(srcSize)} of source files (${r.blob.size > srcSize ? pct + '% larger' : pct + '% smaller'}). Your original files are unchanged.`); r.warnings.forEach(w => say('warn', w))
    } catch (e) { say('err', (e as Error).message) } finally { setBusy(false) }
  }
  async function findBlank() {
    setMsgs([]); setBlank(null); setBsel(new Set()); const found: { id: string; ratio: number; level: string }[] = []; const cache = new Map<string, BlankScore>()
    try {
      for (let i = 0; i < pages.length; i++) {
        setScan(i + 1); const p = pages[i], k = p.docId + ':' + p.src; let r = cache.get(k)
        if (!r) { r = await scorePage(dmap.get(p.docId)!, p.src); cache.set(k, r) }
        if (r.level !== 'content') found.push({ id: p.id, ratio: r.ratio, level: r.level })
      }
      setBlank(found)
    } catch { say('err', 'Scanning failed for one of the pages. Nothing was changed.') } finally { setScan(null) }
  }
  const removeBlank = () => { const n = bsel.size; pg(p => p.filter(x => !bsel.has(x.id))); setBlank(null); setBsel(new Set()); setSel(new Set()); say('ok', `${n} page(s) removed from the output. Your original files are untouched. Undo restores them.`) }
  async function split() {
    setMsgs([]); drop(); setBusy(true); setProg(0)
    try {
      if (rules.length) throw new Error('Text replacement applies to Merge only. Remove the replacements first.')
      const groups = splitGroups(smode, sinp, pages.length), base = (fname || 'Split').replace(/\.pdf$/i, ''), files: Record<string, Uint8Array> = {}
      for (let g = 0; g < groups.length; g++) {
        const r = await mergePages(docs, groups[g].map(n => pages[n - 1]), undefined, { rasterize: rz, fills }); await verifyRedactions(r)
        files[`${base}_part${String(g + 1).padStart(2, '0')}.pdf`] = new Uint8Array(await r.blob.arrayBuffer()); setProg(g + 1)
      }
      setDone({ url: URL.createObjectURL(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' })), name: base + '_split.zip' })
      say('ok', `${groups.length} PDF file(s) created from your current page list. Each was validated.`)
    } catch (e) { say('err', (e as Error).message) } finally { setBusy(false) }
  }
  async function extract() {
    setMsgs([]); drop(); setBusy(true); setProg(0)
    try {
      if (rules.length) throw new Error('Text replacement applies to Merge only. Remove the replacements first.')
      const chosen = pages.filter(p => sel.has(p.id)), r = await mergePages(docs, chosen, setProg, { rasterize: rz, fills, meta: { title, author } }); await verifyRedactions(r)
      setDone({ url: URL.createObjectURL(r.blob), name: (fname || 'Extract').replace(/\.pdf$/i, '') + '_extract.pdf' }); say('ok', `${chosen.length} selected page(s) saved as a new PDF and validated. Your page list is unchanged.`)
    } catch (e) { say('err', (e as Error).message) } finally { setBusy(false) }
  }
  const mm = (v: string) => Math.max(0, parseFloat(v) || 0) * 72 / 25.4
  const applyCrop = (clear: boolean) => {
    const target = sel.size ? sel : new Set(pages.map(p => p.id)), m = cropv.map(mm) as [number, number, number, number]
    if (!clear && m.every(v => v === 0)) return say('err', 'Enter at least one margin to trim, in millimetres.')
    pg(p => p.map(x => target.has(x.id) ? { ...x, crop: clear ? undefined : m } : x)); setMsgs([])
    say(clear ? 'ok' : 'warn', clear ? `Crop removed from ${target.size} page(s).` : `Crop applied to ${target.size} page(s). Cropping hides content outside the new edges but does not erase it, so do not use it to hide confidential information.`)
  }
  async function compress() {
    setMsgs([]); drop(); setBusy(true); setProg(0)
    try {
      if (pages.some(p => p.marks?.length) || Object.keys(fills).length || rules.length) throw new Error('Compress does not apply your annotations, redactions, form entries or text replacements. Merge first, then compress the merged file.')
      if (target) {
        const r = await compressToTarget(docs, pages, target, cgray, setProg)
        if (!r.blob) throw new Error(`Could not get under ${fmt(target)}. Even the softest setting gives about ${fmt(r.smallest)}. Try splitting the file, removing pages, or a larger limit. Nothing was changed.`)
        setDone({ url: URL.createObjectURL(r.blob), name: (fname || 'Compressed').replace(/\.pdf$/i, '') + '_compressed.pdf' })
        say('ok', `Compressed to ${fmt(r.blob.size)} (limit ${fmt(target)}) at ${r.used!.dpi} dpi, quality ${Math.round(r.used!.q * 100)}%, ${pages.length} pages, validated. Text is no longer selectable and forms and signatures are not kept. Your originals are unchanged.`); return
      }
      const blob = await compressByRaster(docs, pages, clevel, cgray, setProg), src = docs.filter(d => pages.some(p => p.docId === d.id)).reduce((t, d) => t + d.size, 0), v = verdict(src, blob.size)
      if (!v.ok) say('warn', `Compression made the file ${v.pct}% larger (${fmt(blob.size)} against ${fmt(src)}), so no download is offered. Keep your original or try a stronger level. Text-based PDFs usually do not shrink this way.`)
      else { setDone({ url: URL.createObjectURL(blob), name: (fname || 'Compressed').replace(/\.pdf$/i, '') + '_compressed.pdf' }); say('ok', `Compressed from ${fmt(src)} to ${fmt(blob.size)} (${v.pct}% smaller), ${pages.length} pages, validated. Text is no longer selectable and forms and signatures are not kept. Your originals are unchanged.`) }
    } catch (e) { say('err', (e as Error).message) } finally { setBusy(false) }
  }
  const upd = (p: Partial<Numbering>) => { setNb(n => ({ ...n, ...p })); drop() }
  const sortName = (dir: 1 | -1) => apply(w => { const nd = [...w.docs].sort((a, b) => dir * a.name.localeCompare(b.name, undefined, { numeric: true })); return { docs: nd, pages: regroup(nd, w.pages) } })
  const keys = new Set(pages.map(p => p.docId + ':' + p.src)); const total = docs.reduce((s, d) => s + d.pageCount, 0)
  const rank = (p: Page) => seq.current.indexOf(p.docId) * 1e6 + p.src
  const reordered = pages.some((p, i) => i > 0 && rank(pages[i - 1]) > rank(p)); const rotated = pages.filter(p => p.rot).length
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || view !== null || help) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === 'z') { e.preventDefault(); undo() } else if (mod && (e.key === 'y' || e.key === 'Z')) { e.preventDefault(); redo() }
      else if (mod && e.key === 'a') { e.preventDefault(); setSel(new Set(pages.map(p => p.id))) }
      else if (e.key === 'Delete' && sel.size) del(); else if (e.key === 'r' && sel.size) rotate(90); else if (e.key === 'R' && sel.size) rotate(-90); else if (e.key === 'Escape') setSel(new Set())
    }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  })
  const startPreset = (a: typeof ACC[number]) => { setPreset(a.preset); setPat(PRESETS[a.preset].pat); setIdx(a.index); go('/' + a.to) }
  const filt = TOOLS.filter(t => (t.name + ' ' + t.blurb + ' ' + t.cat).toLowerCase().includes(q.trim().toLowerCase()))
  const card = (t: Tool) => <li key={t.id}><button className="card" onClick={() => go('/' + t.id)}><b>{t.name}</b><span>{t.blurb}</span></button></li>
  const home = (<section className="home" aria-label="All tools">
    <h2 className="hero">Your PDF tools. Your documents stay on this computer.</h2>
    <input className="search" type="search" aria-label="Search tools" placeholder="Search tools: merge, split, blank, image, watermark…" value={q} onChange={e => setQ(e.target.value)} />
    <div className="quick" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) { go('/merge-pdf'); add(e.dataTransfer.files) } }}>
      <div><b>Quick start</b><span>Drop files anywhere in this box to start a merge, or choose them.</span></div><button className="primary" onClick={() => { go('/merge-pdf'); input.current?.click() }}>Choose files</button></div>
    {!q && <><h3>Accounting essentials</h3><ul className="cards">{ACC.map(a => <li key={a.name}><button className="card acc" onClick={() => startPreset(a)}><b>{a.name}</b><span>{a.blurb}</span></button></li>)}</ul></>}
    {!q && recent.length > 0 && <><h3>Recently used</h3><ul className="cards">{recent.map(id => TOOLS.find(t => t.id === id)).filter((t): t is Tool => !!t).map(card)}</ul>
      <small>Saved on this device: only the names of tools you opened, never documents. <button className="lnk" onClick={() => { setRecent([]); try { localStorage.removeItem('aps.recent') } catch { /* ignore */ } }}>Forget</button></small></>}
    {(['Organize', 'Convert', 'Edit', 'Optimize', 'Security'] as const).map(c => filt.some(t => t.cat === c) && <div key={c}><h3>{c}</h3><ul className="cards">{filt.filter(t => t.cat === c).map(card)}</ul></div>)}
    {!filt.length && <p className="empty">No working tool matches “{q}”. See the list of tools not built yet below.</p>}
    <details className="tool"><summary>Not built yet</summary><p className="empty">These are planned. They are listed so you know what is missing, and they do nothing today.</p><ul className="chips">{PLANNED.map(x => <li key={x}>{x}</li>)}</ul></details>
  </section>)
  const vp = view !== null ? pages[view] : null

  return (<>
    <header className="top"><div className="brand"><svg width="28" height="28" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="6" fill="currentColor"/><path d="M9 8h10l4 4v12H9z" fill="none" stroke="var(--paper)" strokeWidth="2"/></svg>
      <div><h1>Accountant PDF Studio</h1><p>Private PDF merging and document organization</p></div></div>
      <div className="hr"><span className="priv" role="note">Files are processed in this browser only. Nothing is uploaded.</span><button onClick={() => go('/')}>All tools</button><button onClick={() => setTheme(t => t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto')}>Theme: {theme}</button><button onClick={() => setHelp(true)}>Help and shortcuts</button></div></header>
    {onHome && home}
    <main hidden={onHome}>
      <section aria-label="Files and merge settings" className="side">
        {tool && <div className="banner"><div><b>{tool.name}</b><span>{tool.blurb}</span></div><button onClick={() => go('/')}>All tools</button></div>}
        <div className="drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) add(e.dataTransfer.files) }}>
          <p><b>1. Add your files</b><br />PDFs, photos or scans, and text-only Word, Excel, CSV and PowerPoint files. Drop them here or choose them.</p><button className="primary" onClick={() => input.current?.click()}>Browse files</button>
          <input ref={input} type="file" accept="application/pdf,.pdf,.jpg,.jpeg,.png,.webp,.bmp,.gif,.txt,.docx,.xlsx,.csv,.pptx" multiple hidden onChange={e => { if (e.target.files) add(e.target.files); e.target.value = '' }} />
          {loading && <p role="status">Reading files…</p>}
        </div>
        {pwq[0] && <div className="pw" role="alertdialog" aria-label="Password needed"><b>{pwq[0].file.name} is password-protected</b>
          <small>Enter the password to open it here. It stays in this browser tab and is never sent anywhere.</small>
          <input type="password" autoFocus autoComplete="off" aria-label="PDF password" value={pwv} onChange={e => setPwv(e.target.value)} onKeyDown={e => e.key === 'Enter' && openWithPw()} />
          {pwq[0].wrong && <p className="msg err">That password is not correct.</p>}
          <div className="hr"><button className="primary" onClick={openWithPw}>Open file</button><button onClick={() => { setPwq(q => q.slice(1)); setPwv('') }}>Skip this file</button></div></div>}
        <h2>2. Order your files</h2>
        {!docs.length && <p className="empty">Nothing added yet. Statements, invoices, vouchers and receipts can all be combined here.</p>}
        <ol className="files">{docs.map((d, i) => <li key={d.id}><b>{i + 1}. {d.name}</b><small>{d.pageCount} pages, {fmt(d.size)}</small>{d.flags.length > 0 && <small className="msg warn">Contains {d.flags.join(', ')}. May not survive merging.</small>}
          <select aria-label={`Document type for ${d.name}`} value={cat[d.id] ?? 'Other'} onChange={e => setCat(c => ({ ...c, [d.id]: e.target.value }))}>{CATS.map(c => <option key={c}>{c}</option>)}</select>
          <div><button aria-label={`Move ${d.name} up`} disabled={i === 0} onClick={() => moveDoc(d.id, -1)}>Up</button><button aria-label={`Move ${d.name} down`} disabled={i === docs.length - 1} onClick={() => moveDoc(d.id, 1)}>Down</button>
            <button aria-label={`Remove ${d.name}`} onClick={() => removeDoc(d.id)}>Remove</button></div></li>)}</ol>
        {docs.length > 1 && <div className="hr"><button onClick={() => sortName(1)}>Sort A to Z</button><button onClick={() => sortName(-1)}>Sort Z to A</button></div>}
        {docs.length > 1 && <button onClick={sortByCategory} title="Orders files by the document types you chose. Nothing is guessed from file contents.">Order files by document type</button>}
        <h2>3. Name and merge</h2>
        <label>File name<input value={pat} onChange={e => setPat(e.target.value)} /></label><small>Saves as <b>{fname || 'a valid name is needed'}</b>. {'{Month}'} and {'{Year}'} are filled from the month in More options.</small>
        <details className="tool" key={'opt' + route} open={['add-page-numbers', 'bates-numbering', 'watermark-pdf', 'clean-metadata', 'protect-pdf'].includes(tool?.id ?? '')}><summary>More options</summary>
          <label>Preset (this session only)<select value={preset} onChange={e => applyPreset(e.target.value)}><option value="">Custom</option>{Object.keys(PRESETS).map(k => <option key={k}>{k}</option>)}</select></label>
          <label>Accounting month<input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>
          <label>Page numbers<select value={nb.style} onChange={e => upd({ style: e.target.value as Numbering['style'] })}><option value="none">None</option><option value="n">1</option><option value="n of N">1 of N</option><option value="Page n">Page 1</option><option value="Page n of N">Page 1 of N</option><option value="bates">Bates number (prefix + digits)</option></select></label>
          {nb.style !== 'none' && <><label>Position<select value={nb.pos} onChange={e => upd({ pos: e.target.value as Numbering['pos'] })}>{([['bc', 'Bottom centre'], ['br', 'Bottom right'], ['bl', 'Bottom left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['tl', 'Top left']] as const).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <div className="four"><label>Start at<input type="number" min={0} value={nb.start} onChange={e => upd({ start: Math.max(0, Number(e.target.value) || 0) })} /></label><label>Leave first pages unnumbered<input type="number" min={0} value={nb.skip} onChange={e => upd({ skip: Math.max(0, Number(e.target.value) || 0) })} /></label></div>
            {nb.style === 'bates' && <div className="four"><label>Prefix<input value={nb.prefix} onChange={e => upd({ prefix: e.target.value })} /></label><label>Digits<input type="number" min={1} max={12} value={nb.digits} onChange={e => upd({ digits: Math.min(12, Math.max(1, Number(e.target.value) || 6)) })} /></label></div>}</>}
          <div className="four"><label>Header text<input value={nb.header} onChange={e => upd({ header: e.target.value })} /></label><label>Footer text<input value={nb.footer} onChange={e => upd({ footer: e.target.value })} /></label></div>
          <label className="chk"><input type="checkbox" checked={idx} onChange={e => { setIdx(e.target.checked); drop() }} />Add an index page listing each document and its pages</label>
          <label className="chk"><input type="checkbox" checked={sep} onChange={e => { setSep(e.target.checked); drop() }} />Insert a blank page between documents</label>
          <label>Watermark text<input value={wm} placeholder="e.g. CONFIDENTIAL, PAID, COPY" onChange={e => { setWm(e.target.value); drop() }} /></label>
          <label>Password to open the merged PDF<input type="password" autoComplete="new-password" value={prot} onChange={e => { setProt(e.target.value); drop() }} /></label>
          <label>Document title<input value={title} onChange={e => { setTitle(e.target.value); drop() }} /></label>
          <label>Author<input value={author} onChange={e => { setAuthor(e.target.value); drop() }} /></label><small>Producer and creator details are always cleared.</small>
        </details>
        <button className="primary" disabled={busy || loading || !pages.length} onClick={merge}>{busy ? `Working… (${prog})` : 'Merge and check'}</button>
        {done && <a className="primary dl" href={done.url} download={done.name}>Download {done.name}</a>}
        <div role="status" aria-live="polite">{msgs.map((x, i) => <p key={i} className={'msg ' + x.kind}>{x.text}</p>)}</div>
        {pages.length > 0 && <p className="sumline">{docs.length} file(s) to {pages.length} page(s){total - keys.size ? ` · ${total - keys.size} removed` : ''}{pages.length - keys.size ? ` · ${pages.length - keys.size} duplicated` : ''}{rotated ? ` · ${rotated} rotated` : ''}{pages.some(p => p.crop) ? ' · cropped' : ''}{reordered ? ' · reordered' : ''}{done ? ' · checked' : ''}</p>}
        <details className="more" key={'adv' + route} open={['split-pdf', 'blank-pages', 'crop-pdf', 'compress-pdf', 'fill-form', 'find-redact', 'repair-pdf', 'scan-camera', 'replace-text', 'verify-signatures', 'extract-text', 'ocr-pdf', 'searchable-pdf', 'compare-pdf'].includes(tool?.id ?? '')}><summary>More tools: split, blank pages, crop, compress, forms, OCR, signatures, compare</summary>
        <details className="tool" key={'b' + route} open={tool?.id === 'blank-pages'}><summary>Find blank pages (optional)</summary>
          <p className="empty">Checks every page on this computer, including scans with no text. Nothing is removed until you tick pages and confirm.</p>
          <button disabled={!pages.length || busy || scan !== null} onClick={findBlank}>{scan !== null ? `Checking page ${scan} of ${pages.length}…` : 'Find blank pages'}</button>
          {blank && blank.filter(b => pages.some(p => p.id === b.id)).length === 0 && <p className="msg ok">No blank or nearly blank pages found.</p>}
          {blank && <ul className="blank">{blank.filter(b => pages.some(p => p.id === b.id)).map(b => { const i = pages.findIndex(p => p.id === b.id); return <li key={b.id}>
            <label className="chk"><input type="checkbox" checked={bsel.has(b.id)} onChange={() => setBsel(t => { const n = new Set(t); n.has(b.id) ? n.delete(b.id) : n.add(b.id); return n })} />Page {i + 1}, {dmap.get(pages[i].docId)?.name}</label>
            <small>{b.level === 'blank' ? 'Looks empty' : 'Nearly empty. Please check it, it may hold a small amount'} (ink {(b.ratio * 100).toFixed(2)}%)</small> <button className="lnk" onClick={() => setView(i)}>Enlarge</button></li> })}</ul>}
          {blank && bsel.size > 0 && <button onClick={removeBlank}>Remove {bsel.size} ticked page(s)</button>}
        </details>
        <details className="tool" key={'s' + route} open={tool?.id === 'split-pdf'}><summary>Split into separate PDFs</summary>
          <p className="empty">Splits your current page list (after any reordering, rotation or removal) and downloads a ZIP.</p>
          <label>How to split<select value={smode} onChange={e => setSmode(e.target.value as typeof smode)}><option value="each">Every page as its own file</option><option value="ranges">By ranges, one file per range</option><option value="after">After these page numbers</option></select></label>
          {smode !== 'each' && <label>{smode === 'ranges' ? 'Ranges, e.g. 1-3, 4-6, 7' : 'Cut after pages, e.g. 3, 6'}<input value={sinp} onChange={e => setSinp(e.target.value)} /></label>}
          <button disabled={busy || loading || !pages.length} onClick={split}>Split and prepare ZIP</button>
        </details>
        <details className="tool" key={'c' + route} open={tool?.id === 'crop-pdf'}><summary>Crop pages</summary>
          <p className="empty">Trim margins in millimetres from the {sel.size ? `${sel.size} selected` : 'all'} page(s). The thumbnails and enlarged view show the result.</p>
          <div className="four">{['Top', 'Right', 'Bottom', 'Left'].map((n, i) => <label key={n}>{n}<input inputMode="decimal" value={cropv[i]} onChange={e => setCropv(c => c.map((v, j) => j === i ? e.target.value : v))} /></label>)}</div>
          <button disabled={!pages.length} onClick={() => applyCrop(false)}>Apply crop</button><button disabled={!pages.length} onClick={() => applyCrop(true)}>Remove crop</button>
        </details>
        <details className="tool" key={'z' + route} open={tool?.id === 'compress-pdf'}><summary>Compress scanned PDFs</summary>
          <p className="empty">This re-renders every page as an image. It suits scans. Text-based PDFs usually get larger, and then nothing is offered for download.</p>
          <label>Target size<select value={target} onChange={e => setTarget(Number(e.target.value))}><option value={0}>Use the strength below</option>{LIMITS.map(l => <option key={l} value={l}>Under {fmt(l)}</option>)}</select></label>
          <label>Strength<select value={clevel} onChange={e => setClevel(e.target.value as Level)}>{(Object.keys(LEVELS) as Level[]).map(k => <option key={k} value={k}>{LEVELS[k].label} ({LEVELS[k].dpi} dpi)</option>)}</select></label>
          <label className="chk"><input type="checkbox" checked={cgray} onChange={e => setCgray(e.target.checked)} />Convert to grayscale for a smaller file</label>
          <label className="chk"><input type="checkbox" checked={cok} onChange={e => setCok(e.target.checked)} />I understand text will no longer be selectable or searchable, and forms and signatures will be lost</label>
          <button disabled={busy || loading || !pages.length || !cok} onClick={compress}>{busy ? `Working… (${prog})` : target ? `Compress to under ${fmt(target)}` : 'Compress and measure'}</button>
        </details>
        <Camera onFiles={fs => { add(fs) }} toolId={tool?.id} route={route} />
        <FindRedact docs={docs} pages={pages} say={say} toolId={tool?.id} route={route} addMarks={by => apply(w => ({ ...w, pages: w.pages.map(p => by[p.id] ? { ...p, marks: [...(p.marks ?? []), ...by[p.id]] } : p) }))} />
        <Repair say={say} toolId={tool?.id} route={route} offer={(blob, name) => { drop(); setDone({ url: URL.createObjectURL(blob), name }) }} />
        <Forms docs={docs} fills={fills} setFills={setFills} rules={rules} setRules={setRules} toolId={tool?.id} route={route} />
        <Extras edited={pages.some(p => p.marks?.length) || Object.keys(fills).length > 0} redacted={pages.some(p => p.marks?.some(m => m.kind === 'redact'))} docs={docs} pages={pages} toolId={tool?.id} route={route} say={say} base={(fname || 'Document').replace(/\.pdf$/i, '')} offer={(blob, name) => { drop(); setDone({ url: URL.createObjectURL(blob), name }) }} />
        </details>
        <button onClick={clearAll} disabled={!docs.length}>Clear everything</button>
      </section>
      <section aria-label="Pages" className="pages">
        <div className="bar"><b>{pages.length} pages</b><button onClick={undo} disabled={!hist.current.past.length}>Undo</button><button onClick={redo} disabled={!hist.current.future.length}>Redo</button>
          <button onClick={() => setSel(new Set(pages.map(p => p.id)))}>Select all</button><button onClick={() => setSel(new Set())}>Clear selection</button>
          <input aria-label="Page ranges to select" placeholder="Select pages: 1-3, 5, 8-10" value={range} onChange={e => setRange(e.target.value)} onKeyDown={e => e.key === 'Enter' && selectRange()} /><button onClick={selectRange}>Select</button></div>
        {sel.size > 0 && <div className="bar"><span>{sel.size} selected</span>
          <button disabled={!sel.size} onClick={() => nudge(-1)}>Move earlier</button><button disabled={!sel.size} onClick={() => nudge(1)}>Move later</button>
          <button disabled={!sel.size} onClick={() => rotate(-90)}>Rotate left</button><button disabled={!sel.size} onClick={() => rotate(90)}>Rotate right</button>
          <button disabled={!sel.size} onClick={dup}>Duplicate</button><button disabled={!sel.size} onClick={del}>Remove</button><button disabled={!sel.size || busy} onClick={extract}>Extract selected to new PDF</button></div>}
        {!pages.length && <p className="empty">Your pages appear here. Click a page to select it, double-click to enlarge, or drag to reorder.</p>}
        <ul className="grid">{pages.map((p, i) => { const d = dmap.get(p.docId)!; return (
          <li key={p.id} draggable onDragStart={() => setDragId(p.id)} onDragOver={e => e.preventDefault()} onDrop={() => moveTo(p.id)} onDragEnd={() => setDragId(null)} className={sel.has(p.id) ? 'sel' : ''}>
            <button className="cell" aria-pressed={sel.has(p.id)} onClick={() => toggle(p.id)} onDoubleClick={() => setView(i)}><Thumb doc={d} p={p} n={i + 1} /></button>
            <small>Page {i + 1}<br />{d.name}, original p.{p.src + 1}{p.rot ? `, rotated ${p.rot}°` : ''}{p.marks?.length ? `, ${p.marks.length} mark(s)` : ''}</small>
            <button className="lnk" onClick={() => setView(i)}>Enlarge</button></li>) })}</ul>
      </section>
    </main>
    {vp && <Preview doc={dmap.get(vp.docId)!} p={vp} n={view! + 1} total={pages.length} onNav={d => setView(v => Math.min(pages.length - 1, Math.max(0, (v ?? 0) + d)))} onClose={() => setView(null)} sig={sig} setSig={setSig} onMarks={(f, rec = true) => { const upd = (ps: Page[]) => ps.map(x => x.id === vp.id ? { ...x, marks: f(x.marks ?? []) } : x); if (rec) pg(upd); else { drop(); setWs(w => ({ ...w, pages: upd(w.pages) })) } }} />}
    {help && <div className="modal" role="dialog" aria-modal="true" aria-label="Help and shortcuts"><div className="mbar"><b>Help and shortcuts</b><button className="primary" autoFocus onClick={() => setHelp(false)}>Close</button></div>
      <div className="mbody help"><div><h2>How to use</h2><ol><li>Add your PDFs.</li><li>Put the files in order. Set each file’s document type if you want to order by type.</li><li>Click a page to select it. Double-click to enlarge. Drag, or use Move earlier and Move later, to reorder.</li><li>Choose a preset and month for the file name, then click Merge and check.</li><li>Download once validation shows as passed, and open the file to check it before filing.</li></ol>
      <h2>Keyboard shortcuts</h2><ul><li>Ctrl or Cmd + Z: undo. Ctrl or Cmd + Y: redo</li><li>Ctrl or Cmd + A: select all pages</li><li>R: rotate right. Shift + R: rotate left</li><li>Delete: remove selected pages. Esc: clear selection</li><li>In the enlarged view: left and right arrows change page, Esc closes</li></ul>
      <h2>Privacy</h2><p>Your files never leave this browser tab. Closing or reloading discards your work. Use Clear everything when you finish on a shared computer.</p></div></div></div>}
    <footer>Version 1.9 · Processing happens locally; closing or reloading the tab discards your work, and browsers cannot guarantee immediate erasure from device memory. Local processing does not protect against malware or malicious browser extensions. Signed documents will lose their signatures when merged. Forms, bookmarks and attachments may not carry over. Verify the final PDF before filing it.</footer>
  </>)
}
