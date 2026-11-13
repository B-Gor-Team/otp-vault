import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BracketFrame } from '@/components/BracketFrame'
import { CountdownRing } from '@/components/CountdownRing'
import { InstallButton } from '@/components/InstallButton'
import {
  REFERENCE_HEX,
  SecretError,
  generateCode,
  generateWindow,
  groupCode,
  parseSecret,
  secondsRemaining,
  type OtpStep,
  type SecretFormat,
} from '@/lib/otp'
import { openDeviceStore } from '@/lib/device-store'
import { useNow } from '@/lib/use-now'
import {
  VaultError,
  addToken,
  readVault,
  removeToken,
  setActiveToken,
  writeVault,
  type KeyValueStore,
  type TokenRecord,
  type VaultFile,
} from '@/lib/vault'

const STORAGE_BLOCKED = 'This browser blocked local storage, so the key was not kept.'

type AppProps = {
  now?: number
  storage?: KeyValueStore
}

function offsetLabel(offset: number): string {
  if (offset === 0) return 'NOW'
  return offset > 0 ? `T+${offset}` : `T${offset}`
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function safeSteps(base32: string, now: number): OtpStep[] | null {
  try {
    return generateWindow(base32, now)
  } catch {
    return null
  }
}

function safeGrouped(base32: string, now: number): string | null {
  try {
    return groupCode(generateCode(base32, now).code)
  } catch {
    return null
  }
}

export default function App({ now: frozen, storage: storageProp }: AppProps) {
  const now = useNow({ frozen, tickMs: 250 })
  const [store] = useState(() => storageProp ?? openDeviceStore())
  const [vault, setVault] = useState<VaultFile>(() => readVault(store))
  const [ready, setReady] = useState(() => !store.hydrate)
  const [label, setLabel] = useState('')
  const [format, setFormat] = useState<SecretFormat>('hex')
  const [secret, setSecret] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [keyVisible, setKeyVisible] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)

  useEffect(() => {
    if (!store.hydrate) return
    let cancel = false
    void store
      .hydrate()
      .then(() => {
        if (cancel) return
        setVault(readVault(store))
        setReady(true)
      })
      .catch(() => {
        if (!cancel) setReady(true)
      })
    return () => {
      cancel = true
    }
  }, [store])

  const parsed = secret.trim() === '' ? null : parseSecret(secret, format)
  const liveError = parsed && !parsed.ok ? parsed.error : null
  const alertText = notice ?? liveError
  const active = vault.tokens.find((token) => token.id === vault.activeId) ?? null
  const steps = active ? safeSteps(active.secretBase32, now) : null
  const current = steps?.find((step) => step.offset === 0) ?? null
  const unreadable = Boolean(active) && steps === null
  const revealed = active && keyVisible ? parseSecret(active.secretBase32, 'base32') : null

  function commit(next: VaultFile, after?: () => void): void | Promise<void> {
    let pending: void | Promise<void>
    try {
      pending = writeVault(store, next)
    } catch {
      setNotice(STORAGE_BLOCKED)
      return
    }
    const finish = () => {
      setVault(next)
      after?.()
    }
    if (pending) {
      return pending.then(finish).catch(() => {
        setNotice(STORAGE_BLOCKED)
      })
    }
    finish()
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready) return
    if (!parsed || !parsed.ok) {
      setNotice(parsed && !parsed.ok ? parsed.error : 'Enter a secret.')
      return
    }
    if (!label.trim()) {
      setNotice('Name this key.')
      return
    }
    try {
      const next = addToken(vault, {
        label,
        base32: parsed.base32,
        now,
      })
      return commit(next, () => {
        setLabel('')
        setSecret('')
        setFormat('hex')
        setNotice(null)
        setKeyVisible(false)
        setCopied(false)
        setRemoveOpen(false)
      })
    } catch (error) {
      if (error instanceof VaultError || error instanceof SecretError) {
        setNotice(error.message)
        return
      }
      setNotice(STORAGE_BLOCKED)
    }
  }

  function selectToken(token: TokenRecord) {
    if (!ready) return
    return commit(setActiveToken(vault, token.id), () => {
      setKeyVisible(false)
      setCopied(false)
      setRemoveOpen(false)
    })
  }

  async function copyCode() {
    if (!current) return
    try {
      await navigator.clipboard.writeText(current.code)
      setCopied(true)
      setNotice(null)
    } catch {
      setCopied(false)
      setNotice('Could not copy the code.')
    }
  }

  function confirmRemove() {
    if (!active || !ready) return
    return commit(removeToken(vault, active.id), () => {
      setRemoveOpen(false)
      setKeyVisible(false)
      setCopied(false)
      setNotice(null)
    })
  }

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 pt-5 pb-16 sm:px-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] tracking-[0.32em] text-primary">
              LOCAL VAULT
            </p>
            <h1 className="font-display text-4xl leading-none font-extrabold tracking-tight sm:text-5xl">
              Meridian
            </h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Sixty-second codes, generated on this device.
            </p>
          </div>
          <InstallButton />
        </header>

        <div className="mt-5 flex flex-wrap gap-2">
          {['SHA-1', '6 digits', '60-second step'].map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-[11px] tracking-[0.14em] text-primary uppercase"
            >
              {chip}
            </span>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <BracketFrame
            className={
              vault.tokens.length > 0
                ? 'order-2 min-w-0 lg:order-1'
                : 'order-1 min-w-0'
            }
          >
            <section className="min-w-0 border border-border/80 bg-card/80 p-4 backdrop-blur-md sm:p-5">
              <h2 className="font-display text-2xl font-bold">Accept a key</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Paste a hex key or a base32 secret. Meridian uses the same TOTP
                step as pyotp with a 60-second interval.
              </p>

              <form className="mt-4 grid gap-4" aria-busy={ready ? undefined : true} onSubmit={onSubmit}>
                <div className="grid gap-2">
                  <Label htmlFor="key-name">Key name</Label>
                  <Input
                    id="key-name"
                    value={label}
                    autoComplete="off"
                    placeholder="Lab door, deploy token, laptop"
                    className="h-11 text-base md:text-base"
                    onChange={(event) => {
                      setLabel(event.target.value)
                      setNotice(null)
                    }}
                  />
                </div>

                <div className="grid gap-2">
                  <span className="text-sm font-medium" id="secret-format-label">
                    Secret format
                  </span>
                  <div
                    role="radiogroup"
                    aria-labelledby="secret-format-label"
                    className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-background/50 p-1"
                  >
                    {(
                      [
                        ['hex', 'Hex key'],
                        ['base32', 'Base32'],
                      ] as const
                    ).map(([value, name]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={format === value}
                        className={
                          format === value
                            ? 'h-10 rounded-md bg-primary text-sm font-medium text-primary-foreground'
                            : 'h-10 rounded-md text-sm text-muted-foreground hover:text-foreground'
                        }
                        onClick={() => {
                          setFormat(value)
                          setNotice(null)
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="secret">Secret</Label>
                  <Input
                    id="secret"
                    value={secret}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-invalid={liveError ? true : undefined}
                    placeholder={format === 'hex' ? '05a0 6f6c …' : 'GEZD GN…'}
                    className="h-12 font-mono text-base tracking-wide md:text-base"
                    onChange={(event) => {
                      setSecret(event.target.value)
                      setNotice(null)
                    }}
                  />
                </div>

                {parsed?.ok && (
                  <div className="rounded-lg border border-primary/25 bg-primary/10 px-3 py-3">
                    <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
                      Code this key produces now
                    </p>
                    <p
                      data-testid="code-preview"
                      className="mt-1 font-mono text-3xl tracking-[0.18em] text-primary tabular-nums"
                    >
                      {groupCode(generateCode(parsed.base32, now).code)}
                    </p>
                  </div>
                )}

                {alertText && (
                  <p role="alert" className="text-sm text-destructive">
                    {alertText}
                  </p>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="submit" className="h-11" disabled={!ready}>
                    Keep on this device
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={!ready}
                    onClick={() => {
                      setFormat('hex')
                      setSecret(REFERENCE_HEX)
                      setLabel((currentLabel) =>
                        currentLabel.trim() ? currentLabel : 'Reference vector',
                      )
                      setNotice(null)
                    }}
                  >
                    Use the reference hex key
                  </Button>
                </div>
              </form>

              <pre className="mt-4 max-w-full overflow-x-auto border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {`secret = base64.b32encode(bytes.fromhex(hex_key)).decode()
pyotp.TOTP(secret, interval=60).now()`}
              </pre>
            </section>
          </BracketFrame>

          <BracketFrame
            className={
              vault.tokens.length > 0
                ? 'order-1 min-w-0 lg:order-2'
                : 'order-2 min-w-0'
            }
          >
            <section className="min-w-0 border border-border/80 bg-card/75 p-4 backdrop-blur-md sm:p-6">
              {active && current && (
                <div>
                  <p className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
                    Current code
                  </p>
                  <h2 className="mt-1 font-display text-3xl font-bold">{active.label}</h2>
                  <div className="mt-6 flex w-full min-w-0 flex-col items-center gap-6 lg:flex-row lg:items-center lg:gap-8">
                    <CountdownRing remaining={secondsRemaining(now)} />
                    <div className="w-full min-w-0 text-center lg:text-left">
                      <p
                        data-testid="active-code"
                        aria-live="polite"
                        className="font-mono text-5xl leading-none tracking-[0.12em] text-primary tabular-nums sm:text-6xl lg:text-7xl"
                      >
                        {groupCode(current.code)}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                        <Button
                          type="button"
                          className="h-11 px-4"
                          onClick={() => {
                            void copyCode()
                          }}
                        >
                          {copied ? 'Copied' : 'Copy code'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11"
                          onClick={() => setKeyVisible((visible) => !visible)}
                        >
                          {keyVisible ? 'Hide key' : 'Show key'}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          className="h-11"
                          onClick={() => setRemoveOpen(true)}
                        >
                          Remove key
                        </Button>
                      </div>
                    </div>
                  </div>

                  {keyVisible && revealed?.ok && (
                    <p
                      data-testid="revealed-key"
                      className="mt-4 break-all border border-border bg-background/70 p-3 font-mono text-sm leading-relaxed"
                    >
                      {revealed.base32}
                      <span className="mt-1 block text-muted-foreground">{revealed.hex}</span>
                    </p>
                  )}

                  <h3 className="mt-8 font-display text-lg font-bold">
                    Codes around this minute
                  </h3>
                  <ul
                    aria-label="Codes around this minute"
                    className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-2"
                  >
                    {steps?.map((step) => (
                      <li
                        key={step.counter}
                        className={
                          step.offset === 0
                            ? 'min-w-28 shrink-0 border border-primary bg-primary/15 px-3 py-2'
                            : 'min-w-28 shrink-0 border border-border bg-background/50 px-3 py-2 text-muted-foreground'
                        }
                      >
                        <span className="block font-mono text-[10px] tracking-[0.16em] uppercase">
                          {offsetLabel(step.offset)}
                        </span>
                        <span className="mt-1 block font-mono text-lg tracking-widest text-foreground tabular-nums">
                          {groupCode(step.code)}
                        </span>
                        <time
                          dateTime={new Date(step.validFrom).toISOString()}
                          className="mt-1 block font-mono text-[10px]"
                        >
                          {clock(step.validFrom)}
                        </time>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {active && unreadable && (
                <div>
                  <h2 className="font-display text-3xl font-bold">{active.label}</h2>
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    This saved key is unreadable.
                  </p>
                  <Button
                    type="button"
                    variant="destructive"
                    className="mt-4 h-11"
                    onClick={() => setRemoveOpen(true)}
                  >
                    Remove key
                  </Button>
                </div>
              )}

              {!active && (
                <div className="py-6 sm:py-10">
                  <h2 className="font-display text-3xl font-bold">No keys on this device</h2>
                  <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                    Add a secret to start a live code and the minutes around it.
                    The vault stays in this browser. Clearing site data removes it.
                  </p>
                </div>
              )}

              {vault.tokens.length > 0 && (
                <div className={active ? 'mt-8' : 'mt-2'}>
                  <h3 className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
                    Saved keys
                  </h3>
                  <ul aria-label="Saved keys" className="mt-3 grid gap-2 sm:grid-cols-2">
                    {vault.tokens.map((token) => {
                      const code = safeGrouped(token.secretBase32, now)
                      const selected = token.id === active?.id
                      return (
                        <li key={token.id}>
                          <button
                            type="button"
                            aria-current={selected ? 'true' : undefined}
                            className={
                              selected
                                ? 'flex w-full items-center justify-between gap-3 border border-primary bg-primary/10 px-3 py-3 text-left'
                                : 'flex w-full items-center justify-between gap-3 border border-border bg-background/40 px-3 py-3 text-left hover:border-primary/50'
                            }
                            onClick={() => selectToken(token)}
                          >
                            <span className="truncate font-medium">{token.label}</span>
                            <span className="font-mono tracking-widest text-primary tabular-nums">
                              {code ?? '——'}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </section>
          </BracketFrame>
        </div>

        <footer className="mt-8 text-sm text-muted-foreground">
          Secrets stay in this browser. Meridian never sends them anywhere.
        </footer>
      </div>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {active?.label}?</DialogTitle>
            <DialogDescription>
              This deletes the secret from this browser. It cannot be restored
              from Meridian.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRemoveOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={confirmRemove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
