import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isStandalone(): boolean {
  const media = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false
  const nav = navigator as Navigator & { standalone?: boolean }
  return media || nav.standalone === true
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function InstallButton() {
  const [standalone, setStandalone] = useState(isStandalone)
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPromptEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (standalone) {
    return (
      <p className="font-mono text-xs tracking-[0.18em] text-primary uppercase">
        Installed
      </p>
    )
  }

  if (promptEvent) {
    return (
      <Button
        type="button"
        className="h-10 px-3"
        onClick={() => {
          void promptEvent.prompt().then(async () => {
            const choice = await promptEvent.userChoice
            if (choice.outcome === 'accepted') setStandalone(true)
          })
        }}
      >
        Install app
      </Button>
    )
  }

  if (isIos()) {
    return (
      <p className="max-w-48 text-right text-xs leading-snug text-muted-foreground">
        On iPhone or iPad, open the Share menu and choose Add to Home Screen.
      </p>
    )
  }

  return null
}
