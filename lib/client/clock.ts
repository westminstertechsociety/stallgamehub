// Server clock estimate. Keeps the lowest-RTT samples (NTP style) so a Wi-Fi spike cannot skew the offset.
import type { Socket } from 'socket.io-client'
import { EVENTS } from '@/lib/shared/protocol'

interface Sample {
  offset: number
  rtt: number
}

const samples: Sample[] = []
let best: Sample | null = null
let socketRef: Socket | null = null

export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function serverNow(): number {
  return now() + (best?.offset ?? 0)
}

export function rtt(): number | null {
  return best?.rtt ?? null
}

export function hasSync(): boolean {
  return best !== null
}

export function attach(socket: Socket) {
  socketRef = socket
  socket.on(EVENTS.pong, (raw: { t: number; serverTs: number }) => {
    const t1 = now()
    const t0 = raw.t
    const sampleRtt = Math.max(0, t1 - t0)
    const offset = raw.serverTs - (t0 + t1) / 2
    samples.push({ offset, rtt: sampleRtt })
    if (samples.length > 8) samples.shift()
    best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a))
    socket.emit('hub:rtt', Math.round(sampleRtt))
  })
}

export function ping() {
  const s = socketRef
  if (!s || !s.connected) return
  s.emit(EVENTS.ping, { t: now() })
}

/** Five quick samples right after connecting so the first countdown is already accurate. */
export function burst() {
  samples.length = 0
  for (let i = 0; i < 5; i++) setTimeout(ping, i * 120)
}
