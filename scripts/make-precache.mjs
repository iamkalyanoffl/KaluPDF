// After the build: lists the program files the offline cache should hold. The OCR engine and language data are left out (large); they are cached the first time OCR is used.
import { readdirSync, statSync, writeFileSync } from 'node:fs'; import { createHash } from 'node:crypto'; import { join } from 'node:path'
const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])
const files = walk('dist').map(f => '/' + f.slice(5).split('\\').join('/')).filter(f => !f.startsWith('/tesseract/') && f !== '/sw.js' && f !== '/precache.json').sort()
const h = createHash('sha256'); for (const f of files) h.update(f + statSync('dist' + f).size)
writeFileSync('dist/precache.json', JSON.stringify({ version: Date.now() + '-' + h.digest('hex').slice(0, 8), files })); console.log(files.length, 'files listed for offline use')
