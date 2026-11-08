/* Cache offline da interface — não intercepta APIs nem áudio externo. */
const CACHE='aclfuture-music-shell-v16';
const SHELL=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./assets/brand-mark.png','./assets/icon-192.png','./assets/icon-512.png','./assets/aclfuture-oficial.jpg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('aclfuture-music-shell-')&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET')return;
 const url=new URL(req.url);if(url.origin!==self.location.origin)return;
 if(req.mode==='navigate'){event.respondWith(fetch(req).catch(()=>caches.match('./index.html')));return}
 event.respondWith(caches.match(req).then(cached=>cached||fetch(req)));
});
