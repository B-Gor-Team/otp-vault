// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildServiceWorker } from '../../scripts/build-sw.mjs'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('production service worker', () => {
  it('precaches the shell and rebuilds navigation responses', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'meridian-sw-'))
    dirs.push(dir)
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>Meridian</title>')
    await writeFile(path.join(dir, 'app.js'), 'export {}')
    await writeFile(path.join(dir, 'notes.txt'), 'skip')

    const swDest = path.join(dir, 'sw.js')
    await buildServiceWorker({ globDirectory: dir, swDest })
    const source = await readFile(swDest, 'utf8')

    expect(source).toContain('precache')
    expect(source).toContain('new Response')
    expect(source).toContain('matchPrecache')
    expect(source).not.toContain('self.__WB_MANIFEST')
    expect(source).not.toContain('navigateFallback')
    expect(source).toContain('index.html')
    expect(source).toContain('app.js')
    expect(source).not.toContain('notes.txt')
    expect(source).not.toContain('"url":"workbox-v')
    // Workbox must load from a path relative to the worker, so the same build
    // works at `/` and at a project sub-path.
    expect(source).toContain("'./workbox-v")
    expect(source).not.toContain("'/workbox-v")
    expect(source).toContain('self.registration.scope')
    expect(source).not.toContain("matchPrecache('/index.html')")
  })
})
