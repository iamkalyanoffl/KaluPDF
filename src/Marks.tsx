import { useRef, useState } from 'react'
import type { Mark } from './pdf'
export type ToolId = 'view' | 'text' | 'highlight' | 'box' | 'cover' | 'redact' | 'sign' | 'ftext' | 'fcheck'
type Change = (f: (m: Mark[]) => Mark[], record?: boolean) => void
const urls = new Map<Uint8Array, string>()
const urlOf = (b: Uint8Array) => { let u = urls.get(b); if (!u) { u = URL.createObjectURL(new Blob([b as BlobPart])); urls.set(b, u) } return u }
export const revokeMarkUrls = () => { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear() }
const LABEL: Record<ToolId, string> = { view: 'Select and move', text: 'Text', highlight: 'Highlight', box: 'Box', cover: 'Cover', redact: 'Redact', sign: 'Signature', ftext: 'Form text box', fcheck: 'Form tick box' }
const HINT: Record<ToolId, string> = { view: 'Click a mark to select it, then drag to move it.', text: 'Drag a box where the text goes. The box height sets the text size.', highlight: 'Drag over the area to highlight.', box: 'Drag to draw a rectangle outline.', cover: 'Hides an area with white. The original text stays in the file underneath. To remove it for good, use Redact.', ftext: 'Drag to create a fillable text box. Give it a unique name below.', fcheck: 'Drag to create a fillable tick box. Give it a unique name below.',
  redact: 'Drag over anything to remove it permanently. When you merge, redacted pages are rebuilt as images with the area blacked out, then checked.', sign: 'Make a signature below, then drag a box where it should go.' }
