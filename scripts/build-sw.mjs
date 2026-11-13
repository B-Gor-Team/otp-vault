import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { copyWorkboxLibraries, injectManifest } from 'workbox-build'

export async function buildServiceWorker({ globDirectory, swDest }) {
  const workboxDirectory = await copyWorkboxLibraries(globDirectory)
  const template = await readFile(new URL('../src/pwa/sw.js', import.meta.url), 'utf8')
  const prefix = `./${workboxDirectory}`
  const swSrc = path.join(globDirectory, 'sw-src.js')
  await writeFile(swSrc, template.replaceAll('__WB_DIR__', prefix))
  try {
    return await injectManifest({
      swSrc,
      swDest,
      globDirectory,
      globPatterns: ['**/*.{html,js,css,svg,png,webmanifest,woff2,ico}'],
      globIgnores: ['**/node_modules/**/*', '**/workbox-v*/**', 'sw-src.js'],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    })
  } finally {
    await rm(swSrc, { force: true })
  }
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  const result = await buildServiceWorker({
    globDirectory: 'dist',
    swDest: 'dist/sw.js',
  })
  if (result.warnings.length > 0) console.warn(result.warnings.join('\n'))
  console.log(`Service worker precaches ${result.count} files (${result.size} bytes).`)
}
