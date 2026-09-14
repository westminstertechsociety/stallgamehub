// The hub clock and a drift-corrected ticker. Both use the monotonic clock: a wall-clock step (the OS
// resyncing time, an operator fixing the date) must never freeze deadlines or the tick.

import { performance } from 'node:perf_hooks'

/** Milliseconds, monotonic, anchored so it reads like wall time at boot. Everything in the hub uses this. */
export function hubNow(): number {
  return Math.round(performance.timeOrigin + performance.now())
}

export function startTicker(intervalMs: number, fn: (now: number) => void): () => void {
  let stopped = false
  let next = performance.now() + intervalMs
  let timer: NodeJS.Timeout | null = null

  const loop = () => {
    if (stopped) return
    try {
      fn(hubNow())
    } catch (err) {
      console.error('tick error', err)
    }
    const now = performance.now()
    next += intervalMs
    if (next < now) next = now + intervalMs
    timer = setTimeout(loop, Math.max(0, next - performance.now()))
  }

  timer = setTimeout(loop, intervalMs)
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
