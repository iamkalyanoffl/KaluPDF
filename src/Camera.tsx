import { useEffect, useRef, useState } from 'react'
import { enhanceGray, toGray, type Look } from './clean'
const MAX = 2200
function process(c: HTMLCanvasElement, look: Look | 'original') {
  if (look === 'original') return
  const x = c.getContext('2d', { willReadFrequently: true })!, im = x.getImageData(0, 0, c.width, c.height), g = enhanceGray(toGray(im.data), c.width, c.height, look)
  for (let i = 0, j = 0; i < g.length; i++, j += 4) { im.data[j] = im.data[j + 1] = im.data[j + 2] = g[i]; im.data[j + 3] = 255 } x.putImageData(im, 0, 0)
}
const toFile = (c: HTMLCanvasElement, name: string) => new Promise<File>((ok, no) => c.toBlob(b => b ? ok(new File([b], name, { type: 'image/jpeg' })) : no(new Error('Could not save the picture.')), 'image/jpeg', 0.9))
export default function Camera({ onFiles, toolId, route }: { onFiles(f: File[]): void; toolId?: string; route: string }) {
  const [look, setLook] = useState<Look | 'original'>('document'), [on, setOn] = useState(false), [shots, setShots] = useState<{ file: File; url: string }[]>([]), [err, setErr] = useState('')
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null), n = useRef(0)
  const stop = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setOn(false) }
  useEffect(() => stop, [])
  useEffect(() => { if (on && video.current && stream.current) { video.current.srcObject = stream.current; video.current.play().catch(() => {}) } }, [on])
  const keep = async (c: HTMLCanvasElement) => { process(c, look); const file = await toFile(c, `scan-${++n.current}.jpg`); setShots(s => [...s, { file, url: URL.createObjectURL(file) }]) }
  async function start() { setErr(''); try { stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false }); setOn(true) } catch { setErr('The camera could not be opened. Allow camera access for this site, or use the phone camera button below.') } }
  async function capture() { const v = video.current!; if (!v.videoWidth) return; const k = Math.min(1, MAX / Math.max(v.videoWidth, v.videoHeight)), c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k); c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height); await keep(c) }
  async function fromPhone(files: FileList) { for (const f of Array.from(files)) { try { const bm = await createImageBitmap(f), k = Math.min(1, MAX / Math.max(bm.width, bm.height)), c = document.createElement('canvas'); c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k); c.getContext('2d')!.drawImage(bm, 0, 0, c.width, c.height); await keep(c) } catch { setErr(`${f.name} could not be read as a picture.`) } } }
  const drop = (i: number) => setShots(s => { URL.revokeObjectURL(s[i].url); return s.filter((_, j) => j !== i) })
  const add = () => { onFiles(shots.map(s => s.file)); shots.forEach(s => URL.revokeObjectURL(s.url)); setShots([]); stop() }
  return (<details className="tool" key={'cam' + route} open={toolId === 'scan-camera'}><summary>Scan with your camera</summary>
    <p className="empty">Take a photo of each page. Lighting is evened out so it reads like a scan. The camera picture stays in this tab: nothing is recorded or sent anywhere, and the camera stops when you press Stop or add the scans.</p>
    <label>Look<select value={look} onChange={e => setLook(e.target.value as Look | 'original')}><option value="document">Document (grayscale, even light)</option><option value="bw">Black and white</option><option value="original">Original colours</option></select></label>
    {on ? <><video ref={video} playsInline muted className="cam" aria-label="Camera preview" /><div className="hr"><button className="primary" onClick={capture}>Capture page</button><button onClick={stop}>Stop camera</button></div></> : <div className="hr"><button onClick={start}>Start camera</button><label className="lnk">or use your phone's camera app<input type="file" accept="image/*" capture="environment" multiple hidden onChange={e => { if (e.target.files) fromPhone(e.target.files); e.target.value = '' }} /></label></div>}
    {err && <p className="msg err">{err}</p>}
    {shots.length > 0 && <><ul className="shots">{shots.map((s, i) => <li key={s.url}><img src={s.url} alt={`Scan ${i + 1}`} /><button className="lnk" onClick={() => drop(i)}>Remove</button></li>)}</ul><button className="primary" onClick={add}>Add {shots.length} scan(s) to the workspace</button></>}
  </details>)
}
