'use client'
import { useEffect, useState } from 'react'

/** Server-time ticker for countdowns. 10 Hz is plenty for whole-second displays. */
export function useServerClock(serverNow: () => number, hz = 10): number {
  const [t, setT] = useState(() => serverNow())
  useEffect(() => {
    const id = setInterval(() => setT(serverNow()), 1000 / hz)
    return () => clearInterval(id)
  }, [serverNow, hz])
  return t
}

export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}
