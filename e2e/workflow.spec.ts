import { test, expect } from '@playwright/test'
import { PDFDocument } from '@cantoo/pdf-lib'
const mk = async (n: number, size: [number, number] = [300, 400]) => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage(size); return Buffer.from(await d.save()) }
// Privacy: every request must stay on this site, no document names in URLs, and only tool names may be stored.
test('merge workflow keeps everything local and downloads a correct PDF', async ({ page, baseURL }) => {
  const urls: string[] = []; page.on('request', r => urls.push(r.url())); page.on('dialog', d => d.accept())
  await page.goto('/merge-pdf')
  await page.locator('input[type=file][accept*=".docx"]').setInputFiles([
    { name: 'secret-bank-statement.pdf', mimeType: 'application/pdf', buffer: await mk(3) },
    { name: 'invoice-0042.pdf', mimeType: 'application/pdf', buffer: await mk(1, [500, 300]) },
    { name: 'receipts.pdf', mimeType: 'application/pdf', buffer: await mk(2) }])
  await expect(page.getByText('6 pages')).toBeVisible()
  await page.getByRole('button', { name: 'Move invoice-0042.pdf up' }).click()
  await page.getByRole('button', { name: 'Merge and check' }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('a.dl').click()])
  const out = await PDFDocument.load(Buffer.from(await (await import('node:fs/promises')).readFile(await dl.path())))
  expect(out.getPageCount()).toBe(6); expect(out.getPage(0).getSize().width).toBe(500)   // the reordered 1-page file comes first
  for (const u of urls) { expect(new URL(u).origin === new URL(baseURL!).origin || u.startsWith('blob:') || u.startsWith('data:')).toBe(true); expect(u).not.toMatch(/secret|invoice-0042|receipts/) }
  const stored = await page.evaluate(async () => ({ ls: Object.keys(localStorage).filter(k => k !== 'aps.recent'), ss: Object.keys(sessionStorage), caches: await (async () => { const bad: string[] = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) { const u = new URL(r.url); if (!k.startsWith('aps-static-') || u.origin !== location.origin || /secret|invoice-0042|receipts|\.pdf$/i.test(u.pathname)) bad.push(k + ' ' + r.url) } return bad })(), idb: ((await indexedDB.databases?.()) ?? []).length }))
  expect(stored).toEqual({ ls: [], ss: [], caches: [], idb: 0 })
  await page.getByRole('button', { name: 'Clear everything' }).click()
  await expect(page.getByText('0 pages')).toBeVisible()
})
test('a damaged file is rejected with a clear message', async ({ page }) => {
  await page.goto('/merge-pdf'); await page.locator('input[type=file][accept*=".docx"]').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 not really') })
  await expect(page.getByText(/is damaged or uses an unsupported format/)).toBeVisible()
})
test('a direct tool link loads after refresh', async ({ page }) => { await page.goto('/split-pdf'); await page.reload(); await expect(page.getByText('Split PDF').first()).toBeVisible() })
test('the file name uses the month name and year from the chosen month', async ({ page }) => {
  await page.goto('/merge-pdf'); await page.getByText('More options', { exact: true }).click(); await page.locator('input[type=month]').fill('2026-03')
  await expect(page.getByText('March_2026_Accounts.pdf')).toBeVisible()
})
