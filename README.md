# Accountant PDF Studio
Local-first PDF merger. All processing runs in the browser (pdf-lib + pdf.js). No backend, no uploads, no analytics, no external fonts or scripts.

## Run
1. Install Node.js 20+ from nodejs.org
2. `npm install`
3. `npm run dev` (development) · `npm test` · `npm run build && npm run preview` (production)

## Deploy to Vercel
1. `git init && git add . && git commit -m "init"`; create a GitHub repo and `git push`
2. Vercel → Add New Project → import the repo. Framework: Vite, build `npm run build`, output `dist`. No environment variables.
3. Open the URL, then check DevTools → Network while merging: only static assets should load.
Security headers (CSP, nosniff, no-referrer, Permissions-Policy, HSTS) are in `vercel.json`.

## Limits
Encrypted PDFs are rejected. Signatures, form fields, bookmarks and attachments may not survive merging. Local processing does not protect against malware or malicious extensions. Closing the tab discards work; memory erasure is not guaranteed.

## End-to-end tests
`npx playwright install chromium` then `npm run e2e`. These build the app, import test PDFs, merge, download, and check that every request stays on this site and nothing but tool names is stored. They have not been run yet.
