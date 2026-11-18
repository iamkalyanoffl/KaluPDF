// Serves dist/ with the exact headers from vercel.json and the SPA fallback, to test CSP and routing before deploying.
import { createServer } from 'node:http'; import { readFileSync, existsSync, statSync } from 'node:fs'; import { extname, join } from 'node:path'
const cfg = JSON.parse(readFileSync('vercel.json', 'utf8')), hdr = Object.fromEntries(cfg.headers[0].headers.map(h => [h.key, h.value]))
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.gz': 'application/octet-stream' }
createServer((q, r) => { let f = join('dist', decodeURIComponent(q.url.split('?')[0])); if (!existsSync(f) || statSync(f).isDirectory()) f = 'dist/index.html'
  r.writeHead(200, { ...hdr, 'Content-Type': types[extname(f)] ?? 'application/octet-stream' }); r.end(readFileSync(f)) }).listen(+(process.env.PORT ?? 4174))
