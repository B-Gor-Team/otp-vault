import type { ReactNode } from 'react'
import { cn } from 'cn'

export function BracketFrame({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('relative', className)}>
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 size-3 border-t border-l border-primary/80" />
      <span aria-hidden="true" className="pointer-events-none absolute top-0 right-0 size-3 border-t border-r border-primary/80" />
      <span aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 size-3 border-b border-l border-primary/80" />
      <span aria-hidden="true" className="pointer-events-none absolute right-0 bottom-0 size-3 border-r border-b border-primary/80" />
      {children}
    </div>
  )
}
