// Copies the OCR engine and English/Hindi/Tamil language data from node_modules into public/tesseract so everything is served from your own site.
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
const out = 'public/tesseract'; mkdirSync(out + '/core', { recursive: true }); mkdirSync(out + '/lang', { recursive: true })
cpSync('node_modules/tesseract.js/dist/worker.min.js', out + '/worker.min.js')
for (const f of readdirSync('node_modules/tesseract.js-core')) if (/^tesseract-core.*\.(js|wasm)$/.test(f)) cpSync('node_modules/tesseract.js-core/' + f, `${out}/core/${f}`)
for (const l of ['eng', 'hin', 'tam']) {
  const dir = `node_modules/@tesseract.js-data/${l}`, all = readdirSync(dir, { recursive: true }).map(String).filter(f => f.endsWith(`${l}.traineddata.gz`))
  const pick = all.find(f => f.includes('best_int')) ?? all[0]; if (!pick) throw new Error('Missing language data for ' + l)
  cpSync(`${dir}/${pick}`, `${out}/lang/${l}.traineddata.gz`)
}
