// Window-level key capture for the player laptops. Swallows everything, forwards only allowed keys,
// measures press length and gaps on the local monotonic clock, and never leaves a key stuck down.
import type { ClientInput } from '@/lib/shared/protocol'
import type { HeldKeys } from '@/games/types'

export interface KeyCaptureOptions {
  isAllowed: (code: string) => boolean
  onInput: (input: ClientInput) => void
  onHeldChange: (held: HeldKeys) => void
}

const ALWAYS_SWALLOW = new Set(['Escape', 'F11', 'F5', 'Tab', 'F1', 'F3', 'F6', 'F7', 'F12', 'ContextMenu'])

export function attachKeyCapture(opts: KeyCaptureOptions): () => void {
  const held = new Map<string, number>()
  const lastUp = new Map<string, number>()

  const snapshot = (): HeldKeys => {
    const out: HeldKeys = {}
    for (const [k, v] of held) out[k] = v
    return out
  }

  const release = (code: string, ts: number) => {
    const since = held.get(code)
    if (since == null) return
    held.delete(code)
    lastUp.set(code, ts)
    // A key that was accepted on the way down always gets its "up", even if the phase changed meanwhile.
    opts.onInput({ key: code, type: 'up', clientTs: ts, durationMs: Math.max(0, ts - since) })
    opts.onHeldChange(snapshot())
  }

  const releaseAll = () => {
    const ts = performance.now()
    for (const code of Array.from(held.keys())) release(code, ts)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const code = e.code || e.key
    const allowed = opts.isAllowed(code)
    if (allowed || ALWAYS_SWALLOW.has(code) || e.ctrlKey || e.altKey || e.metaKey || code.startsWith('F')) {
      e.preventDefault()
    }
    if (!allowed) return
    if (e.repeat || held.has(code)) return
    const ts = e.timeStamp
    held.set(code, ts)
    const prevUp = lastUp.get(code)
    const gap = prevUp != null ? Math.max(0, ts - prevUp) : undefined
    // After minutes of silence the gap is meaningless (and past what the server accepts): omit it.
    opts.onInput({ key: code, type: 'down', clientTs: ts, gapMs: gap != null && gap < 600_000 ? gap : undefined })
    opts.onHeldChange(snapshot())
  }

  const onKeyUp = (e: KeyboardEvent) => {
    const code = e.code || e.key
    if (opts.isAllowed(code) || ALWAYS_SWALLOW.has(code)) e.preventDefault()
    release(code, e.timeStamp)
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') releaseAll()
  }
  const onContextMenu = (e: Event) => e.preventDefault()
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault()
  }
  const onGesture = (e: Event) => e.preventDefault()

  window.addEventListener('keydown', onKeyDown, { capture: true })
  window.addEventListener('keyup', onKeyUp, { capture: true })
  window.addEventListener('blur', releaseAll)
  window.addEventListener('pagehide', releaseAll)
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('fullscreenchange', releaseAll)
  window.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('gesturestart', onGesture)
  window.addEventListener('gesturechange', onGesture)

  return () => {
    releaseAll()
    window.removeEventListener('keydown', onKeyDown, { capture: true })
    window.removeEventListener('keyup', onKeyUp, { capture: true })
    window.removeEventListener('blur', releaseAll)
    window.removeEventListener('pagehide', releaseAll)
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('fullscreenchange', releaseAll)
    window.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('gesturestart', onGesture)
    window.removeEventListener('gesturechange', onGesture)
  }
}
