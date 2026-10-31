# Third-party software and data

The root MIT license applies to this project's own code. It does not replace
the licenses of the dependencies below or grant rights to Google trademarks or
user documents.

| Component | Version | License | Source |
| --- | --- | --- | --- |
| Viewer.js | 1.11.6 | MIT, Chen Fengyuan | https://github.com/fengyuanchen/viewerjs/tree/v1.11.6 |
| JSZip | 3.10.1 | MIT option of the upstream dual license | https://github.com/Stuk/jszip/tree/v3.10.1 |
| Tesseract.js API and browser worker | 5.1.1 | Apache-2.0 | https://github.com/naptha/tesseract.js/tree/v5.1.1 |
| Tesseract.js core (LSTM and SIMD LSTM) | 5.1.1 | Apache-2.0 | https://github.com/naptha/tesseract.js-core/tree/v5.1.1 |
| English and Traditional Chinese fast models | 87416418657359cb625c412a48b6e1d6d41c29bd | Apache-2.0 | https://github.com/tesseract-ocr/tessdata_fast/tree/87416418657359cb625c412a48b6e1d6d41c29bd |

The build copies full upstream license/notice files into `dist/licenses/`,
including lockfile-resolved transitive runtime dependencies. The OCR bundle's
additional notices are also shipped beside `tesseract.min.js` and `worker.min.js`.
Those notices cover, among others, buffer, ieee754, regenerator-runtime and zlib.js.
JSZip's transitive packages retain their own license notices.

The OCR model gzip files are checked against the official pinned source; their
decompressed bytes must match these SHA-256 values at build time:

- `eng.traineddata`: `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`
- `chi_tra.traineddata`: `529c5b5797d64b126065cd55f2bb4c7fd7b15790798091b1ff259941a829330b`

Tesseract code, Viewer.js, JSZip and their licenses are bundled from the npm
packages resolved by `package-lock.json`. The app icon is the project's own
vector artwork in `src/branding/icon.svg`, rendered at build time.
