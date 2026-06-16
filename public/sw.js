const CACHE_NAME = "pips-v0.9.1";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/pwa/icon.svg", "/pwa/maskable-icon.svg", "/pwa/apple-touch-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.protocol.startsWith("ws")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/").then((response) => response || offlineResponse()))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => offlineResponse());
    })
  );
});

function offlineResponse() {
  return new Response(
    `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#24140d" />
        <title>You have left the tavern</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 24px;
            color: #fff3d0;
            font-family: Georgia, serif;
            background: radial-gradient(circle at 50% 20%, rgba(242, 204, 98, 0.22), transparent 260px), linear-gradient(135deg, #120e0a, #392013);
          }
          main {
            max-width: 520px;
            padding: 28px;
            border: 1px solid rgba(242, 204, 98, 0.42);
            border-radius: 8px;
            background: linear-gradient(180deg, rgba(68, 39, 22, 0.94), rgba(31, 19, 12, 0.96));
            box-shadow: 0 24px 50px rgba(0, 0, 0, 0.42);
            text-align: center;
          }
          h1 { margin: 0 0 12px; font-size: clamp(2rem, 8vw, 3.6rem); line-height: 1; }
          p { margin: 0; color: #d6bc83; font-family: system-ui, sans-serif; line-height: 1.5; }
        </style>
      </head>
      <body>
        <main>
          <h1>You have left the tavern</h1>
          <p>The multiplayer table needs a live connection. Reconnect to return to the game.</p>
        </main>
      </body>
    </html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
