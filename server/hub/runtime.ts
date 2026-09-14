// Wires Socket.IO to the reducer: seat assignment, validation, rate limiting, the tick, and view fan-out.

import os from 'node:os'
import { z } from 'zod'
import type { Server, Socket } from 'socket.io'
import { SEATS, type GameModule, type LeaderboardEntry, type Seat } from '@/games/types'
import { EVENTS, type HandshakeAuth, type Role } from '@/lib/shared/protocol'
import { hubNow, startTicker } from './clock'
import type { ContentSnapshot } from './content'
import { loadContent } from './content'
import { TokenBucket, clientInputSchema, controlCommandSchema, handshakeAuthSchema, pingSchema } from './inputs'
import type { JsonStore, Logger } from './persistence'
import { buildControlView, buildDisplayView, buildPlayerView, type ControlDiagnostics } from './broadcast'
import { initialState, reduce, type Effect, type HubDeps, type HubEvent, type HubState } from './session'

export const TICK_MS = 20
export const FLUSH_MS = 33

export interface SessionSnapshot {
  gameId: string
  muted: boolean
  highWash: boolean
}

export const sessionSnapshotSchema = z.object({
  gameId: z.string(),
  muted: z.boolean(),
  highWash: z.boolean(),
})

interface SocketData {
  role: Role
  seat: Seat | null
  auth: HandshakeAuth
  bucket: TokenBucket
  rtt: number | null
}

export interface Stores {
  leaderboard: JsonStore<LeaderboardEntry[]>
  gameData: JsonStore<Record<string, unknown>>
  session: JsonStore<SessionSnapshot>
}

