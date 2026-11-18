// Offline support. Caches only this site's own program files, never documents: documents are read from your disk and never pass through here.
const PREFIX = 'aps-static-'
self.addEventListener('install', e => e.waitUntil((async () => {
  const meta = await (await fetch('/precache.json', { cache: 'no-store' })).json(), c = await caches.open(PREFIX + meta.version)
  await c.addAll(['/', ...meta.files]); await self.skipWaiting()
})()))
self.addEventListener('activate', e => e.waitUntil((async () => {
  const keys = (await caches.keys()).filter(k => k.startsWith(PREFIX)).sort(), keep = keys.pop()
  await Promise.all(keys.map(k => caches.delete(k))); await self.clients.claim(); return keep
})()))
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url)
  if (r.method !== 'GET' || u.origin !== location.origin) return
  e.respondWith((async () => {
    const name = (await caches.keys()).filter(k => k.startsWith(PREFIX)).sort().pop(), cache = name ? await caches.open(name) : null
    if (r.mode === 'navigate') { try { return await fetch(r) } catch { return (await cache?.match('/')) ?? Response.error() } }
    const hit = await cache?.match(r); if (hit) return hit
    const res = await fetch(r); if (res.ok && cache && (u.pathname.startsWith('/tesseract/') || u.pathname.startsWith('/assets/'))) cache.put(r, res.clone()); return res
  })())
})
