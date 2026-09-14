// Drift-corrected ticker. setInterval drifts and bunches up under load; this schedules each tick from the
// intended time, and skips forward (without a burst of catch-up ticks) if the process stalls.

export function startTicker(intervalMs: number, fn: (now: number) => void): () => void {
  let stopped = false
  let next = Date.now() + intervalMs
  let timer: NodeJS.Timeout | null = null

  const loop = () => {
    if (stopped) return
    const now = Date.now()
    try {
      fn(now)
    } catch (err) {
      console.error('tick error', err)
    }
    next += intervalMs
    if (next < now) next = now + intervalMs
    timer = setTimeout(loop, Math.max(0, next - Date.now()))
  }

  timer = setTimeout(loop, intervalMs)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
