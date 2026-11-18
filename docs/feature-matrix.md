# Feature matrix (status as of version 1.9)
"Tested" means covered by a passing automated unit test. Nothing has yet been exercised in a real browser or end-to-end.

| Feature | Status |
|---|---|
| Merge, reorder files and pages, rotate, remove, duplicate, range select, undo/redo | Implemented; merge/rotation/duplication/validation unit-tested |
| Index page, blank separators, page numbers | Implemented; unit-tested |
| Split (every page, ranges, after pages) to ZIP | Implemented; split plan unit-tested |
| Blank-page detection with review (opt-in removal) | Implemented; scoring unit-tested; real scans not yet tried; thresholds may need tuning |
| Signature, form, attachment, bookmark warnings | Implemented with limits (byte-pattern detection only; no signature verification) |
| Text watermark; clearing of producer/creator and setting title/author; A–Z sorting; output-vs-source size report | Implemented; watermark and metadata unit-tested |
| Compress (scans, by re-rendering pages as images, with consent; measured sizes; refuses to offer a larger file) | Implemented, untested in a browser. Result check is unit-tested; rendering path is not. Text, forms and signatures are lost by design |
| Crop pages (visual margins, preview, rotation-aware) | Implemented; margin mapping unit-tested; hides but does not erase content |
| Repair, lossless structural optimization, PDF/A | Not implemented |
| Image to PDF (JPG, PNG, WebP, BMP, GIF) and text to PDF; images and text files can be mixed into a merge | Implemented. JPG/PNG/text unit-tested; WebP/BMP/GIF use browser decoding and are untested; no EXIF auto-rotate; no TIFF/HEIC/SVG; text with the rupee sign or non-Latin scripts is refused, not altered |
| PDF to text, text-only Word (.docx) and heuristic CSV | Implemented with limits; grouping, CSV escaping and docx contents unit-tested; docx not opened in Word |
| Compare two PDFs (text differences per page) | Implemented; comparison logic unit-tested; ignores layout, images and signatures |
| PDF to PowerPoint/images, Word/Excel/PowerPoint to PDF, layout-preserving Word, true table extraction | Not implemented |
| OCR (English, Hindi, Tamil) with confidence and editable review text | Implemented. Engine and English data verified in Node on one sample image (96% confidence). Hindi and Tamil data not exercised. Browser loading from /tesseract/ untested |
| Searchable PDF from OCR (English, Hindi, Tamil) | Implemented. Pages become images with an invisible text layer written without script shaping, using bundled Noto Sans fonts. Every result is read back with PDF.js and compared with what OCR found; a mismatch over 2% blocks the download. Unit-tested for English, rupee sign, Hindi and Tamil, and run in a browser on one clean synthetic scan per language (text read back exactly). NOT tested: real scans, skewed or noisy pages, mixed-language pages, other PDF viewers (only PDF.js was used to read the text back), or large documents. Original text, forms, links and signatures are not kept |
| Edit text/images/shapes/forms, watermark, crop | Not implemented |
| Open password-protected PDFs (you enter the password) and protect the merged output (AES-256) | Implemented using the @cantoo/pdf-lib fork. Protect/open round trip unit-tested in Node; password prompt and pdf.js password path untested in a browser; strength not independently audited |
| Annotation layer: text, highlight, box, move, delete, undo (enlarged page view) | Implemented. Placement maths unit-tested against PDF.js on all four rotations; pointer interaction untested in a browser; no resize or rotate of marks; annotations are flattened, not editable comments |
| Redaction (permanent) | Implemented by rebuilding redacted pages as images with boxes burned in, then re-reading the output to confirm no extractable original text. Burn-in callback and refusal paths unit-tested; the real renderer and the post-merge text check are untested in a browser. Text extraction/OCR refuse to run while redactions exist |
| Visual signature (drawn or uploaded image, signature-style text) | Implemented. A visual mark only: not a certificate signature, not a qualified e-signature |
| Signature verification (cryptographic integrity) | Implemented with pkijs: checks that the signed byte ranges still match the signature and the embedded certificate, and reports signer name, issuer, validity dates, and whether content was added after signing. Unit-tested with a real PKCS#7 signature (intact, edited, appended, unreadable) and run in a browser. NOT checked: trust chain, revocation, signing time, timestamps, or certification (DocMDP) rules. Intact does not prove who signed |
| Fill real form fields (text, tick boxes, dropdowns, radio, lists), flattened into the merged file | Implemented. Unit-tested and run in a browser. Latin letters and numbers only (other characters are refused, not altered). Thumbnails do not show filled values. Fields cannot be kept live after merging |
| Create new fillable forms, editing existing PDF text | Not implemented |
| Playwright end-to-end and network/storage tests | 6 tests run in headless Chromium and passed (see docs/network-audit.md). Not covered: Hindi/Tamil OCR, mobile, deployed URL |
| Homepage with tool search, accounting essentials, recent tools; routes for the 10 working tools | Implemented, untested in a browser. All routes share one workspace and open the relevant panel; they are not separate screens. Recent tools are saved on the device as tool names only |
| Extract selected pages to a new PDF | Implemented, untested in a browser (uses the unit-tested merge engine) |
| Competitive research document | Partial: iLovePDF only, from secondary sources |

