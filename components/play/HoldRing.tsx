'use client'
/** Local feedback while space is held: fills over `ms`. Rendered from the local key state, no round trip. */
export function HoldRing({ heldSince, localNow, ms }: { heldSince: number | null; localNow: number; ms: number }) {
  const p = heldSince == null ? 0 : Math.min(1, (localNow - heldSince) / ms)
  return <div className="hold-ring" style={{ ['--p' as string]: p }} aria-hidden="true" />
}