function lanIps(): string[] {
  const out: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address)
    }
  }
  return out
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export class HubRuntime {
  state: HubState
  private deps: HubDeps
  private content: ContentSnapshot
  private seatSockets: Record<Seat, string | null> = { P1: null, P2: null }
  private dirty = false
  private lastFlush = 0
  private stopTick: (() => void) | null = null
  private stopFlush: (() => void) | null = null
  private readonly bootedAt = hubNow()

  constructor(
    private readonly io: Server,
    content: ContentSnapshot,
    private readonly games: Record<string, GameModule>,
    private readonly stores: Stores,
    private readonly log: Logger,
  ) {
    this.content = content
    this.deps = {
      games,
      config: content.hub,
      gameConfigs: content.games,
      gameData: stores.gameData.value,
      leaderboard: stores.leaderboard.value,
      random: Math.random,
      newId,
    }
    const snap = stores.session.value
    const gameId = games[snap.gameId] ? snap.gameId : content.hub.defaultGame
    const now = hubNow()
    this.state = initialState(content.hub, games[gameId] ? gameId : (Object.keys(games)[0] as string), now)
    this.state.muted = snap.muted
    this.state.highWash = snap.highWash
    this.state.seq = 1
  }

  get config() {
    return this.content.hub
  }

  get contentStatus() {
    return this.content
  }

  start() {
    this.io.use((socket, next) => {
      const parsed = handshakeAuthSchema.safeParse(socket.handshake.auth)
      if (!parsed.success) {
        next(new Error('bad handshake'))
        return
      }
      const data: SocketData = {
        role: parsed.data.role,
        seat: null,
        auth: parsed.data,
        bucket: new TokenBucket(60, 120),
        rtt: null,
      }
      socket.data = data
      next()
    })
    this.io.on('connection', (socket) => this.onConnection(socket))
    this.stopTick = startTicker(TICK_MS, () => this.dispatch({ type: 'tick' }))
    this.stopFlush = startTicker(FLUSH_MS, (now) => this.flush(now))
  }

  stop() {
    this.stopTick?.()
    this.stopFlush?.()
  }

  dispatch(ev: HubEvent) {
    const now = hubNow()
    const result = reduce(this.state, ev, now, this.deps)
    const prev = this.state
    this.state = result.state
    for (const effect of result.effects) this.applyEffect(effect)
    if (result.changed) {
      this.dirty = true
      if (prev.gameId !== this.state.gameId || prev.muted !== this.state.muted || prev.highWash !== this.state.highWash) {
        this.stores.session.set({ gameId: this.state.gameId, muted: this.state.muted, highWash: this.state.highWash })
      }
    }
  }

  private applyEffect(effect: Effect) {
    switch (effect.type) {
      case 'log':
        this.log[effect.level](effect.msg)
        return
      case 'leaderboard.add': {
        const next = [...this.stores.leaderboard.value, effect.entry]
        const keep = this.config.leaderboard.keepPerVariant
        const game = this.games[effect.entry.gameId]
        const variant = game?.variants.find((v) => v.id === effect.entry.variantId)
        // Cap each game/variant list so the file stays bounded over a long day.
        const same = next.filter((e) => e.gameId === effect.entry.gameId && e.variantId === effect.entry.variantId)
        if (same.length > keep && variant) {
          same.sort((a, b) => (variant.order === 'asc' ? a.score - b.score : b.score - a.score) || a.at - b.at)
          const drop = new Set(same.slice(keep).map((e) => e.id))
          this.setLeaderboard(next.filter((e) => !drop.has(e.id)))
        } else {
          this.setLeaderboard(next)
        }
        this.log.info(`leaderboard: ${effect.entry.name} ${effect.entry.scoreText} (${effect.entry.gameId}/${effect.entry.variantId})`)
        return
      }
      case 'leaderboard.reset':
        this.setLeaderboard([])
        this.log.warn('leaderboard cleared by operator')
        return
      case 'gameData.set': {
        const next = { ...this.stores.gameData.value, [effect.gameId]: effect.data }
        this.stores.gameData.set(next)
        this.deps.gameData = next
        return
      }
    }
  }

  private setLeaderboard(entries: LeaderboardEntry[]) {
    this.stores.leaderboard.set(entries)
    this.deps.leaderboard = entries
    this.dirty = true
  }

  private reloading: Promise<boolean> | null = null

  reloadContent(): Promise<boolean> {
    if (!this.reloading) this.reloading = this.doReload().finally(() => (this.reloading = null))
    return this.reloading
  }

  private async doReload(): Promise<boolean> {
    const next = await loadContent(this.games, this.content)
    if (next.hub.port !== this.content.hub.port || next.hub.host !== this.content.hub.host) {
      next.errors.push('port/host changes in hub.json take effect after a restart')
    }
    this.content = next
    this.deps.config = next.hub
    this.deps.gameConfigs = next.games
    for (const err of next.errors) this.log.warn(`content: ${err}`)
    this.dispatch({ type: 'content.reloaded', version: next.version, ok: next.errors.length === 0 })
    this.io.emit(EVENTS.contentVersion, { version: next.version })
    return next.errors.length === 0
  }

  // ---------------------------------------------------------------- sockets

  private onConnection(socket: Socket) {
    const data = socket.data as SocketData
    socket.join(data.role)
    if (data.role === 'play') this.assignSeat(socket)
    this.log.info(
      `connect ${data.role}${data.seat ? ' ' + data.seat : ''} ${socket.id} device=${data.auth.deviceId} tab=${data.auth.tabId}`,
    )
    this.sendSnapshot(socket)

    socket.on(EVENTS.ping, (raw: unknown) => {
      if (!data.bucket.take()) return
      const parsed = pingSchema.safeParse(raw)
      if (!parsed.success) return
      socket.emit(EVENTS.pong, { t: parsed.data.t, serverTs: hubNow() })
    })

    socket.on('hub:rtt', (raw: unknown) => {
      if (!data.bucket.take()) return
      if (typeof raw === 'number' && Number.isFinite(raw)) data.rtt = raw
    })

    socket.on(EVENTS.input, (raw: unknown) => {
      if (data.role !== 'play' || !data.seat) return
      if (!data.bucket.take()) return
      const parsed = clientInputSchema.safeParse(raw)
      if (!parsed.success) return
      if (this.seatSockets[data.seat] !== socket.id) return
      this.dispatch({
        type: 'input',
        input: { ...parsed.data, seat: data.seat, serverTs: hubNow() },
      })
    })

    socket.on(EVENTS.sync, () => {
      if (!data.bucket.take()) return
      if (data.role === 'play' && data.seat && this.seatSockets[data.seat] === socket.id) {
        this.dispatch({ type: 'seat.sync', seat: data.seat })
        this.sendSnapshot(socket)
      }
    })

    socket.on(EVENTS.control, (raw: unknown) => {
      if (!data.bucket.take()) return
      const parsed = controlCommandSchema.safeParse(raw)
      if (!parsed.success) return
      // The projector's hidden chord may only hard-reset; everything else needs the control panel.
      if (data.role === 'display' && parsed.data.cmd !== 'hardReset') return
      if (data.role === 'play') return
      this.log.info(`control: ${JSON.stringify(parsed.data)}`)
      if (parsed.data.cmd === 'reloadContent') {
        void this.reloadContent()
        return
      }
      this.dispatch({ type: 'control', cmd: parsed.data })
    })

    socket.on('disconnect', (reason) => {
      this.log.info(`disconnect ${data.role}${data.seat ? ' ' + data.seat : ''} ${socket.id} (${reason})`)
      if (data.role === 'play' && data.seat) {
        // Guard against stale disconnects: only the seat's current socket may vacate it.
        if (this.seatSockets[data.seat] !== socket.id) return
        this.seatSockets[data.seat] = null
        this.dispatch({ type: 'seat.disconnect', seat: data.seat })
        this.seatWaiting()
      }
      this.dirty = true
    })
  }

  /** A bare /play that arrived while both seats were taken gets the first seat that frees up. */
  private seatWaiting() {
    for (const s of this.io.sockets.sockets.values()) {
      const d = s.data as SocketData
      if (d.role !== 'play' || d.seat || d.auth.seat) continue
      this.assignSeat(s)
      if (d.seat) this.sendSnapshot(s)
    }
  }

  private assignSeat(socket: Socket) {
    const data = socket.data as SocketData
    let seat: Seat | null = data.auth.seat ?? null
    if (!seat) {
      // Unpinned laptops take a free seat, but never one whose pinned player is mid-reconnect.
      const pausing = this.state.pause?.seats ?? []
      seat = SEATS.find((s) => this.seatSockets[s] === null && !pausing.includes(s)) ?? null
      if (!seat) {
        this.log.warn(`play socket ${socket.id} has no seat: both taken`)
        return
      }
    }
    const currentId = this.seatSockets[seat]
    if (currentId && currentId !== socket.id) {
      const current = this.io.sockets.sockets.get(currentId)
      if (current) {
        const cd = current.data as SocketData
        const sameDevice = cd.auth.deviceId === data.auth.deviceId
        current.emit(EVENTS.superseded, {
          seat,
          reason: sameDevice ? 'another-tab' : 'another-laptop',
        })
        cd.seat = null
        current.disconnect(true)
      }
      this.seatSockets[seat] = null
      // Same seat, new socket: reset any held keys but do not run the disconnect/reconnect dance.
      this.dispatch({ type: 'seat.sync', seat })
    }
    data.seat = seat
    const wasConnected = this.state.seats[seat].connected
    this.seatSockets[seat] = socket.id
    if (!wasConnected) this.dispatch({ type: 'seat.connect', seat })
  }

  // ---------------------------------------------------------------- views

  private extras() {
    return { reducedMotion: this.config.motion.reduced }
  }

  private diagnostics(): ControlDiagnostics {
    const counts = { display: 0, play: 0, control: 0 }
    const seatMeta: ControlDiagnostics['seatMeta'] = { P1: { deviceId: null, rtt: null }, P2: { deviceId: null, rtt: null } }
    for (const s of this.io.sockets.sockets.values()) {
      const d = s.data as SocketData
      counts[d.role] += 1
      if (d.seat && this.seatSockets[d.seat] === s.id) seatMeta[d.seat] = { deviceId: d.auth.deviceId, rtt: d.rtt }
    }
    return {
      sockets: counts,
      seatMeta,
      content: {
        ok: this.content.errors.length === 0,
        error: this.content.errors.length ? this.content.errors.join(' | ') : null,
        loadedAt: this.content.loadedAt,
      },
      uptimeMs: hubNow() - this.bootedAt,
      ips: lanIps(),
      port: this.config.port,
    }
  }

  /** Full, non-volatile view for a socket that just connected or asked to resync. */
  private sendSnapshot(socket: Socket) {
    const data = socket.data as SocketData
    const now = hubNow()
    try {
      if (data.role === 'display') socket.emit(EVENTS.displayView, buildDisplayView(this.state, this.deps, now, this.extras()))
      else if (data.role === 'play') socket.emit(EVENTS.playerView, buildPlayerView(this.state, data.seat, this.deps, now, this.extras()))
      else socket.emit(EVENTS.controlView, buildControlView(this.state, this.deps, now, this.extras(), this.diagnostics()))
    } catch (err) {
      this.log.error(`snapshot failed: ${(err as Error).stack ?? err}`)
    }
  }

  private flush(now: number) {
    // Change-driven sends are volatile (latest wins, never queued for a stalled client). Once a second every
    // screen also gets a reliable snapshot, so a dropped volatile packet can never leave a screen stale.
    const periodic = now - this.lastFlush >= 1000
    if (!this.dirty && !periodic) return
    const wasDirty = this.dirty
    this.dirty = false
    if (periodic) this.lastFlush = now
    try {
      if (wasDirty || periodic) {
        const display = buildDisplayView(this.state, this.deps, now, this.extras())
        const room = this.io.to('display')
        ;(periodic ? room : room.volatile).emit(EVENTS.displayView, display)
        for (const s of this.io.sockets.sockets.values()) {
          const d = s.data as SocketData
          if (d.role !== 'play') continue
          const seat = d.seat && this.seatSockets[d.seat] === s.id ? d.seat : null
          const view = buildPlayerView(this.state, seat, this.deps, now, this.extras())
          if (periodic) s.emit(EVENTS.playerView, view)
          else s.volatile.emit(EVENTS.playerView, view)
        }
      }
      if (this.io.sockets.adapter.rooms.get('control')?.size) {
        const control = buildControlView(this.state, this.deps, now, this.extras(), this.diagnostics())
        this.io.to('control').volatile.emit(EVENTS.controlView, control)
      }
    } catch (err) {
      this.log.error(`flush failed: ${(err as Error).stack ?? err}`)
    }
  }

  health() {
    return {
      ok: true,
      phase: this.state.phase,
      gameId: this.state.gameId,
      seats: { P1: this.state.seats.P1.connected, P2: this.state.seats.P2.connected },
      uptimeMs: hubNow() - this.bootedAt,
      errors: this.state.errors,
      content: this.content.errors,
    }
  }
}
