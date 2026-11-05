// Service worker: guarda a "casca" do app para abrir offline. Dados das APIs nunca são cacheados aqui.
const VERSION = "intelinvest-v8";
const SHELL = ["./", "index.html", "styles.css", "app.js", "analise.js", "auth.js", "donate.js", "pix.js", "vendor/qrcode.js", "config.js", "termos.html", "privacidade.html", "icon.svg", "icon-192.png", "icon-512.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // APIs externas: direto na rede
  // rede primeiro (pega atualizações do app), cache como reserva offline
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match("index.html")))
  );
});
