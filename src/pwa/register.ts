const RELOAD_KEY = 'meridian.sw.reload'

function pageReload(): void {
  window.location.reload()
}

export function registerServiceWorker(
  deps: {
    reload?: () => void
    storage?: Pick<Storage, 'getItem' | 'setItem'>
    base?: string
  } = {},
): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  const reload = deps.reload ?? pageReload
  const storage = deps.storage ?? window.sessionStorage
  const base = deps.base ?? import.meta.env.BASE_URL ?? '/'
  const hadController = Boolean(navigator.serviceWorker.controller)

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) return
    try {
      if (storage.getItem(RELOAD_KEY) === '1') return
      storage.setItem(RELOAD_KEY, '1')
    } catch {
      return
    }
    reload()
  })

  navigator.serviceWorker.register(`${base}sw.js`).catch(() => {
    // The authenticator still runs when a worker is blocked.
  })
}
