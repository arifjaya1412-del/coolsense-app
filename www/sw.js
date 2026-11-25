// Menyimpan tampilan aplikasi agar cepat dibuka. Data Firebase tetap diambil langsung.
const CACHE = "coolsense-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "index.html", "assets/app.js", "assets/app.css", "manifest.webmanifest"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const salin = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, salin));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
