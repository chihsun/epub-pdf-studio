# qpdf WebAssembly source and distribution record

- Published runtime: [`@neslinesli93/qpdf-wasm` 0.3.0](https://www.npmjs.com/package/@neslinesli93/qpdf-wasm/v/0.3.0), package metadata license: ISC; see `QPDF-WASM-PACKAGE-LICENSE.txt` for the wrapper license text.
- Package tarball SHA-1: `fc32b0ef137f178d23e97f7ccca8285170165bd4`.
- Package tarball npm SHA-512 integrity: `sha512-ObyTmabopTMwN6AGwrEkmDbdmM5wnwlRdn9jnJYQ2KbBUPdPDcfNf1QkcWFOVD+qIgSqILz9nK51e22T+x+gkQ==`.
- Runtime package source: [`neslinesli93/qpdf-wasm` commit `e661db2d17e391a9fbe6b350b4ea6dbd8c385891`](https://github.com/neslinesli93/qpdf-wasm/tree/e661db2d17e391a9fbe6b350b4ea6dbd8c385891), which contains the 0.3.0 version bump and reproducible Docker/build scripts.
- QPDF: version 12.2.0, source commit [`856d32c610334855d30e96d25eb5f9636fb62f08`](https://github.com/qpdf/qpdf/tree/856d32c610334855d30e96d25eb5f9636fb62f08), Apache License 2.0; see `QPDF-LICENSE.txt` and `QPDF-NOTICE.md`.
- zlib: source commit [`21767c654d31d2dccdde4330529775c6c5fd5389`](https://github.com/madler/zlib/tree/21767c654d31d2dccdde4330529775c6c5fd5389), zlib 1.2.12; see `ZLIB-NOTICE.txt`.
- libjpeg-turbo: source commit [`7aa2a898c564041a24b09d0a6e780aaa632d08d3`](https://github.com/ImageMagick/jpeg-turbo/tree/7aa2a898c564041a24b09d0a6e780aaa632d08d3); see `LIBJPEG-TURBO-LICENSE.md` and `LIBJPEG-IJG-LICENSE.txt`.
- Emscripten: version 3.1.74; see `EMSCRIPTEN-LICENSE.txt` for the MIT and University of Illinois/NCSA license texts.

The vendored runtime files are the package artifacts without modification:

| File | SHA-256 |
| --- | --- |
| `vendor/qpdf/qpdf.js` | `C0E8FE62E0C3385DD8CB5D6B613F74D87A4138A3A3343E2ADD45A067A14D0884` |
| `vendor/qpdf/qpdf.wasm` | `ABD933F4CCACE4F732999381B21AEC8B7E3726F18A5B167FAFD57F88DD440876` |

The qpdf WASM source build includes the separately licensed components above.
The app's worker and UI integration are project code; no Ghostscript binary or
Ghostscript-derived code is distributed.
