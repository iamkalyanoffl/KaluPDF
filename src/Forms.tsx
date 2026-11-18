import { useState } from 'react'
import type { Doc, TextRule } from './pdf'
import { verifySignatures, TRUST, type SigResult } from './verify'
type Fills = Record<string, Record<string, string | boolean>>
const STATUS = { intact: 'Intact: not changed since signing', invalid: 'INVALID: does not match the file', unreadable: 'Could not be read' }
export default function Forms({ docs, fills, setFills, rules, setRules, toolId, route }: { docs: Doc[]; fills: Fills; setFills: React.Dispatch<React.SetStateAction<Fills>>; rules: TextRule[]; setRules: React.Dispatch<React.SetStateAction<TextRule[]>>; toolId?: string; route: string }) {
  const [fnd, setFnd] = useState(''), [wth, setWth] = useState('')
  const withFields = docs.filter(d => d.fields?.length), flagged = docs.filter(d => d.flags.includes('a digital signature'))
  const [roots, setRoots] = useState<Uint8Array[]>([]), [res, setRes] = useState<Record<string, SigResult[]>>({}), [busy, setBusy] = useState<string | null>(null)
  const set = (id: string, name: string, v: string | boolean) => setFills(f => ({ ...f, [id]: { ...f[id], [name]: v } }))
  const check = async (d: Doc) => { setBusy(d.id); try { const r = await verifySignatures(d.bytes, roots); setRes(x => ({ ...x, [d.id]: r })) } finally { setBusy(null) } }
  return (<>
    <details className="tool" key={'f' + route} open={toolId === 'fill-form'}><summary>Fill form fields</summary>
      {!withFields.length && <p className="empty">None of your files has fillable fields.</p>}
      {withFields.map(d => <fieldset key={d.id} className="ff"><legend>{d.name}</legend>{d.fields.map(f => <label key={f.name} className={f.kind === 'checkbox' ? 'chk' : ''}>{f.name}
        {f.kind === 'text' && <input value={String(fills[d.id]?.[f.name] ?? '')} onChange={e => set(d.id, f.name, e.target.value)} />}
        {f.kind === 'checkbox' && <input type="checkbox" checked={!!fills[d.id]?.[f.name]} onChange={e => set(d.id, f.name, e.target.checked)} />}
        {f.kind === 'choice' && <select value={String(fills[d.id]?.[f.name] ?? '')} onChange={e => set(d.id, f.name, e.target.value)}><option value="">(leave as is)</option>{f.options!.map(o => <option key={o}>{o}</option>)}</select>}</label>)}</fieldset>)}
      {withFields.length > 0 && <small>Filled values appear in the merged file, not in the thumbnails. Form fields are flattened into the pages, so they cannot be edited afterwards. Use Latin letters and numbers only.</small>}
    </details>
    <details className="tool" key={'r' + route} open={toolId === 'replace-text'}><summary>Replace text (simple PDFs only)</summary>
      <p className="empty">Changes text inside the page content, for example a wrong amount. It only works when the PDF stores its text in a simple readable form. Most PDFs from Word or accounting software do not, and then the app says so and changes nothing. Applies when you merge. Latin letters and numbers only.</p>
      <div className="four"><label>Find<input value={fnd} onChange={e => setFnd(e.target.value)} /></label><label>Replace with<input value={wth} onChange={e => setWth(e.target.value)} /></label></div>
      <button disabled={!fnd} onClick={() => { setRules(r => [...r, { find: fnd, with: wth }]); setFnd(''); setWth('') }}>Add replacement</button>
      {rules.length > 0 && <ul className="blank">{rules.map((r, i) => <li key={i}><small>“{r.find}” becomes “{r.with}”</small> <button className="lnk" onClick={() => setRules(x => x.filter((_, j) => j !== i))}>Remove</button></li>)}</ul>}
      <small>Longer text can overlap its neighbours, and the original wording may stay in other parts of the file. After merging, check the page.</small>
    </details>
    <details className="tool" key={'g' + route} open={toolId === 'verify-signatures'}><summary>Check digital signatures</summary>
      <label className="lnk">Add a trusted root certificate (.cer, .crt, .pem) to check who the certificate chains to<input type="file" accept=".cer,.crt,.pem,.der" multiple hidden onChange={async e => { const fs = Array.from(e.target.files ?? []); setRoots(r => [...r, ...[]]); const bs = await Promise.all(fs.map(async f => new Uint8Array(await f.arrayBuffer()))); setRoots(r => [...r, ...bs]); e.target.value = '' }} /></label>
      {roots.length > 0 && <small>{roots.length} root certificate(s) in use. <button className="lnk" onClick={() => setRoots([])}>Remove</button></small>}
      {!flagged.length ? <p className="empty">None of your files appears to contain a digital signature.</p> : flagged.map(d => <div key={d.id} className="sg"><b>{d.name}</b> <button disabled={busy === d.id} onClick={() => check(d)}>{busy === d.id ? 'Checking…' : 'Check signatures'}</button>
        {res[d.id] && (res[d.id].length ? <ul className="blank">{res[d.id].map(s => <li key={s.index}><b className={s.status === 'intact' ? 'okt' : 'errt'}>Signature {s.index}: {STATUS[s.status]}</b><small>{s.detail}</small></li>)}</ul> : <small>No readable signature was found.</small>)}</div>)}
      <small>{TRUST} Merging, flattening or annotating a signed file breaks its signature; keep the original.</small>
    </details></>)
}
