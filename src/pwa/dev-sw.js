const NETWORK_TIMEOUT_MS = 3000

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  event.respondWith(fromNetworkOrCache(event.request))
})

async function fromNetworkOrCache(request) {
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS)
    if (response.ok) await remember(request, response)
    return response.redirected ? await detach(response) : response
  } catch {
    const cached = await cachedShell(request)
    if (cached) return cached
    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    fetch(request).then(
      (response) => {
        clearTimeout(timer)
        resolve(response)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function remember(request, response) {
  const cache = await caches.open('meridian-dev')
  const stored = response.redirected ? await detach(response) : response.clone()
  await cache.put(request.url, stored.clone())
  if (request.mode === 'navigate') {
    await cache.put(new URL('/', request.url).href, stored.clone())
  }
}

async function detach(response) {
  const body = await response.clone().arrayBuffer()
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  })
}

async function cachedShell(request) {
  if (request.mode === 'navigate') {
    const shell = await caches.match(new URL('/', request.url).href)
    if (shell) return shell
  }
  return caches.match(request.url)
}