export function MarkLayer({ marks, tool, sig, sel, setSel, dim, onChange }: { marks: Mark[]; tool: ToolId; sig: Uint8Array | null; sel: string | null; setSel(id: string | null): void; dim: { w: number; h: number }; onChange: Change }) {
  const ref = useRef<HTMLDivElement>(null), [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const st = useRef<{ id?: string; sx: number; sy: number; ox: number; oy: number } | null>(null)
  const pt = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) } }
  const down = (e: React.PointerEvent) => {
    const { x, y } = pt(e), id = (e.target as HTMLElement).dataset.id, m = marks.find(k => k.id === id); ref.current!.setPointerCapture(e.pointerId)
    if (tool === 'view') { setSel(id ?? null); if (m) { onChange(k => k, true); st.current = { id, sx: x, sy: y, ox: m.x, oy: m.y } } }
    else { st.current = { sx: x, sy: y, ox: 0, oy: 0 }; setDraft({ x, y, w: 0, h: 0 }) }
  }
  const move = (e: React.PointerEvent) => {
    const s = st.current; if (!s) return; const { x, y } = pt(e)
    if (s.id) onChange(ms => ms.map(m => m.id === s.id ? { ...m, x: Math.min(1 - m.w, Math.max(0, s.ox + x - s.sx)), y: Math.min(1 - m.h, Math.max(0, s.oy + y - s.sy)) } : m), false)
    else setDraft({ x: Math.min(s.sx, x), y: Math.min(s.sy, y), w: Math.abs(x - s.sx), h: Math.abs(y - s.sy) })
  }
  const up = () => {
    const d = draft; st.current = null; setDraft(null)
    if (!d || d.w < 0.01 || d.h < 0.01 || tool === 'view' || (tool === 'sign' && !sig)) return
    const m: Mark = { id: crypto.randomUUID(), kind: tool === 'sign' ? 'image' : tool, ...d, ...(tool === 'text' ? { text: 'Text' } : {}), ...(tool === 'ftext' || tool === 'fcheck' ? { text: 'field_' + Math.random().toString(36).slice(2, 6) } : {}), ...(tool === 'sign' ? { img: sig! } : {}) }
    onChange(ms => [...ms, m], true); setSel(m.id)
  }
  const all = [...marks, ...(draft && tool !== 'view' ? [{ id: '_d', kind: tool === 'sign' ? 'image' : tool, ...draft } as Mark] : [])]
  return <div ref={ref} className="layer" style={{ cursor: tool === 'view' ? 'default' : 'crosshair' }} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
    {all.map(m => <div key={m.id} data-id={m.id} className={`mk mk-${m.kind}${sel === m.id ? ' on' : ''}`} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%`, fontSize: m.h * dim.h * 0.7, fontStyle: m.ital ? 'italic' : undefined, fontFamily: m.ital ? 'Times, serif' : undefined }}>
      {(m.kind === 'text' || m.kind === 'ftext' || m.kind === 'fcheck') && m.text}{m.kind === 'image' && m.img && <img data-id={m.id} src={urlOf(m.img)} alt="Signature" draggable={false} />}</div>)}</div>
}
function SigPad({ sig, setSig }: { sig: Uint8Array | null; setSig(b: Uint8Array | null): void }) {
  const c = useRef<HTMLCanvasElement>(null), on = useRef(false)
  const pos = (e: React.PointerEvent) => { const r = c.current!.getBoundingClientRect(); return [(e.clientX - r.left) * 300 / r.width, (e.clientY - r.top) * 100 / r.height] }
  const g = () => { const x = c.current!.getContext('2d')!; x.lineWidth = 2.5; x.lineCap = 'round'; x.strokeStyle = '#111'; return x }
  return <div className="pad"><canvas ref={c} width={300} height={100} aria-label="Draw your signature" onPointerDown={e => { on.current = true; c.current!.setPointerCapture(e.pointerId); const [x, y] = pos(e), k = g(); k.beginPath(); k.moveTo(x, y) }} onPointerMove={e => { if (!on.current) return; const [x, y] = pos(e), k = g(); k.lineTo(x, y); k.stroke() }} onPointerUp={() => { on.current = false }} />
    <div className="hr"><button onClick={() => c.current!.getContext('2d')!.clearRect(0, 0, 300, 100)}>Clear pad</button><button className="primary" onClick={() => c.current!.toBlob(async b => { if (b) setSig(new Uint8Array(await b.arrayBuffer())) }, 'image/png')}>Use drawn signature</button>
      <label className="lnk">or upload a PNG/JPG<input type="file" accept="image/png,image/jpeg" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) setSig(new Uint8Array(await f.arrayBuffer())) }} /></label></div>
    <small>{sig ? 'Signature ready. Drag a box on the page to place it. ' : 'No signature yet. '}A drawn, typed or uploaded signature is only a visual mark. It is not a certificate-based digital signature and not a qualified electronic signature.</small></div>
}
export function Tools({ tool, setTool, sel, setSel, marks, sig, setSig, onChange }: { tool: ToolId; setTool(t: ToolId): void; sel: string | null; setSel(id: string | null): void; marks: Mark[]; sig: Uint8Array | null; setSig(b: Uint8Array | null): void; onChange: Change }) {
  const m = marks.find(k => k.id === sel), bad = m?.kind === 'text' && /[^\x20-\x7e\xa0-\xff]/.test(m.text ?? '')
  return <div className="tools2"><div className="hr" role="toolbar" aria-label="Page tools">{(Object.keys(LABEL) as ToolId[]).map(t => <button key={t} aria-pressed={tool === t} className={tool === t ? 'primary' : ''} onClick={() => setTool(t)}>{LABEL[t]}</button>)}</div>
    <small>{HINT[tool]}</small>
    {m && <div className="hr"><b>Selected: {m.kind === 'image' ? 'signature' : m.kind}</b>{(m.kind === 'ftext' || m.kind === 'fcheck') && <><input aria-label="Field name" value={m.text ?? ''} onChange={e => onChange(ms => ms.map(k => k.id === m.id ? { ...k, text: e.target.value } : k), false)} /><small>field name</small></>}{m.kind === 'text' && <><input aria-label="Text" value={m.text ?? ''} onChange={e => onChange(ms => ms.map(k => k.id === m.id ? { ...k, text: e.target.value } : k), false)} />
      <label className="chk"><input type="checkbox" checked={!!m.ital} onChange={e => onChange(ms => ms.map(k => k.id === m.id ? { ...k, ital: e.target.checked } : k), true)} />Signature style</label></>}
      <button onClick={() => { onChange(ms => ms.filter(k => k.id !== m.id), true); setSel(null) }}>Delete</button></div>}
    {bad && <small className="msg err">This text has characters the built-in font cannot show (for example the rupee sign). Merging will stop until they are removed.</small>}
    {tool === 'sign' && <SigPad sig={sig} setSig={setSig} />}</div>
}
