import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerServiceWorker } from './register.ts'

afterEach(() => {
  sessionStorage.removeItem('meridian.sw.reload')
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('registerServiceWorker', () => {
  it('does nothing when the browser has no service worker', () => {
    expect(() => registerServiceWorker()).not.toThrow()
  })

  it('registers /sw.js immediately and ignores a blocked worker', async () => {
    const register = vi.fn().mockRejectedValue(new Error('blocked'))
    installWorker({ register, controller: {} })

    registerServiceWorker()
    await Promise.resolve()

    expect(register).toHaveBeenCalledWith('/sw.js')
    await expect(register.mock.results[0]?.value).rejects.toThrow('blocked')
  })

  it('registers under a project sub-path when the build uses one', async () => {
    const register = vi.fn().mockResolvedValue(undefined)
    installWorker({ register, controller: {} })

    registerServiceWorker({ base: '/otp-vault/' })

    expect(register).toHaveBeenCalledWith('/otp-vault/sw.js')
  })

  it('reloads once when a worker takes control of an uncontrolled page', () => {
    const reload = vi.fn()
    const listeners = installWorker({ controller: null })
    registerServiceWorker({ reload })

    listeners.get('controllerchange')?.()
    listeners.get('controllerchange')?.()

    expect(reload).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem('meridian.sw.reload')).toBe('1')
  })

  it('does not reload when the page already has a controller', () => {
    const reload = vi.fn()
    const listeners = installWorker({ controller: {} })
    registerServiceWorker({ reload })

    listeners.get('controllerchange')?.()

    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload again after the one-time flag is set', () => {
    sessionStorage.setItem('meridian.sw.reload', '1')
    const reload = vi.fn()
    const listeners = installWorker({ controller: null })
    registerServiceWorker({ reload })

    listeners.get('controllerchange')?.()

    expect(reload).not.toHaveBeenCalled()
  })

  it('skips the reload when storage is blocked', () => {
    const reload = vi.fn()
    const listeners = installWorker({ controller: null })
    registerServiceWorker({
      reload,
      storage: {
        getItem() {
          throw new Error('blocked')
        },
        setItem() {
          throw new Error('blocked')
        },
      },
    })

    expect(() => listeners.get('controllerchange')?.()).not.toThrow()
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads the document when no reload hook is provided', () => {
    const listeners = installWorker({ controller: null })
    registerServiceWorker()

    expect(() => listeners.get('controllerchange')?.()).not.toThrow()
    expect(sessionStorage.getItem('meridian.sw.reload')).toBe('1')
  })
})

function installWorker(options: {
  register?: ReturnType<typeof vi.fn>
  controller: object | null
}) {
  const listeners = new Map<string, () => void>()
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: options.register ?? vi.fn().mockResolvedValue(undefined),
      controller: options.controller,
      addEventListener(type: string, listener: () => void) {
        listeners.set(type, listener)
      },
    },
  })
  return listeners
}
