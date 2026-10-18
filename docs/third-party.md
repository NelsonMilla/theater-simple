# Third-party components

| Component | Pinned version | Distribution and license |
| --- | --- | --- |
| Node.js | 24.19.0 | [Official Windows ZIP](https://nodejs.org/dist/v24.19.0/); MIT and bundled notices in `licenses/Node-LICENSE.txt`. |
| Electron | 44.9.0 | [Official release](https://github.com/electron/electron/releases/tag/v44.9.0); MIT in `licenses/Electron-LICENSE.txt`, Chromium notices retained in the generated runtime directory. |
| ws | 8.22.0 | Locked npm package; MIT license retained in `node_modules/ws/LICENSE` in releases. |
| PDF.js / pdfjs-dist | 6.4.299 | Locked npm package; Apache-2.0 plus component notices. See `licenses/PDFJS-LICENSE.txt` and `licenses/PDFJS-NOTICE.txt`. |

The PDF.js setup script copies `legacy/build/pdf.min.mjs` to `public/vendor/pdfjs/pdf.js` and its worker to `pdf.worker.js`, retaining their bytes. It also copies `cmaps`, `standard_fonts`, `wasm`, `iccs`, and their license files. These generated files are excluded from Git and included in release ZIPs.

Pinned runtime archive hashes are in `scripts/runtime-versions.json` and were checked against each vendor's official SHA-256 checksum file. npm package integrity values are recorded in `package-lock.json`.

No Microsoft PowerPoint, Zoom, Soniox account, credentials, or proprietary presentation files are distributed with the source repository.
