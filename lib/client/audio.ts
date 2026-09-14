// One AudioContext per page, one oscillator per beep. Starts on the first user gesture (autoplay policy).
let ctx: AudioContext | null = null
let current: { osc: OscillatorNode; gain: GainNode } | null = null

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Call from any user gesture handler to unlock audio early. */
export function unlockAudio() {
  context()
}

export function audioState(): 'running' | 'suspended' | 'unavailable' {
  if (!ctx) return 'unavailable'
  return ctx.state === 'running' ? 'running' : 'suspended'
}

/** Starts a sine at `hz`; call beepStop() on key-up. */
export function beepStart(hz: number) {
  const c = context()
  if (!c) return
  beepStop()
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.value = hz
  gain.gain.setValueAtTime(0.0001, c.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.25, c.currentTime + 0.008)
  osc.connect(gain).connect(c.destination)
  osc.start()
  current = { osc, gain }
}

export function beepStop() {
  const c = ctx
  const cur = current
  current = null
  if (!c || !cur) return
  const t = c.currentTime
  cur.gain.gain.cancelScheduledValues(t)
  cur.gain.gain.setValueAtTime(Math.max(cur.gain.gain.value, 0.0001), t)
  cur.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02)
  cur.osc.stop(t + 0.03)
}

/** Short confirmation blip (letter committed, option picked). */
export function blip(hz: number, ms = 60) {
  const c = context()
  if (!c) return
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.value = hz
  const t = c.currentTime
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.2, t + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
  osc.connect(gain).connect(c.destination)
  osc.start(t)
  osc.stop(t + ms / 1000 + 0.01)
}
