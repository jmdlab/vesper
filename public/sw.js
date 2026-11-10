// v3 (2026-11-10): audio no longer goes through the SW; bumping the name drops any audio v1/v2 held.
// v2 (2026-11-10): pages became network-first; bumping the name purges HTML cached cache-first by v1.
const CACHE_NAME = 'vesper-v3'

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
    event.respondWith(networkFirst(event, request))
    return
  }

  // Audio — left to the browser: players ask for byte ranges (206), which cache.put rejects, and a cached whole file
  // served to a range request breaks playback in Safari. (Offline audio never worked through this SW.)
  if (url.pathname.match(/\.(mp3|ogg|wav|m4a)$/)) return

  // Static assets (images, fonts) — cache-first
  if (
    url.pathname.match(/\.(png|jpg|jpeg|svg|webp|ico|woff2?|ttf|otf)$/)
  ) {
    event.respondWith(cacheFirst(event, request))
    return
  }

  // Pages (HTML navigations) — network-first so a deploy reaches returning visitors; the cache is the offline fallback
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(event, request))
    return
  }

  // Hashed bundles (CSS, JS) — cache-first: a new deploy ships new file names
  event.respondWith(cacheFirst(event, request))
})

// Only whole 200 answers are stored, and the write is held by waitUntil so the worker is not stopped mid-write.
function store(event, request, response) {
  if (response.status !== 200) return
  const copy = response.clone()
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {}))
}

async function cacheFirst(event, request) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    store(event, request, response)
    return response
  } catch {
    // Offline fallback — return whatever we have or a basic offline response
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
  }
}

async function networkFirst(event, request) {
  try {
    const response = await fetch(request)
    if (response.status >= 500) { // server down: the cached copy is better than an error page
      const cached = await caches.match(request)
      if (cached) return cached
    }
    store(event, request, response)
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
  }
}
