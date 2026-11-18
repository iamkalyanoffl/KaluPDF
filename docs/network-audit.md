# Network and storage audit
## Automated run (performed 2026-10-24)
- Browser: headless Chromium (from the `@sparticuz/chromium` npm package) driven by Playwright, against the production build served by `scripts/serve-dist.mjs`, which applies the exact headers from `vercel.json`.
- Twenty-four tests, each run in its own browser process: merge workflow, damaged-file rejection, direct tool link after reload, OCR of an image, password-protected PDF open, redaction with annotation, form filling, signature checking, searchable PDFs from English, Hindi and Tamil scans, the file name month fix, creating a fillable form field, a Word file with rupee and Hindi text, an Excel file, and text replacement.
- Result: all twenty-four passed (rerun after the version 1.9 changes). The feature tests also assert that no request left the site's own origin. In every run, every request went to the site's own origin (or `blob:`/`data:`), no request URL contained a file name, no Content-Security-Policy violation appeared in the Console, and Local Storage held only `aps.recent`, with Session Storage, IndexedDB and Cache Storage empty (checked in the merge workflow test).
- The OCR test proves the OCR engine, WebAssembly and English data load from the site itself under the production CSP.

## Limits of this audit
- One headless browser, no extensions, one machine. It is not a penetration test or a security review.
- Tests run one at a time because this Chromium build runs in single-process mode and cannot open a second browser session in one process.
- OCR was tried on one clean synthetic image per language; real scans are not tested. The Network panel in a normal desktop Chrome, mobile browsers, and the deployed Vercel URL are not yet checked.

## Repeat it yourself
`npm run build`, `node scripts/serve-dist.mjs` (port 4174), then `npx playwright install chromium` and `BASE=http://localhost:4174 npx playwright test e2e/features.spec.ts`. For a manual check, use DevTools (Network, Application) while merging test PDFs: expect only own-site files and no stored documents.

The phone-size check used Chromium's narrow window, not a real phone or Safari. Desktop Chrome with extensions and the deployed Vercel address have not been checked.

Version 1.9 adds an offline cache and the camera. The merge test now asserts that every cached entry is an own-site static file, and the camera test uses a fake camera device (no real camera was tried).
