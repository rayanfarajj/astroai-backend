// portal-sw.js — Service Worker for Client Portal PWA v2
// Handles offline caching and push notifications

const CACHE = 'portal-v2';
const OFFLINE_URL = '/onboard/portal';

const PRECACHE = [
  '/onboard/portal',
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ───────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first, offline fallback ───────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/.netlify/')) return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response.ok && url.pathname.includes('portal')) {
          caches.open(CACHE).then(cache => cache.put(e.request, response.clone()));
        }
        return response;
      })
      .catch(() =>
        caches.match(e.request).then(cached => {
          if (cached) return cached;
          if (e.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL).then(c => c || new Response(
              '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:system-ui;background:#0a0e1a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}</style></head><body><div><div style="font-size:3rem">📡</div><h2>You\'re Offline</h2><p style="color:#8892a4">Your portal will load when you\'re back online.</p></div></body></html>',
              { headers: { 'Content-Type': 'text/html' } }
            ));
          }
          return new Response('Offline', { status: 503 });
        })
      )
  );
});

// ── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener('push', e => {
  // Default fallback data
  let title = 'Marketing Portal';
  let body  = 'You have a new update.';
  let url   = '/onboard/portal';
  let tag   = 'portal';
  let icon  = '/icons/portal-icon-192.png';

  // Parse payload from server (web-push decrypts it before we see it)
  if (e.data) {
    try {
      const d = e.data.json();
      title = d.title || title;
      body  = d.body  || body;
      url   = d.url   || url;
      tag   = d.tag   || tag;
      icon  = d.icon  || icon;
    } catch(err) {
      // If JSON parse fails try plain text
      try { body = e.data.text(); } catch(e2) {}
    }
  }

  // iOS-safe notification options — NO badge (file may not exist), NO actions (not supported)
  const options = {
    body,
    icon,
    tag,
    data: { url },
    renotify: true,
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification Click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/onboard/portal';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
