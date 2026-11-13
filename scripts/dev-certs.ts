import { createCA, createCert, type Certificate } from 'mkcert'
import { X509Certificate } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { NetworkInterfaceInfo } from 'node:os'
import { join } from 'node:path'

const VALIDITY_DAYS = 825

export function lanHosts(
  interfaces: Partial<Record<string, NetworkInterfaceInfo[] | undefined>>,
): string[] {
  const hosts = new Set<string>(['localhost', '127.0.0.1'])
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) hosts.add(info.address)
    }
  }
  return [...hosts]
}

export function phoneInstructions(hosts: string[]): string {
  const ip = hosts.find((host) => host !== 'localhost' && host !== '127.0.0.1') ?? '127.0.0.1'
  return [
    'iPhone offline install:',
    `1. In Safari open http://${ip}:4730/ca.crt and install the profile.`,
    '2. Settings → General → About → Certificate Trust Settings → enable full trust for this CA.',
    `3. Open https://${ip}:4731 once, then Share → Add to Home Screen.`,
    '4. Delete the old http:// Home Screen icon. Open the new icon once online, then try airplane mode.',
  ].join('\n')
}

export async function ensureDevCert(
  dir: string,
  hosts: string[],
): Promise<{ key: Buffer; cert: Buffer; caCert: Buffer }> {
  await mkdir(dir, { recursive: true })
  const ca = await loadOrCreateCa(dir)
  const leaf = await loadOrCreateLeaf(dir, hosts, ca)
  return {
    key: Buffer.from(leaf.key),
    cert: Buffer.from(leaf.cert),
    caCert: Buffer.from(ca.cert),
  }
}

export function startCertificateServer(caCert: Buffer, port: number): Promise<Server> {
  const server = createServer((request, response) => {
    const url = request.url?.split('?')[0]
    if (url !== '/ca.crt') {
      response.statusCode = 404
      response.end('Not found')
      return
    }
    response.setHeader('Content-Type', 'application/x-x509-ca-cert')
    response.end(caCert)
  })
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => reject(error)
    server.once('error', fail)
    server.listen(port, '0.0.0.0', () => {
      server.off('error', fail)
      resolve(server)
    })
  })
}

async function loadOrCreateCa(dir: string): Promise<Certificate> {
  const existing = await readPair(join(dir, 'ca.key'), join(dir, 'ca.crt'))
  if (existing) return existing
  const created = await createCA({
    organization: 'Meridian Dev',
    countryCode: 'US',
    state: 'Local',
    locality: 'Local',
    validity: VALIDITY_DAYS,
  })
  await writeFile(join(dir, 'ca.key'), created.key)
  await writeFile(join(dir, 'ca.crt'), created.cert)
  return created
}

async function loadOrCreateLeaf(
  dir: string,
  hosts: string[],
  ca: Certificate,
): Promise<Certificate> {
  const existing = await readPair(join(dir, 'cert.key'), join(dir, 'cert.crt'))
  if (existing && certificateCovers(existing.cert, hosts)) return existing
  const created = await createCert({
    domains: hosts,
    validity: VALIDITY_DAYS,
    ca,
  })
  await writeFile(join(dir, 'cert.key'), created.key)
  await writeFile(join(dir, 'cert.crt'), created.cert)
  return created
}

function certificateCovers(certPem: string, hosts: string[]): boolean {
  try {
    const san = new X509Certificate(certPem).subjectAltName ?? ''
    const names = new Set(
      san
        .split(',')
        .map((part) => part.trim().split(':').slice(1).join(':'))
        .filter(Boolean),
    )
    return hosts.every((host) => names.has(host))
  } catch {
    return false
  }
}

async function readPair(keyPath: string, certPath: string): Promise<Certificate | null> {
  try {
    const [key, cert] = await Promise.all([
      readFile(keyPath, 'utf8'),
      readFile(certPath, 'utf8'),
    ])
    return { key, cert }
  } catch {
    return null
  }
}
