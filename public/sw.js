const CACHE = "vesper-shell-v29-reconciled-memory";
const SHELL = [
  "./",
  "./manifest.webmanifest?v=11",
  "./icon-192-20260907-moon-v1.png",
  "./icon-512-20260907-moon-v1.png",
  "./icon-maskable-512-20260907-moon-v1.png",
  "./apple-touch-icon-20260907-moon-v1.png",
  "./favicon-20260907-moon-v1.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("vesper-shell-") && key !== CACHE).map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // API and authenticated requests must never replay private or stale state.
  if (/\/api(?:\/|$)/.test(url.pathname) || request.headers.has("authorization")) return;
  const isNavigation = request.mode === "navigate" || request.destination === "document";
  const isStatic = ["style", "script", "image", "font", "manifest"].includes(request.destination);
  if (!isNavigation && !isStatic) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request, isNavigation ? { cache: "no-store" } : undefined);
      const cacheControl = response.headers.get("cache-control") || "";
      if (response.ok && response.type !== "opaque" && !/no-store|private/i.test(cacheControl)) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {}));
      }
      return response;
    } catch {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      if (isNavigation) {
        const shell = await cache.match("./");
        if (shell) return shell;
      }
      return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const home = new URL('./', self.registration.scope);
        let target = home;
        try {
          const requested = new URL(event.notification.data?.url || './', home);
          if (requested.origin === home.origin) target = requested;
        } catch {}
        const existing = windows.find(window => new URL(window.url).origin === home.origin);
        if (!existing) return self.clients.openWindow(target.href);
        // Route Desire without reloading a running conversation or playback session.
        if (target.searchParams.get('section') === 'chat') existing.postMessage({type:'vesper-open-section',section:'chat',conversationId:target.searchParams.get('conversation')});
        if (target.searchParams.get('section') === 'desire') existing.postMessage({ type: 'vesper-open-section', section: 'desire' });
        return existing.focus();
      }),
  );
});

self.addEventListener("push", (event) => {
  let payload = { title: "Vesper", body: "You have a new message", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192-20260907-moon-v1.png",
      badge: "/favicon-20260907-moon-v1.png",
      tag: payload.tag || "vesper",
      data: { url: payload.url || "/" },
    }),
  );
});
