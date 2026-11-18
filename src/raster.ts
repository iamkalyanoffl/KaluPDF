import type { Doc, Page } from './pdf'
/** Renders one output page at 200 dpi with every redaction box burned in as solid black. The result has no text layer. */
export async function rasterizePage(doc: Doc, p: Page): Promise<{ bytes: Uint8Array; type: 'jpg'; w: number; h: number }> {
  const pg = await doc.js.getPage(p.src + 1), rot = (pg.rotate + p.rot) % 360, base = pg.getViewport({ scale: 1, rotation: rot }), [ct, cr, cb, cl] = p.crop ?? [0, 0, 0, 0]
  const w = base.width - cl - cr, h = base.height - ct - cb, sc = 200 / 72, vp = pg.getViewport({ scale: sc, rotation: rot, offsetX: -cl * sc, offsetY: -ct * sc })
  const c = document.createElement('canvas'); c.width = Math.ceil(w * sc); c.height = Math.ceil(h * sc)
  const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); await pg.render({ canvasContext: x, viewport: vp }).promise
  x.fillStyle = '#000'; for (const m of p.marks ?? []) if (m.kind === 'redact') x.fillRect(Math.floor(m.x * c.width), Math.floor(m.y * c.height), Math.ceil(m.w * c.width) + 1, Math.ceil(m.h * c.height) + 1)
  const blob = await new Promise<Blob>((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('Image encoding failed.')), 'image/jpeg', 0.9)); c.width = 0
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'jpg', w, h }
}
