self.addEventListener("push", (event) => {
  let data = { title: "Rowan", body: "", url: "/signal", tag: "rowan-signal" };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { /* Ignore malformed payloads. */ }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if ("focus" in client) { client.navigate(event.notification.data?.url ?? "/signal"); return client.focus(); }
    }
    return self.clients.openWindow(event.notification.data?.url ?? "/signal");
  }));
});
