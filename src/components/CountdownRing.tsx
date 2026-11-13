const TICKS = 60

export function CountdownRing({ remaining }: { remaining: number }) {
  return (
    <div
      className="relative size-36 shrink-0"
      role="img"
      aria-label={`${remaining} seconds remaining`}
    >
      <svg viewBox="0 0 120 120" className="size-full" aria-hidden="true">
        {Array.from({ length: TICKS }, (_, index) => {
          const major = index % 5 === 0
          const lit = index < remaining
          return (
            <line
              key={index}
              x1="60"
              y1={major ? 7 : 9}
              x2="60"
              y2={major ? 16 : 14}
              stroke={lit ? 'var(--primary)' : 'color-mix(in oklch, var(--primary) 22%, transparent)'}
              strokeWidth={major ? 2.2 : 1.2}
              strokeLinecap="round"
              transform={`rotate(${index * 6} 60 60)`}
            />
          )
        })}
      </svg>
      <p
        data-testid="seconds-remaining"
        className="absolute inset-0 grid place-items-center font-mono text-xl text-primary tabular-nums"
      >
        {remaining}s
      </p>
    </div>
  )
}
