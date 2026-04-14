/**
 * Minimal service worker for PWA installability.
 *
 * Intentionally does NOT cache app assets — this app is data-driven and
 * requires fresh content on every load (Supabase queries, edge functions,
 * real-time AI responses). Caching stale JS/CSS would silently break features.
 *
 * Its only job is to exist so browsers mark the app as installable.
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Network-only: always hit the network, never serve from cache.
self.addEventListener('fetch', (event) => {
  // Let the browser handle it normally. No caching.
});