## Added in version 1.4
| Feature | Status |
|---|---|
| Create fillable form fields (text box, tick box) on any page, with names; fields stay live in the merged file | Implemented. Placement unit-tested on rotated pages; created and merged in a real browser. Names must be unique and use letters, numbers, spaces, dots, dashes or underscores |
| Cover (whiteout) mark | Implemented. Hides only: the original text stays in the file, and the app warns. Use Redact to remove content |
| Edit existing PDF text in place | Not implemented. Cover plus a new text mark is an overlay, not real editing |
| Word (.docx) to PDF, text only | Implemented with limits: paragraphs only; no formatting, tables, pictures or headers. Latin, rupee sign, Hindi and Tamil text; other characters are refused. Run in a browser and unit-tested. Hindi/Tamil are drawn with script shaping, so copying some vowel signs from the result may come out in a different order |
| Excel, PowerPoint, Word with layout to/from PDF | Not implemented (needs a native engine) |
| Signature trust: check the certificate chains to a root certificate you supply | Implemented; unit-tested with a throwaway CA (trusted, stranger root, none). No root certificates are bundled, so the app never claims a signer is trusted unless you supplied the root |
| Revocation checking (CRL/OCSP) | Not implemented by design: it needs internet requests to the issuer |
| File name pattern bug: {Month} and {Year} were swapped (names came out like _10_Accounts.pdf) | Fixed; unit-tested and checked in a browser |
| Simplified workspace: one main action, options and advanced tools folded away | Done; checked by screenshots on desktop and a phone-sized window (emulated, not a real phone) |

## OCR accuracy finding
On a deliberately noisy, tilted, heavily compressed invoice image, English OCR reached about 58% confidence and misread amounts and dates (1,011.60 as 101160; 14-10-2026 as 1410-2026). Clean synthetic images read correctly. Check every figure against the page. Deskew and cleanup are not implemented.

## Added in version 1.5: scan cleanup before OCR
| Feature | Status |
|---|---|
| Clean up scans before OCR (remove speckles with a 3x3 median filter, then black and white by Otsu threshold). On by default; a searchable PDF made this way contains the cleaned black-and-white copy | Implemented. Filters unit-tested. On the noisy test scan, native-size run in Node: 58% to 95% confidence and every amount and date correct. In the real browser pipeline (the image placed on an A4 page and read at 200 dpi): 32% confidence and unreadable without cleanup, mostly readable with it, but amounts still lost their commas and points (1,011.60 read as 101160). Treat amounts from noisy scans as unreliable |
| Straighten tilted pages (deskew) | Code and unit tests exist for synthetic tilts, but it is OFF: on the real tilted test scan it detected no tilt, so it is unproven |

## Added in version 1.6
| Feature | Status |
|---|---|
| Excel (.xlsx) and CSV to PDF, values only | Implemented. Stored values and dates (date styles recognised, shown dd-mm-yyyy); formulas show their last saved result; number formats, colours, merged cells, charts and pictures are NOT kept; wide sheets go landscape and shrink, and are refused if unreadable. Latin, rupee, Hindi and Tamil text. Unit-tested and run in a browser |
| PowerPoint (.pptx) to PDF, slide text only | Implemented. One page per slide in slide order; layout, pictures and charts are NOT kept. Unit-tested; not run in a browser |
| Replace text inside a PDF (simple PDFs only) | Implemented with a hard limit: only text stored in a simple readable form (single-byte fonts, not split into pieces) can be changed. A PDF printed from Chromium was correctly refused, and most Word or accounting-software PDFs will be refused too. When it works, the result is read back to confirm; otherwise nothing is offered. Applies to Merge only. Latin letters and numbers only. Longer text can overlap neighbours |
| Edit text in PDFs with embedded fonts, Word/Excel/PowerPoint with layout | Not implemented |
| Flag suspicious amounts in OCR text (long numbers with no comma or point, odd commas) | Implemented as a warning only; unit-tested; it cannot catch every misread |
| Revocation checking for signatures | Not implemented by design (needs internet requests) |

## Added in versions 1.7 to 1.9
| Feature | Status |
|---|---|
| Page numbers: five styles (1, 1 of N, Page 1, Page 1 of N, Bates), six positions, start number, leave first pages unnumbered, header and footer text | Implemented. Label text and placement unit-tested on all four rotations and three positions; Bates stamping run in a browser. Header, footer and Bates prefix: Latin letters and numbers only |
| Compress to a size limit (200 KB to 10 MB): tries sharper settings first, refuses when nothing fits | Implemented. Choosing and assembly logic unit-tested; run in a browser (3 scanned pages came out at 144 KB under a 200 KB limit). Rebuilds pages as pictures, so text, forms and signatures are lost |
| Find and redact personal data (emails, Indian mobile numbers, PAN, card numbers with checksum, 12-digit numbers, custom words) | Implemented. Matching unit-tested. Boxes are padded so they cover the text; a first version left the last character of an email partly uncovered and was fixed. Verified end to end in a browser: after merging, OCR of the finished page found none of the email or PAN. 12-digit numbers are not checksum-checked. Text stored as pictures cannot be searched (use OCR first) |
| Repair a damaged PDF: lenient rewrite keeping text, or last-resort rebuild of drawable pages as pictures | Implemented. Rewrite path unit-tested; a file truncated to 80% was repaired to 3 pages in a browser. The picture fallback is not separately tested. Heavily damaged files can still fail |
| Scan with your camera (live camera or phone camera app), looks: Document, Black and white, Original | Implemented. Lighting evening unit-tested; live capture tested with a fake camera device. NOT tested on a real camera, phone, or the phone camera app option |
| Offline use after the first visit (app files only; OCR data after first use) | Implemented with a service worker that caches this site's own program files, never documents. Tested: reload and merge with the network switched off; cache contents checked to hold only own-site static files. Not tested: updates replacing an old cached version, other browsers, OCR offline |
