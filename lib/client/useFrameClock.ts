'use client'
import { useEffect, useState } from 'react'

/** performance.now() that updates every animation frame while `active`, otherwise stays put. */
export function useFrameClock(active: boolean): number {
  const [t, setT] = useState(() => (typeof performance !== 'undefined' ? performance.now() : 0))
  useEffect(() => {
    if (!active) return
    let raf = 0
    const loop = () => {
      setT(performance.now())
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active])
  return t
}
