export function buildServiceWorker(options: {
  globDirectory: string
  swDest: string
}): Promise<{ count: number; size: number; warnings: string[] }>
