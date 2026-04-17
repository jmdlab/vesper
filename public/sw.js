const CACHE_NAME = 'vesper-v1'

const APP_SHELL = [
  '/',
  '/home',
  '/breathe',
  '/meditate',
  '/sleep',
  '/settings',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
]

// Install — cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  )
  self.skipWaiting()
})

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  )
  self.clients.claim()
})

// Fetch — strategy per request type
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests
  if (request.method !== 'GET') return

  // Skip cross-origin requests (e.g. Google Fonts CDN, analytics)
  if (url.origin !== self.location.origin) return

  // JSON data files (search-index, book data) — network-first
  if (url.pathname.endsWith('.json') && url.pathname !== '/manifest.json') {
    event.respondWith(networkFirst(request))
    return
  }

  // Static assets (images, fonts, audio) — cache-first
  if (
    url.pathname.match(/\.(png|jpg|jpeg|svg|webp|ico|woff2?|ttf|otf|mp3|ogg|wav)$/)
  ) {
    event.respondWith(cacheFirst(request))
    return
  }

  // App shell (HTML, CSS, JS) — cache-first with network update
  event.respondWith(cacheFirst(request))
})

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    // Offline fallback — return whatever we have or a basic offline response
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
  }
}
