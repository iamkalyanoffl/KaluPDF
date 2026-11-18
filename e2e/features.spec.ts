import { test, expect } from '@playwright/test'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { readFile } from 'node:fs/promises'
import * as pjs from 'pdfjs-dist/legacy/build/pdf.mjs'
const pdf = async (text?: string) => { const d = await PDFDocument.create(), p = d.addPage([595, 842]); if (text) p.drawText(text, { x: 60, y: 760, size: 24, font: await d.embedFont(StandardFonts.Helvetica) }); return Buffer.from(await d.save({ useObjectStreams: false })) }
const csp: string[] = [], ext: string[] = [], BASE = process.env.BASE ?? 'http://localhost:4173'
test.beforeEach(({ page }) => { page.on('request', r => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith('blob:') && !u.startsWith('data:')) ext.push(u) }); page.on('console', m => { if (/Content Security Policy|violates/i.test(m.text())) csp.push(m.text()) }); page.on('dialog', d => d.accept()) })
test.afterEach(() => { expect(csp, 'CSP violations').toEqual([]); expect(ext, 'requests to other sites').toEqual([]) })
test('ocr reads a scanned image using only files from this site', async ({ page }) => {
  await page.goto('/ocr-pdf'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles('e2e/fixtures/invoice.png')
  await page.getByRole('button', { name: /Read 1 page/ }).click()
  await expect(page.getByLabel('OCR text for page 1')).toHaveValue(/Invoice/, { timeout: 120000 })
})
test('password-protected pdf: wrong password rejected, right one opens', async ({ page }) => {
  const d = await PDFDocument.create(); d.addPage([300, 400]); d.encrypt({ userPassword: 'pw12345', ownerPassword: 'owner-pw-9' })
  await page.goto('/unlock-pdf'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles({ name: 'statement.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await d.save()) })
  await expect(page.getByText('is password-protected')).toBeVisible()
  await page.getByLabel('PDF password').fill('nope'); await page.getByRole('button', { name: 'Open file' }).click(); await expect(page.getByText('not correct').first()).toBeVisible()
  await page.getByLabel('PDF password').fill('pw12345'); await page.getByRole('button', { name: 'Open file' }).click(); await expect(page.getByText('1 pages').first()).toBeVisible()
})
test('redaction removes the text, is verified, and annotations can be added', async ({ page }) => {
  await page.goto('/redact-pdf'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: await pdf('SECRET123 account') })
  await page.locator('.cell').first().dblclick()
  const drag = async (a: number[], b: number[]) => { const r = (await page.locator('.layer').boundingBox())!; await page.mouse.move(r.x + r.width * a[0], r.y + r.height * a[1]); await page.mouse.down(); await page.mouse.move(r.x + r.width * b[0], r.y + r.height * b[1], { steps: 4 }); await page.mouse.up() }
  await page.getByRole('button', { name: 'Redact', exact: true }).click(); await drag([0.05, 0.03], [0.9, 0.12]); await expect(page.locator('.mk-redact')).toHaveCount(1)
  await page.getByRole('button', { name: 'Text', exact: true }).click(); await drag([0.1, 0.5], [0.5, 0.56]); await expect(page.locator('.mk-text')).toHaveCount(1)
  await page.getByRole('button', { name: 'Close' }).click(); await page.getByRole('button', { name: 'Merge and check' }).click()
  await expect(page.getByText(/Redaction verified/)).toBeVisible({ timeout: 60000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('a.dl').click()]); const raw = (await readFile(await dl.path())).toString('latin1')
  expect(raw).not.toContain('SECRET123'); expect(raw.startsWith('%PDF')).toBe(true)
})
import { makeSignedPdf } from './signedFixture'
test('form fields can be filled and are flattened into the merged file', async ({ page }) => {
  const d = await PDFDocument.create(), pg = d.addPage([300, 400]); d.getForm().createTextField('amount').addToPage(pg, { x: 40, y: 300, width: 200, height: 24 })
  await page.goto('/fill-form'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles({ name: 'form.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await d.save()) })
  await page.getByLabel('amount').fill('1250.00'); await page.getByRole('button', { name: 'Merge and check' }).click(); await expect(page.getByText(/Validation passed/)).toBeVisible({ timeout: 30000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('a.dl').click()]), bytes = await readFile(await dl.path())
  expect((await PDFDocument.load(bytes)).getForm().getFields().length).toBe(0); const doc = await pjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise; expect(((await (await doc.getPage(1)).getTextContent()).items as unknown as { str: string }[]).map(i => i.str).join(' ')).toContain('1250.00')
})
test('signature check: intact file passes, edited file fails', async ({ page }) => {
  await page.goto('/verify-signatures'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles([{ name: 'good.pdf', mimeType: 'application/pdf', buffer: await makeSignedPdf() }, { name: 'edited.pdf', mimeType: 'application/pdf', buffer: await makeSignedPdf({ tamper: true }) }])
  const btns = page.getByRole('button', { name: 'Check signatures' }); await expect(btns).toHaveCount(2); await btns.nth(0).click(); await expect(page.getByText(/Intact: not changed/)).toBeVisible({ timeout: 30000 })
  await btns.nth(1).click(); await expect(page.getByText(/INVALID/)).toBeVisible({ timeout: 30000 })
})
const fileText = async (path: string) => { const d = await pjs.getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true }).promise; return ((await (await d.getPage(1)).getTextContent()).items as unknown as { str: string }[]).map(i => i.str).join(' ') }
for (const [name, lang, re] of [['invoice.png', 'English', /Invoice/], ['hindi.png', 'Hindi', /[\u0900-\u097f]{3}/], ['tamil.png', 'Tamil', /[\u0b80-\u0bff]{3}/]] as const) {
  test(`searchable pdf from ${lang} scan`, async ({ page }) => {
    await page.goto('/searchable-pdf'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles(`e2e/fixtures/${name}`)
    if (lang !== 'English') { await page.getByLabel(lang).check(); await page.getByLabel('English').uncheck() }
    await page.getByLabel(/I understand a searchable PDF/).check(); await page.getByRole('button', { name: 'Make searchable PDF' }).click()
    await expect(page.getByText(/Searchable PDF built and checked/)).toBeVisible({ timeout: 150000 })
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('a.dl').click()]), text = await fileText(await dl.path())
    console.log(`RESULT ${lang}:`, JSON.stringify(text.slice(0, 120))); expect(text).toMatch(re)
  })
}
import { makeDocx } from '../src/extract'
test('a fillable text box can be created and stays fillable in the merged file', async ({ page }) => {
  const d = await PDFDocument.create(); d.addPage([595, 842])
  await page.goto('/create-form'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles({ name: 'blank.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await d.save()) })
  await page.locator('.cell').first().dblclick(); await page.getByRole('button', { name: 'Form text box' }).click()
  const r = (await page.locator('.layer').boundingBox())!; await page.mouse.move(r.x + r.width * 0.1, r.y + r.height * 0.1); await page.mouse.down(); await page.mouse.move(r.x + r.width * 0.6, r.y + r.height * 0.15, { steps: 4 }); await page.mouse.up()
  await page.getByLabel('Field name').fill('customer'); await page.getByRole('button', { name: 'Close' }).click(); await page.getByRole('button', { name: 'Merge and check' }).click()
  await expect(page.getByText(/Validation passed/)).toBeVisible({ timeout: 30000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('a.dl').click()])
  expect((await PDFDocument.load(await readFile(await dl.path()))).getForm().getFields().map(f => f.getName())).toEqual(['customer'])
})
test('a Word file with rupee and Hindi text becomes PDF pages', async ({ page }) => {
  await page.goto('/docx-to-pdf'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles({ name: 'note.docx', mimeType: 'application/octet-stream', buffer: Buffer.from(makeDocx([['Total \u20b91250', '\u0939\u093f\u0928\u094d\u0926\u0940']])) })
  await expect(page.getByText('1 pages').first()).toBeVisible({ timeout: 30000 }); await page.getByRole('button', { name: 'Merge and check' }).click(); await expect(page.getByText(/Validation passed/)).toBeVisible({ timeout: 30000 })
})
// Known limit: on this heavily noisy scan the amounts still lose their commas and points (1,011.60 is read as 101160). This test pins what cleanup does achieve, and the app warns users to check every figure.
test('cleanup makes a noisy, tilted, compressed scan readable (amounts are still unreliable)', async ({ page }) => {
  await page.goto('/ocr-pdf'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles('e2e/fixtures/noisy-invoice.jpg')
  await page.getByRole('button', { name: /Read 1 page/ }).click(); const box = page.getByLabel('OCR text for page 1')
  await expect(box).toHaveValue(/Total/, { timeout: 120000 }); const text = await box.inputValue(); console.log('RESULT', JSON.stringify(text))
  for (const want of ['TAX INVOICE', '14-10-2026', 'Total Amount Due']) expect(text).toContain(want)
})
import { zipSync } from 'fflate'
test('an Excel file becomes table pages', async ({ page }) => {
  const e = (s: string) => new TextEncoder().encode(s), H = '<?xml version="1.0"?>', x = zipSync({ 'xl/workbook.xml': e(`${H}<workbook xmlns:r="x"><sheets><sheet name="Ledger" sheetId="1" r:id="rId1"/></sheets></workbook>`), 'xl/_rels/workbook.xml.rels': e(`${H}<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>`), 'xl/worksheets/sheet1.xml': e(`${H}<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Rent \u20b9</t></is></c><c r="B1"><v>12500.5</v></c></row></sheetData></worksheet>`) })
  await page.goto('/excel-to-pdf'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles({ name: 'ledger.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(x) })
  await expect(page.getByText('1 pages').first()).toBeVisible({ timeout: 30000 }); await page.getByRole('button', { name: 'Merge and check' }).click(); await expect(page.getByText(/Validation passed/)).toBeVisible({ timeout: 30000 })
})
test('text can be replaced in a simple PDF, and a missing text is refused', async ({ page }) => {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica); d.addPage([400, 300]).drawText('Total 100.00 due', { x: 30, y: 200, size: 14, font: f }); const buf = Buffer.from(await d.save())
  await page.goto('/replace-text'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: buf })
  await page.getByLabel('Find', { exact: true }).fill('nowhere'); await page.getByLabel('Replace with').fill('x'); await page.getByRole('button', { name: 'Add replacement' }).click(); await page.getByRole('button', { name: 'Merge and check' }).click()
  await expect(page.getByText(/was not found in a form that can be replaced/)).toBeVisible({ timeout: 30000 }); await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.getByLabel('Find', { exact: true }).fill('100.00'); await page.getByLabel('Replace with').fill('150.00'); await page.getByRole('button', { name: 'Add replacement' }).click(); await page.getByRole('button', { name: 'Merge and check' }).click()
  await expect(page.getByText(/Validation passed/)).toBeVisible({ timeout: 30000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('a.dl').click()]); expect(await fileText(await dl.path())).toMatch(/150\.00/)
})
test('Bates numbers are stamped on the merged pages', async ({ page }) => {
  const mk = async (n: number) => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([300, 400]); return Buffer.from(await d.save()) }
  await page.goto('/bates-numbering'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles([{ name: 'a.pdf', mimeType: 'application/pdf', buffer: await mk(2) }, { name: 'b.pdf', mimeType: 'application/pdf', buffer: await mk(1) }])
  await page.locator('label', { hasText: /^Page numbers/ }).locator('select').selectOption('bates'); await page.getByLabel('Prefix', { exact: true }).fill('INV-'); await page.getByLabel('Digits', { exact: true }).fill('4'); await page.locator('label', { hasText: /^Position/ }).locator('select').selectOption('tr')
  await page.getByRole('button', { name: 'Merge and check' }).click(); await expect(page.getByText(/Validation passed/)).toBeVisible({ timeout: 30000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('a.dl').click()]), d = await pjs.getDocument({ data: new Uint8Array(await readFile(await dl.path())), useSystemFonts: true }).promise, all: string[] = []
  for (let i = 1; i <= d.numPages; i++) all.push(((await (await d.getPage(i)).getTextContent()).items as unknown as { str: string }[]).map(t => t.str).join(' '))
  expect(all).toEqual(['INV-0001', 'INV-0002', 'INV-0003'])
})
test('compress to a size limit gives a file under the limit, or says it cannot', async ({ page }) => {
  await page.goto('/compress-pdf'); const img = 'e2e/fixtures/noisy-invoice.jpg'; await page.locator('input[type=file][accept*=".docx"]').setInputFiles([img, img, img]); await expect(page.getByText('3 pages', { exact: true })).toBeVisible({ timeout: 30000 })
  await page.getByLabel('Target size').selectOption({ label: 'Under 200 KB' }); await page.getByLabel(/I understand text will no longer/).check(); await page.getByRole('button', { name: /Compress to under/ }).click()
  await expect(page.getByText(/Compressed to .* \(limit 200 KB\)/)).toBeVisible({ timeout: 90000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('a.dl').click()]), bytes = await readFile(await dl.path()); console.log('SIZE', bytes.length)
  expect(bytes.length).toBeLessThanOrEqual(200 * 1000); expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3)
})
test('find and redact removes the matched text from the page itself, not just the text layer', async ({ page }) => {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), pg = d.addPage([595, 842])
  pg.drawText('Contact ravi.kumar@example.com for details', { x: 60, y: 760, size: 22, font: f }); pg.drawText('PAN ABCDE1234F holder account', { x: 60, y: 700, size: 22, font: f })
  await page.goto('/find-redact'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles({ name: 'k.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await d.save()) })
  await page.getByRole('button', { name: 'Find matches' }).click(); await expect(page.getByText('ravi.kumar@example.com', { exact: false }).first()).toBeVisible({ timeout: 30000 }); await expect(page.getByText('ABCDE1234F').first()).toBeVisible()
  await page.getByRole('button', { name: /Add redaction boxes for 2 ticked/ }).click(); await page.getByRole('button', { name: 'Merge and check' }).click()
  await expect(page.getByText(/Redaction verified/)).toBeVisible({ timeout: 60000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('a.dl').click()]), saved = await dl.path()
  await page.goto('/ocr-pdf'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles(saved); await page.getByLabel(/Clean up scans first/).uncheck(); await page.getByRole('button', { name: /Read 1 page/ }).click()
  const box = page.getByLabel('OCR text for page 1'); await expect(box).toHaveValue(/holder|account|Contact|details/, { timeout: 120000 }); const text = await box.inputValue(); console.log('RESULT', JSON.stringify(text))
  expect(text).not.toMatch(/ravi|kumar|example|\.com|ABCDE|1234/i); expect(text).toMatch(/holder|account/)
})
test('a damaged PDF can be repaired', async ({ page }) => {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica); for (let i = 1; i <= 3; i++) d.addPage([300, 300]).drawText(`Page ${i}`, { x: 40, y: 200, size: 20, font: f })
  const good = Buffer.from(await d.save({ useObjectStreams: false })), cut = good.subarray(0, Math.floor(good.length * 0.8))
  await page.goto('/repair-pdf'); await page.locator('input[type=file][accept=".pdf,application/pdf"]').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: cut })
  await expect(page.getByText(/Repaired:|Partly repaired:/)).toBeVisible({ timeout: 60000 }); console.log('RESULT', (await page.getByText(/Repaired:|Partly repaired:/).first().innerText()).slice(0, 90))
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('a.dl').click()]); const out = await PDFDocument.load(await readFile(await dl.path())); console.log('PAGES', out.getPageCount()); expect(out.getPageCount()).toBeGreaterThanOrEqual(1)
})
test.describe('camera', () => {
  test.use({ permissions: ['camera'] })
  test('a captured page from the camera is added to the workspace', async ({ page }) => {
    await page.goto('/scan-camera'); await page.getByRole('button', { name: 'Start camera' }).click(); await expect(page.getByLabel('Camera preview')).toBeVisible()
    await page.waitForFunction(() => (document.querySelector('video') as HTMLVideoElement | null)?.videoWidth! > 0, null, { timeout: 20000 }); await page.getByRole('button', { name: 'Capture page' }).click()
    await expect(page.getByAltText('Scan 1')).toBeVisible(); await page.getByRole('button', { name: /Add 1 scan/ }).click(); await expect(page.getByText('1 pages', { exact: true })).toBeVisible({ timeout: 30000 })
    expect(await page.evaluate(() => document.querySelector('video'))).toBeNull()
  })
})
test('the app still opens and merges with the network off after one visit', async ({ page, context }) => {
  await page.goto('/'); await page.waitForFunction(async () => { const k = await caches.keys(); return k.length > 0 && !!(await (await caches.open(k[0])).match('/')) }, null, { timeout: 60000 }); await page.waitForTimeout(1500)
  await context.setOffline(true); await page.goto('/merge-pdf')
  const d = await PDFDocument.create(); d.addPage([300, 400]); await page.locator('input[type=file][accept*=".docx"]').setInputFiles({ name: 'o.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await d.save()) })
  await page.getByRole('button', { name: 'Merge and check' }).click(); await expect(page.getByText(/Validation passed/)).toBeVisible({ timeout: 30000 })
})
