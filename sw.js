// Service worker : fonctionne hors connexion pour l'interface, jamais pour les données (Supabase).
const V = "v1", SHELL = "shell-" + V, IMG = "img-" + V;
self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/index.html", "/manifest.webmanifest", "/icon-192.png"]).catch(() => {}))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => ![SHELL, IMG].includes(x)).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET") return;
  if (/\/(rest|auth|functions|storage\/v1\/object\/(sign|authenticated))\//.test(u.pathname) || u.pathname.includes("/storage/v1/object/sign")) return; // données privées : jamais en cache
  if (r.mode === "navigate") { // pages : réseau d'abord, copie hors ligne en secours
    e.respondWith(fetch(r).then((res) => { caches.open(SHELL).then((c) => c.put("/index.html", res.clone())); return res; }).catch(() => caches.match("/index.html")));
    return;
  }
  if (r.destination === "image") { // photos : rapides, mises à jour en arrière-plan
    e.respondWith(caches.open(IMG).then(async (c) => { const hit = await c.match(r); const net = fetch(r).then((res) => { if (res.ok || res.type === "opaque") { c.put(r, res.clone()); } return res; }).catch(() => hit); return hit || net; }));
    return;
  }
  if (u.origin === location.origin) e.respondWith(fetch(r).then((res) => { if (res.ok) caches.open(SHELL).then((c) => c.put(r, res.clone())); return res; }).catch(() => caches.match(r)));
});
