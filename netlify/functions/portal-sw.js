// portal-sw.js — Service Worker for Client Portal PWA
// Handles offline caching and push notifications

const CACHE = 'portal-v1';
const OFFLINE_URL = '/onboard/portal';

// Assets to cache immediately on install
const PRECACHE = [
  '/onboard/portal',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap',
];

// ── Install: precache shell ──────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ───────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first with offline fallback ───────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET and API calls (always network)
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/.netlify/')) return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Cache successful responses for the portal
        if (response.ok && (url.pathname.includes('portal') || url.pathname.includes('onboard'))) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline — return cached version
        return caches.match(e.request).then(cached => {
          if (cached) return cached;
          // Return the portal shell for navigation requests
          if (e.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL).then(c => c || new Response(
              '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><style>body{font-family:system-ui,sans-serif;background:#0a0e1a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}.box{padding:40px}.icon{font-size:3rem;margin-bottom:16px}.title{font-size:1.3rem;font-weight:700;margin-bottom:8px}.sub{color:#8892a4;font-size:.9rem}</style></head><body><div class="box"><div class="icon">📡</div><div class="title">You\'re Offline</div><div class="sub">Your plan and files will load when you\'re back online.</div></div></body></html>',
              { headers: { 'Content-Type': 'text/html' } }
            ));
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// ── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'Marketing Portal', body: 'You have a new update.', icon: '/icons/portal-icon-192.png' };
  try { data = { ...data, ...e.data.json() }; } catch(err) {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:  data.body,
      icon:  data.icon || '/icons/portal-icon-192.png',
      badge: '/icons/portal-badge-96.png',
      tag:   data.tag || 'portal-notification',
      data:  { url: data.url || '/onboard/portal' },
      requireInteraction: data.requireInteraction || false,
      actions: data.actions || [
        { action: 'view', title: 'View Now' },
        { action: 'dismiss', title: 'Dismiss' }
      ],
    })
  );
});

// ── Notification Click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/onboard/portal';

  if (e.action === 'dismiss') return;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes('portal') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Background Sync (for offline message sending) ────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'send-message') {
    e.waitUntil(syncPendingMessages());
  }
});

async function syncPendingMessages() {
  try {
    const cache = await caches.open(CACHE);
    const req = await cache.match('pending-messages');
    if (!req) return;
    const messages = await req.json();
    for (const msg of messages) {
      await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });
    }
    await cache.delete('pending-messages');
  } catch(e) {
    console.log('[SW] Sync failed:', e.message);
  }
}
