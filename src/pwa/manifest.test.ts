// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('installable web app manifest', () => {
  it('declares a standalone app with 192 and 512 icons on disk', () => {
    const manifest = JSON.parse(
      readFileSync('public/manifest.webmanifest', 'utf8'),
    ) as {
      id: string
      name: string
      short_name: string
      start_url: string
      scope: string
      display: string
      background_color: string
      theme_color: string
      icons: { src: string; sizes: string; type: string; purpose?: string }[]
    }

    expect(manifest.name).toBe('Meridian')
    expect(manifest.short_name).toBe('Meridian')
    expect(manifest.id).toBe('./')
    expect(manifest.start_url).toBe('./')
    expect(manifest.scope).toBe('./')
    expect(manifest.display).toBe('standalone')
    expect(manifest.background_color).toBe('#07110c')
    expect(manifest.theme_color).toBe('#07110c')

    // Relative URLs resolve against the manifest's own directory, so one file
    // serves both the root deployment and a project sub-path such as
    // https://b-gor-team.github.io/otp-vault/.
    const at = (origin: string, basePath: string) =>
      new URL(manifest.start_url, `${origin}${basePath}manifest.webmanifest`).pathname
    expect(at('https://desktop-e4crapg.local', '/')).toBe('/')
    expect(at('https://b-gor-team.github.io', '/otp-vault/')).toBe('/otp-vault/')
    expect(new URL(manifest.scope, 'https://b-gor-team.github.io/otp-vault/manifest.webmanifest').pathname)
      .toBe('/otp-vault/')

    const sizes = manifest.icons.map((icon) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)

    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png')
      expect(icon.src.startsWith('/')).toBe(false)
      expect(existsSync(`public/${icon.src}`)).toBe(true)
    }
    expect(existsSync('public/apple-touch-icon.png')).toBe(true)
    expect(existsSync('public/favicon.svg')).toBe(true)
  })
})
