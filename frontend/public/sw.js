const CACHE = "mirai-shell-v1";
const SHELL = "/__shell";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/ws") return;

  const key = request.mode === "navigate" ? SHELL : request;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then(cache => cache.put(key, copy)));
        }
        return response;
      })
      .catch(() => caches.match(key).then(hit => hit ?? Response.error())),
  );
});
