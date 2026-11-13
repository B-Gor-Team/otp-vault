// @vitest-environment node

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import vm from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)))
})

describe('dev service worker', () => {
  it('claims clients on install and caches same-origin responses', async () => {
    const worker = loadWorker('https://phone.local')
    worker.listeners.get('install')?.()
    expect(worker.skipped).toBe(true)

    const waits: Promise<unknown>[] = []
    worker.listeners.get('activate')?.({
      waitUntil(task: Promise<unknown>) {
        waits.push(task)
      },
    })
    await Promise.all(waits)
    expect(worker.claimed).toBe(true)

    worker.network.fetch = async () =>
      new Response('export {}', { status: 200, headers: { 'Content-Type': 'text/javascript' } })

    const response = await dispatch(
      worker,
      new Request('https://phone.local/src/main.tsx'),
    )
    expect(await response?.text()).toBe('export {}')
    expect(worker.puts.map((put) => put.url)).toEqual(['https://phone.local/src/main.tsx'])

    worker.network.fetch = () => new Promise(() => {})
    worker.timers.expireImmediately = true
    const cached = await dispatch(worker, new Request('https://phone.local/src/main.tsx'))
    expect(await cached?.text()).toBe('export {}')
  })

  it('serves the cached start url when a navigation times out', async () => {
    const worker = loadWorker('https://phone.local')
    worker.network.fetch = async () =>
      new Response('<!doctype html><title>Meridian</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })

    await dispatch(worker, navigation('https://phone.local/today'))
    expect(worker.puts.map((put) => put.url)).toEqual([
      'https://phone.local/today',
      'https://phone.local/',
    ])

    worker.network.fetch = () => new Promise(() => {})
    worker.timers.expireImmediately = true
    const offline = await dispatch(worker, navigation('https://phone.local/later'))
    expect(await offline?.text()).toContain('Meridian')
  })

  it('stores a redirected navigation without the redirect flag', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/go') {
        res.writeHead(302, { Location: '/landed' })
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<!doctype html><title>Meridian</title>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    servers.push(server)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing port')
    const origin = `http://127.0.0.1:${address.port}`
    const worker = loadWorker(origin)

    const response = await dispatch(worker, navigation(`${origin}/go`))
    expect(response?.redirected).toBe(false)
    expect(await response?.text()).toContain('Meridian')
    expect(worker.puts.every((put) => put.response.redirected === false)).toBe(true)
    expect(worker.puts.map((put) => put.url)).toEqual([`${origin}/go`, `${origin}/`])
  })

  it('ignores non-GET and other origins, and answers a miss with 503', async () => {
    const worker = loadWorker('https://phone.local')
    worker.network.fetch = async () => new Response('nope', { status: 404 })

    expect(await dispatch(worker, new Request('https://phone.local/save', { method: 'POST' }))).toBeUndefined()
    expect(await dispatch(worker, new Request('https://cdn.example/app.js'))).toBeUndefined()

    const missing = await dispatch(worker, new Request('https://phone.local/missing.js'))
    expect(missing?.status).toBe(404)
    expect(worker.puts).toHaveLength(0)

    worker.network.fetch = () => new Promise(() => {})
    worker.timers.expireImmediately = true
    const offline = await dispatch(worker, navigation('https://phone.local/'))
    expect(offline?.status).toBe(503)
    expect(await offline?.text()).toBe('Offline')
  })
})

type WorkerEvent = {
  request?: Request
  respondWith?(value: Promise<Response>): void
  waitUntil?(task: Promise<unknown>): void
}

function loadWorker(origin: string) {
  const puts: { url: string; response: Response }[] = []
  const store = new Map<string, Response>()
  const listeners = new Map<string, (event?: WorkerEvent) => void>()
  const network = {
    fetch: globalThis.fetch.bind(globalThis),
  }
  const timers = { expireImmediately: false }
  let skipped = false
  let claimed = false
  const self = {
    location: { origin },
    addEventListener(type: string, listener: (event?: WorkerEvent) => void) {
      listeners.set(type, listener)
    },
    skipWaiting() {
      skipped = true
    },
    clients: {
      claim() {
        claimed = true
        return Promise.resolve()
      },
    },
  }
  const caches = {
    async open() {
      return {
        async put(url: string, response: Response) {
          puts.push({ url, response: response.clone() })
          store.set(url, response.clone())
        },
      }
    },
    async match(url: string) {
      return store.get(url)?.clone()
    },
  }
  const sandbox = {
    self,
    caches,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => network.fetch(input, init)) as typeof fetch,
    Response,
    Request,
    URL,
    Headers,
    Promise,
    Error,
    console,
    setTimeout(handler: () => void, ms?: number) {
      if (timers.expireImmediately) {
        handler()
        return 0
      }
      return setTimeout(handler, ms)
    },
    clearTimeout,
  }
  vm.createContext(sandbox)
  vm.runInContext(readFileSync('src/pwa/dev-sw.js', 'utf8'), sandbox, {
    filename: 'dev-sw.js',
  })
  return {
    listeners,
    network,
    timers,
    puts,
    get skipped() {
      return skipped
    },
    get claimed() {
      return claimed
    },
  }
}

async function dispatch(worker: ReturnType<typeof loadWorker>, request: Request) {
  let response: Promise<Response> | undefined
  worker.listeners.get('fetch')?.({
    request,
    respondWith(value) {
      response = value
    },
    waitUntil() {},
  })
  return response
}

function navigation(url: string): Request {
  const request = new Request(url)
  Object.defineProperty(request, 'mode', { value: 'navigate' })
  return request
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
