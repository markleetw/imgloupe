# ImgLoupe — engineering instructions

Chrome MV3 extension for image preview/copy/download, whole-document ZIP export,
and local Traditional Chinese/English OCR on Google Docs, Sheets and Slides.
The interface is localized in English (default) and Traditional Chinese.

## Sources and architecture

| Concern | Source |
| --- | --- |
| Popup identity, ZIP action, project links | `src/popup/` |
| Top-right toolbar and lightbox/crop | `src/content/ui/` |
| Docs selected-rectangle sampling | `src/content/docs/` |
| Sheets floating images; Slides SVG images | `src/content/sheets/sheets-handler.js`, `src/content/slides/` |
| Selection lifetime and stale-result guards | `src/content/shared/selection-tracker.js` |
| Resource discovery, color signatures, 60-item preview cache | `src/content/shared/` |
| ZIP export (background Office export, Docs mobile view, fallback packing) | `src/background/export-service.js`, `src/shared/office-export.js`, `src/content/shared/` |
| UI strings and message types shared by popup/content | `_locales/`, `src/shared/i18n.js`, `src/shared/messages.js` |
| Message routing/offscreen lifecycle | `src/background/` |
| Input limits, serialized OCR, idle worker disposal | `src/offscreen/` |
| Verified offline model data | `vendor/tessdata-fast/` |
| Complete build and publication checks | `scripts/build.mjs`, `scripts/package.mjs`, `scripts/verify-package.mjs` |

## Product invariants

- Popup contains the project icon/name/version, document connection state,
  concise usage help, local OCR language information, ZIP export, Issue/GitHub
  links and a bundled privacy-policy link. The only action button is ZIP export. No
  widget-position, gallery, save-folder or click-to-preview settings. Links use
  the markleetw/imgloupe repository and its issues page.
- Toolbar placement is automatic, outside the selected image so it covers neither
  the picture nor the apps' handles and quick toolbars: above the top-right corner;
  on the right side for narrow images or when there is no room above; inside the
  top-right corner only when neither fits (src/content/ui/toolbar.js). No Chrome
  settings storage is needed. Downloads follow Chrome's default download folder
  and browser-level save prompts; do not claim to override system preferences.
- Docs may render content in virtualized canvas tiles. Use selection bounds and
  small tile projections, never assume document-body `<img>` elements exist or
  scan the whole document's pixels or stitch full-size tiles.
- Sheets supports floating images. Ordinary cell clicks must not mount a toolbar.
  Only the literal https URL of a visible `=…IMAGE("https://…")` formula may
  contribute to the fallback ZIP; never collect arbitrary links or page text.
- ZIP export reads the current document version from docs.google.com with the
  user's session. Sheets/Slides: the Office export (.xlsx/.pptx) media folder,
  downloaded by the background service worker (the export redirects to a
  cross-origin googleusercontent host a content script cannot read) and passed
  back image by image. Docs: `/document/d/<id>/mobilebasic` (same origin); its
  images are fetched with `=s0` (stored size), falling back to the listed size.
  Sheets IMAGE() cells (from the xlsx formulas) try the literal https address
  first, then Google's copy from `/htmlview/sheet?gid=` (docsubipk, `=s0`).
  Only when these fail or hold no images does it pack images loaded in the page
  (bounded registry of 2000 URLs).
