# Privacy and security (version 0.4)
- All processing is in the browser (pdf-lib, pdf.js, fflate). There is no backend and no upload route.
- The only stored value is `aps.recent` in localStorage: up to four tool names (for example `merge-pdf`). No document, filename or content is stored. Pages use the path `/tool-name` only.
- Documents are never stored. A source search finds no fetch, XMLHttpRequest, WebSocket, beacon, localStorage, sessionStorage or IndexedDB calls.
- `vercel.json` sets a CSP with self-only connect-src, nosniff, no-referrer, Permissions-Policy and HSTS.
- Not yet done: browser Network-panel audit, automated network-interception tests, dependency audit, worker/CSP check on a deployed build.
- Local processing does not protect against malware, malicious extensions, browser flaws or compromised dependencies. Browsers cannot guarantee immediate memory erasure.
- OCR runs from files served by this site (`/tesseract/`). The CSP allows `'wasm-unsafe-eval'` for the OCR engine's WebAssembly. Language data is copied from npm packages at build time by `scripts/copy-ocr.mjs`.

- Cache Storage is now used, only by the offline service worker (`/sw.js`), and only for this site's own program files (`/`, `/assets/*`, `/tesseract/*`, `favicon.svg`). Documents are read from disk and never pass through the service worker. A test checks that nothing else gets cached.
- The camera permission is allowed for this site only (`camera=(self)`). The camera stops when you press Stop or add the scans, and when you leave the page.
