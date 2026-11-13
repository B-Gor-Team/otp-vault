import { readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { PreviewServer, ViteDevServer } from 'vite'
import { defineConfig, type Plugin } from 'vitest/config'
import {
  ensureDevCert,
  lanHosts,
  phoneInstructions,
  startCertificateServer,
} from './scripts/dev-certs.ts'

const devServiceWorker = readFileSync(
  fileURLToPath(new URL('./src/pwa/dev-sw.js', import.meta.url)),
  'utf8',
)

function devServiceWorkerPlugin(): Plugin {
  return {
    name: 'meridian-dev-sw',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url !== '/sw.js') {
          next()
          return
        }
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(devServiceWorker)
      })
    },
  }
}

function phoneCertificatePlugin(hosts: string[], caCert: Buffer): Plugin {
  return {
    name: 'meridian-phone-ca',
    async configureServer(server) {
      await attachCertificateServer(server, hosts, caCert)
    },
    async configurePreviewServer(server) {
      await attachCertificateServer(server, hosts, caCert)
    },
  }
}

async function attachCertificateServer(
  server: ViteDevServer | PreviewServer,
  hosts: string[],
  caCert: Buffer,
) {
  const certificateServer = await startCertificateServer(caCert, 4730)
  server.httpServer?.once('listening', () => {
    console.log(`\n${phoneInstructions(hosts)}\n`)
  })
  server.httpServer?.once('close', () => {
    certificateServer.close()
  })
}

function normalizeBase(base: string): string {
  const trimmed = base.trim()
  if (trimmed === '' || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`
}

export default defineConfig(async () => {
  const phone = process.env.MERIDIAN_HTTPS === '1'
  const hosts = lanHosts(networkInterfaces())
  const https = phone
    ? await ensureDevCert(fileURLToPath(new URL('./.certs', import.meta.url)), hosts)
    : undefined

  return {
    // Root by default (office host, dev, preview). GitHub Pages builds pass
    // MERIDIAN_BASE=/otp-vault/ so the app can live under a project sub-path.
    base: normalizeBase(process.env.MERIDIAN_BASE ?? '/'),
    plugins: [
      react(),
      tailwindcss(),
      devServiceWorkerPlugin(),
      ...(https ? [phoneCertificatePlugin(hosts, https.caCert)] : []),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 4731,
      strictPort: true,
      ...(https ? { https: { key: https.key, cert: https.cert } } : {}),
    },
    preview: {
      host: '0.0.0.0',
      port: 4731,
      strictPort: true,
      ...(https ? { https: { key: https.key, cert: https.cert } } : {}),
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: true,
      coverage: {
        provider: 'v8' as const,
        reporter: ['text', 'lcov'] as ('text' | 'lcov')[],
        include: ['src/lib/**/*.ts', 'src/pwa/**/*.ts'],
        exclude: ['src/lib/utils.ts', 'src/**/*.test.ts'],
        thresholds: {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },
      },
    },
  }
})