- Number ZIP images by document position, never by media file name (Google's
  names are in no fixed order): Slides by presentation slide order, then r:embed
  order in the slide; Sheets by workbook sheet order, then drawing anchor row and
  column (the anchor cell is the image's location); unplaced media last by name.
- `failed-images.txt` is written only when something failed, always in English,
  and names each failure's location (sheet and cell, slide, or position), address
  and reason (src/content/shared/failure-report.js). Never read Google's
  browser image cache: it can hold images deleted from the document.
- Every packed or downloaded file must be an image (MIME type or signature);
  HTML or other responses are reported as failures, never saved as images.
- ZIP deduplication uses full-file SHA-256, never thumbnails or color signatures.
  Duplicate aliases are neither exported twice nor reported as failed downloads.
- A failed single download reports the error; never fall back to navigating or
  opening the source URL.
- Google may store loaded images under same-origin `filesystem:` URLs. Read
  their file entries using the document's FileSystem API, not `fetch()`. Share
  that path across copy/download/OCR/discovery; never request broader hosts to
  work around this URL scheme.
- Docs may hide the selected image inside `.kix-embeddedobjectdragger`. Only
  use its source when its layout matches the visible selection bounds.

## Security and resource invariants

- Permissions: `offscreen`, `clipboardWrite`; host access only to
  `https://docs.google.com/*` and `https://*.googleusercontent.com/*`, used solely
  by the background export service. Content scripts run only on docs.google.com
  document, spreadsheets and presentation pages; their CSS is injected by the
  manifest and nothing is web-accessible. All executable code,
  OCR cores and models ship locally. No CDN scripts, remote OCR, analytics or
  automatic OCR prewarm.
- CSP allows self and `wasm-unsafe-eval`, never `unsafe-eval`.
- Background services accept messages only from this extension's own contexts
  and validate payload types and sizes. The export service derives the export
  URL from the sender tab's own address and never fetches a caller-supplied URL;
  export sessions are bound to that tab.
- The common OCR admission path must enforce 1600px and 2,560,000 pixels before
  segmentation and recognition. Bound enhanced/padded images too. Never use
  fractional enlargement of screenshots; reduce oversized inputs when needed.
- OCR jobs share a serialized worker queue; reset PSM in finally blocks and
  release the worker after 60 idle seconds. Do not terminate an active job.
- Cache at most 60 previews, each at most 256px. Close decoded originals after
  resizing and close cached bitmaps on eviction. Use four concurrent fetches.
- Crop selection updates use requestAnimationFrame and cancel pending updates on
  cleanup. Release temporary canvas buffers. Preserve the existing 18px crop buffer.
- A stale selection resolution must not replace a newer selection. Ambiguous or
  tainted image matches must fail closed instead of copying the wrong image.
- Start the bounded resource observer at bootstrap, without fetching images or
  starting OCR. Preserve its document scope through the first discovery query.
- Preview-owned keyboard events must not clear the underlying selection.
  Arrow-key movement repositions actions; offscreen images hide their actions
  until they return. Observe selected source replacement/removal, and cancel
  both selection animation frames before they can consume a newer pointer.
- Text cleanup is conservative: drop lines without letters or digits, join
  spaces between CJK characters, rejoin a space-split URL scheme ("https: //"),
  and fix o/O/l/I only inside numeric tokens.
  Never add dictionaries, context rewrites or date/number guessing; correct text
  must come out unchanged (see tests/unit/text-cleaner.test.mjs). Protect light
  document backgrounds from inversion.
- OCR uses only the offscreen Tesseract path. Report failures; never substitute
  other text (alt text, titles) for recognition results.
- Every user-visible string lives in both `_locales/en` and `_locales/zh_TW`
  with identical keys and placeholders. The extension name must not contain
  Google trademarks.

## Build and verification

Use Node 22+ for development. Run `npm ci --ignore-scripts`. `npm run build`
rebuilds generated `dist/` and icon `assets/` from source and fixed dependencies;
do not edit those outputs directly. The build may clear only those exact generated
directories (and `dist.next/`) after validating they are direct children of this repo.
`dist/` is not committed; `assets/` is, and CI fails if it differs from a fresh
build. `npm run build:dev` adds a page-driven test bridge (src/content/dev-bridge.js)
for driving a loaded unpacked build; `scripts/verify-package.mjs` rejects any
publication ZIP that contains it.

For meaningful changes, run `npm test` (builds first), `npm run check-syntax`, and
`npm run test:browser`. Local browser tests use installed Chrome; CI installs
Playwright Chromium. Browser tests use synthetic pages/local assets, never private
Google documents. Use `npm run build:zip` to generate and verify the publication
ZIP in `build/`; do not manually ZIP the whole repo or bypass the allowlist.

Tests should exercise actual exported behavior, not recreate an LRU or matching
algorithm inside the test. Callback-style Chrome mocks must call the callback.
Distinguish mock tests, real browser tests and real Google document acceptance.
Extension-loading browser tests use `tests/browser/extension-context.cjs`:
Playwright Chromium by default, or the executable in `IMGLOUPE_CHROME`, with an
isolated temporary profile and a zh-TW UI (ui-language.spec.cjs checks real
Chrome i18n for zh-TW, en-US, zh-CN and ja). They verify native image/text
clipboard output, byte-exact single/ZIP downloads, Office-export ZIP and its
fallback, and full/snippet OCR for all three application routes.

## Publication

Obtain third-party packages from official fixed sources with notices. Keep
`PRIVACY.md` (English and Traditional Chinese) synchronized with actual behavior.
Store publication and GitHub releases are separate actions from local changes.
To release, bump the version in `manifest.json`, `package.json` and
`package-lock.json`, merge to main, then run the Release workflow from the Actions
tab. It tags `v<version>`, runs every test, and attaches the store ZIP and its
SHA-256. Upload that exact ZIP to the Chrome Web Store.
