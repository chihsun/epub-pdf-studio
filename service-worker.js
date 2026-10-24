/* App shell and local-only dependencies cached on first online install. */
const CACHE='epub-pdf-studio-v1.1.0';
const ASSETS=['./','./index.html','./styles.css','./app.js','./epub-reader.js','./pdf-engine.js','./vendor/jszip.min.js','./fonts/reading-ming.ttf','./assets/icon.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()]));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request)));
});
