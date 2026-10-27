# qpdf WebAssembly runtime

These local files are the `dist/qpdf.js` and `dist/qpdf.wasm` artifacts from
`@neslinesli93/qpdf-wasm` 0.3.0. They are loaded only from this repository and
run inside `pdf-optimizer.worker.js`; conversion does not contact a remote API.

The package build pins QPDF 12.2.0, zlib, libjpeg-turbo, and Emscripten. Exact
source revisions, package integrity, artifact SHA-256 hashes, and component
license files are recorded in [`../../licenses/QPDF-WASM-SOURCES.md`](../../licenses/QPDF-WASM-SOURCES.md).
