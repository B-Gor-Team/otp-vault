importScripts('__WB_DIR__/workbox-sw.js')

workbox.setConfig({
  modulePathPrefix: '__WB_DIR__/',
})

workbox.core.clientsClaim()
self.skipWaiting()
workbox.precaching.cleanupOutdatedCaches()
workbox.precaching.precache(self.__WB_MANIFEST)

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(handle(event.request))
})

async function handle(request) {
  if (request.mode === 'navigate') {
    // Resolve against the worker's scope so the shell is found at `/` and at
    // `/otp-vault/` alike.
    const cached = await workbox.precaching.matchPrecache(
      new URL('index.html', self.registration.scope).href,
    )
    if (cached) return fresh(cached)
    return fetch(request)
  }
  const cached = await workbox.precaching.matchPrecache(request.url)
  if (cached) return cached
  return fetch(request)
}

async function fresh(response) {
  const body = await response.arrayBuffer()
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
