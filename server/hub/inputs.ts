// The socket boundary: nothing reaches the reducer unless it parses, and no socket can flood the tick.

import { z } from 'zod'

export const handshakeAuthSchema = z.object({
  role: z.enum(['display', 'play', 'control']),
  seat: z.enum(['P1', 'P2']).optional(),
  deviceId: z.string().min(4).max(64).regex(/^[A-Za-z0-9_-]+$/),
  tabId: z.string().min(4).max(64).regex(/^[A-Za-z0-9_-]+$/),
})

export const clientInputSchema = z.object({
  key: z.string().min(1).max(32).regex(/^[A-Za-z0-9]+$/),
  type: z.enum(['down', 'up']),
  clientTs: z.number().finite().min(0),
  durationMs: z.number().finite().min(0).max(120_000).optional(),
  gapMs: z.number().finite().min(0).max(3_600_000).optional(),
})

export const pingSchema = z.object({ t: z.number().finite() })

export const controlCommandSchema = z.discriminatedUnion('cmd', [
  z.object({ cmd: z.literal('selectGame'), gameId: z.string().min(1).max(64) }),
  z.object({ cmd: z.literal('start') }),
  z.object({ cmd: z.literal('skip') }),
  z.object({ cmd: z.literal('endRound') }),
  z.object({ cmd: z.literal('resetScores') }),
  z.object({ cmd: z.literal('resetGhosts') }),
  z.object({ cmd: z.literal('forceAttract') }),
  z.object({ cmd: z.literal('kick'), seat: z.enum(['P1', 'P2']) }),
  z.object({ cmd: z.literal('mute'), muted: z.boolean() }),
  z.object({ cmd: z.literal('highWash'), on: z.boolean() }),
  z.object({ cmd: z.literal('reloadContent') }),
  z.object({ cmd: z.literal('hardReset') }),
])

/** Token bucket: `rate` tokens per second, up to `burst` stored. */
export class TokenBucket {
  private tokens: number
  private last: number

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    now = Date.now(),
  ) {
    this.tokens = burst
    this.last = now
  }

  take(now = Date.now()): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000
    this.last = now
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate)
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}
