/* Versioned app shell and local-only dependencies; prior caches are retained. */
const CACHE='epub-pdf-studio-v1.4.3';
const ASSETS=['./','./index.html','./styles.css','./theme.css','./optimizer.css','./theme.js','./app.js','./epub-reader.js','./pdf-engine.js','./quality-presets.js','./pdf-optimizer.js','./pdf-optimizer.worker.js','./vendor/jszip.min.js','./vendor/qpdf/qpdf.js','./vendor/qpdf/qpdf.wasm','./fonts/reading-ming.ttf','./assets/icon.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(hit=>hit||fetch(event.request)));
});
