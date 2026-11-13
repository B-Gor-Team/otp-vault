// @vitest-environment node

import { X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureDevCert,
  lanHosts,
  phoneInstructions,
  startCertificateServer,
} from '../../scripts/dev-certs.ts'

const servers: Server[] = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)))
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('lan hosts', () => {
  it('keeps localhost and external IPv4 addresses', () => {
    expect(
      lanHosts({
        lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as never],
        en0: [
          { address: '10.55.189.7', family: 'IPv4', internal: false } as never,
          { address: 'fe80::1', family: 'IPv6', internal: false } as never,
        ],
        blank: undefined,
      }),
    ).toEqual(['localhost', '127.0.0.1', '10.55.189.7'])
  })
})

describe('phone instructions', () => {
  it('points Safari at the LAN address', () => {
    expect(phoneInstructions(['localhost', '127.0.0.1', '10.55.189.7'])).toBe(
      [
        'iPhone offline install:',
        '1. In Safari open http://10.55.189.7:4730/ca.crt and install the profile.',
        '2. Settings → General → About → Certificate Trust Settings → enable full trust for this CA.',
        '3. Open https://10.55.189.7:4731 once, then Share → Add to Home Screen.',
        '4. Delete the old http:// Home Screen icon. Open the new icon once online, then try airplane mode.',
      ].join('\n'),
    )
  })

  it('falls back to loopback when the machine has no LAN address', () => {
    expect(phoneInstructions(['localhost', '127.0.0.1'])).toContain(
      'http://127.0.0.1:4730/ca.crt',
    )
  })
})

describe('development certificate', () => {
  it('covers the requested hosts and reuses the CA when an address changes', async () => {
    const dir = await makeDir()
    const hosts = ['localhost', '127.0.0.1', '10.55.189.70']
    const first = await ensureDevCert(dir, hosts)

    expect(subjectNames(first.cert.toString('utf8'))).toEqual(
      expect.arrayContaining(hosts),
    )
    expect(subjectNames(first.cert.toString('utf8'))).not.toContain('10.55.189.7')

    const again = await ensureDevCert(dir, hosts)
    expect(again.cert.toString('utf8')).toBe(first.cert.toString('utf8'))

    const ca = await readFile(path.join(dir, 'ca.crt'), 'utf8')
    await writeFile(path.join(dir, 'cert.crt'), 'not a certificate')
    const reissued = await ensureDevCert(dir, ['localhost', '10.55.189.7'])

    expect(reissued.cert.toString('utf8')).not.toBe(first.cert.toString('utf8'))
    expect(subjectNames(reissued.cert.toString('utf8'))).toEqual(
      expect.arrayContaining(['localhost', '10.55.189.7']),
    )
    expect(await readFile(path.join(dir, 'ca.crt'), 'utf8')).toBe(ca)
  })
})

describe('certificate download', () => {
  it('serves the CA and nothing else', async () => {
    const caCert = Buffer.from('meridian-ca')
    const server = await startCertificateServer(caCert, 0)
    servers.push(server)
    const port = listenPort(server)

    const cert = await fetch(`http://127.0.0.1:${port}/ca.crt?download=1`)
    expect(cert.status).toBe(200)
    expect(cert.headers.get('content-type')).toBe('application/x-x509-ca-cert')
    expect(Buffer.from(await cert.arrayBuffer())).toEqual(caCert)

    const missing = await fetch(`http://127.0.0.1:${port}/other`)
    expect(missing.status).toBe(404)
  })
})

function subjectNames(pem: string): string[] {
  const san = new X509Certificate(pem).subjectAltName ?? ''
  return san
    .split(',')
    .map((part) => part.trim().split(':').slice(1).join(':'))
    .filter(Boolean)
}

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'meridian-certs-'))
  dirs.push(dir)
  return dir
}

function listenPort(server: Server): number {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  return address.port
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
