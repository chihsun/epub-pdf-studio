/* Versioned app shell and local-only dependencies; prior caches are retained. */
importScripts('./pdfjs-assets.js');
const CACHE='epub-pdf-studio-v1.7.8';
const ASSETS=['./','./index.html','./styles.css','./theme.css','./optimizer.css','./theme.js','./app.js','./pdf-metadata.js','./pdf-metadata.worker.js','./pdf-security.js','./pdf-security.worker.js','./font-options.js','./font-formats.js','./vendor/woff2-encoder/decompress.js','./epub-reader.js','./epub-image-optimizer.js','./pdf-engine.js','./quality-presets.js','./pdf-optimizer.js','./pdf-optimizer.worker.js','./vendor/jszip.min.js','./vendor/qpdf/qpdf.js','./vendor/qpdf/qpdf.wasm','./fonts/reading-ming.ttf','./assets/icon.svg','./manifest.webmanifest'];
ASSETS.push('./pdf-rasterizer.js','./pdfjs-assets.js',...self.PDFJS_ASSETS);
self.addEventListener('install',event=>{
  const assets=ASSETS.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'}));
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(assets)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(hit=>hit||fetch(event.request)));
});
