// The session state machine. A pure reducer: (state, event, now, deps) -> { state, effects, changed }.
// No timers live here. Every deadline is stored in state and evaluated on the tick, which is what makes
// pause/resume, restart recovery and tests trivial.
//
//   ATTRACT -> LOBBY -> COUNTDOWN -> PLAYING -> RESULTS -> (LOBBY | ATTRACT)

import {
  SEATS,
  otherSeat,
  type GameModule,
  type GameOutcome,
  type InputEvent,
  type LeaderboardEntry,
  type Mode,
  type Seat,
} from '@/games/types'
import type { HubConfig } from './content'
import { NAME_ALPHABET, type ControlCommand, type LobbyOption, type Phase, type Presence } from '@/lib/shared/protocol'

/** The one key the hub itself listens to outside of PLAYING. */
export const HUB_KEY = 'Space'

export interface HoldTrack {
  key: string
  since: number
  consumed: boolean
  repeatAt: number
}

export interface SeatState {
  seat: Seat
  connected: boolean
  presence: Presence
  name: string
  cursor: number
  choice: string | null
  /** key -> serverTs when pressed */
  held: Record<string, number>
  hold: HoldTrack | null
  lastInputAt: number
  stuck: boolean
}

export interface CountdownState {
  endsAt: number
  mode: Mode
  variantId: string
  participants: Seat[]
  joinable: boolean
}

export interface RoundState {
  mode: Mode
  variantId: string
  participants: Seat[]
  startedAt: number
  pausedAt: number | null
  pausedTotal: number
  gameState: unknown
}

export interface PauseState {
  /** Participants currently disconnected. */
  seats: Seat[]
  since: number
  graceEndsAt: number
  resumeAt: number | null
}

export interface NamingState {
  letters: number[]
  cursor: number
}

export interface ResultsState {
  outcome: GameOutcome
  mode: Mode
  variantId: string
  participants: Seat[]
  gameState: unknown
  /** Round clock at the moment the round ended, so results views can render the final frame. */
  gameNow: number
  holdEndsAt: number | null
  namingDeadline: number | null
  naming: Partial<Record<Seat, NamingState>>
  entries: LeaderboardEntry[]
  offer: { to: Seat; from: Seat } | null
  /** A tap cannot skip the results before this, so a still-mashing player sees them. */
  restartAfter: number
}

export interface HubState {
  phase: Phase
  gameId: string
  seats: Record<Seat, SeatState>
  countdown: CountdownState | null
  round: RoundState | null
  pause: PauseState | null
  results: ResultsState | null
  idleDeadline: number | null
  notice: { text: string; until: number } | null
  errors: number
  muted: boolean
  highWash: boolean
  contentVersion: number
  seq: number
  startedAt: number
}

export type HubEvent =
  | { type: 'seat.connect'; seat: Seat }
  | { type: 'seat.disconnect'; seat: Seat }
  | { type: 'seat.sync'; seat: Seat }
  | { type: 'input'; input: Omit<InputEvent, 'gameNow'> }
  | { type: 'tick' }
  | { type: 'control'; cmd: ControlCommand }
  | { type: 'content.reloaded'; version: number; ok: boolean }

export interface HubDeps {
  games: Record<string, GameModule>
  config: HubConfig
  gameConfigs: Record<string, unknown>
  gameData: Record<string, unknown>
  leaderboard: LeaderboardEntry[]
  random: () => number
  newId: () => string
}

export type Effect =
  | { type: 'leaderboard.add'; entry: LeaderboardEntry }
  | { type: 'leaderboard.reset' }
  | { type: 'gameData.set'; gameId: string; data: unknown }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; msg: string }

export interface ReduceResult {
  state: HubState
  effects: Effect[]
  changed: boolean
}

function seatInit(seat: Seat): SeatState {
  return {
    seat,
    connected: false,
    presence: 'absent',
    name: '',
    cursor: 0,
    choice: null,
    held: {},
    hold: null,
    lastInputAt: 0,
    stuck: false,
  }
}

export function initialState(cfg: HubConfig, gameId: string, now: number): HubState {
  return {
    phase: 'ATTRACT',
    gameId,
    seats: { P1: seatInit('P1'), P2: seatInit('P2') },
    countdown: null,
    round: null,
    pause: null,
    results: null,
    idleDeadline: null,
    notice: null,
    errors: 0,
    muted: cfg.audio.muted,
    highWash: cfg.highWash,
    contentVersion: 1,
    seq: 0,
    startedAt: now,
  }
}

export function lobbyOptions(game: GameModule): LobbyOption[] {
  const solo = game.variants
    .filter((v) => v.mode === 'solo')
    .map<LobbyOption>((v) => ({ id: v.id, label: 'Play solo', sub: v.label, blurb: v.blurb, mode: 'solo' }))
  const versus = game.variants.find((v) => v.mode === 'versus')
  if (!versus) return solo
  return [...solo, { id: versus.id, label: 'Play head-to-head', blurb: versus.blurb, mode: 'versus' }]
}

export function roundClock(round: RoundState, now: number): number {
  const paused = round.pausedAt != null ? now - round.pausedAt : 0
  return Math.max(0, now - round.startedAt - round.pausedTotal - paused)
}

export function nameFromLetters(letters: number[]): string {
  return letters.map((i) => NAME_ALPHABET[((i % 26) + 26) % 26] ?? 'A').join('')
}

class Ctx {
  effects: Effect[] = []
  changed = false
  constructor(
    public state: HubState,
    public now: number,
    public deps: HubDeps,
  ) {}
  touch() {
    this.changed = true
  }
  get game(): GameModule {
    const g = this.deps.games[this.state.gameId]
    if (!g) throw new Error(`Unknown game "${this.state.gameId}"`)
    return g
  }
  get t() {
    return this.deps.config.timings
  }
  log(level: 'info' | 'warn' | 'error', msg: string) {
    this.effects.push({ type: 'log', level, msg })
  }
  notice(text: string, ms = 6000) {
    this.state.notice = { text, until: this.now + ms }
    this.touch()
  }
}

export function reduce(prev: HubState, ev: HubEvent, now: number, deps: HubDeps): ReduceResult {
  const ctx = new Ctx(structuredClone(prev), now, deps)
  try {
    handle(ctx, ev)
  } catch (err) {
    const e = err as Error
    ctx.state.errors += 1
    ctx.log('error', `reducer failed on ${ev.type}: ${e.stack ?? e.message}`)
    ctx.state.notice = { text: 'Something went wrong. Back to the lobby.', until: now + 6000 }
    toLobbyOrAttract(ctx)
    ctx.touch()
  }
  if (!ctx.changed) return { state: prev, effects: ctx.effects, changed: false }
  ctx.state.seq = prev.seq + 1
  return { state: ctx.state, effects: ctx.effects, changed: true }
}

function handle(ctx: Ctx, ev: HubEvent) {
  switch (ev.type) {
    case 'seat.connect':
      return onSeatConnect(ctx, ev.seat)
    case 'seat.disconnect':
      return onSeatDisconnect(ctx, ev.seat)
    case 'seat.sync':
      return onSeatSync(ctx, ev.seat)
    case 'input':
      return onInput(ctx, ev.input)
    case 'tick':
      return onTick(ctx)
    case 'control':
      return onControl(ctx, ev.cmd)
    case 'content.reloaded':
      ctx.state.contentVersion = ev.version
      ctx.notice(ev.ok ? 'Content reloaded.' : 'Content reload had errors. See the control panel.')
      return
  }
}

// ---------------------------------------------------------------- seats

function onSeatConnect(ctx: Ctx, seat: Seat) {
  const st = ctx.state
  const s = st.seats[seat]
  s.connected = true
  s.held = {}
  s.hold = null
  s.stuck = false
  switch (st.phase) {
    case 'ATTRACT':
    case 'LOBBY':
    case 'COUNTDOWN':
      s.presence = 'idle'
      break
    case 'PLAYING': {
      const round = st.round
      if (round && round.participants.includes(seat)) {
        s.presence = 'playing'
        if (st.pause) {
          st.pause.seats = st.pause.seats.filter((x) => x !== seat)
          if (st.pause.seats.length === 0 && st.pause.resumeAt == null) {
            st.pause.resumeAt = ctx.now + ctx.t.resumeBeatMs
          }
        }
      } else {
        s.presence = 'watching'
      }
      break
    }
    case 'RESULTS': {
      const r = st.results
      if (r?.naming[seat]) {
        s.presence = 'naming'
        r.namingDeadline = ctx.now + ctx.t.namingCapMs
      } else if (r?.participants.includes(seat)) s.presence = 'done'
      else s.presence = 'watching'
      refreshOffer(ctx)
      break
    }
  }
  ctx.touch()
}

function onSeatDisconnect(ctx: Ctx, seat: Seat) {
  const st = ctx.state
  const s = st.seats[seat]
  if (st.phase === 'PLAYING' && !st.pause) releaseHeld(ctx, seat)
  s.connected = false
  s.held = {}
  s.hold = null
  switch (st.phase) {
    case 'ATTRACT':
    case 'LOBBY':
      s.presence = 'absent'
      s.choice = null
      break
    case 'COUNTDOWN':
      s.presence = 'absent'
      s.choice = null
      recomputeCountdown(ctx)
      break
    case 'PLAYING': {
      const round = st.round
      if (round && round.participants.includes(seat)) {
        if (!st.pause) beginPause(ctx, seat)
        else {
          if (!st.pause.seats.includes(seat)) st.pause.seats.push(seat)
          st.pause.resumeAt = null
        }
      } else {
        s.presence = 'absent'
      }
      break
    }
    case 'RESULTS': {
      const r = st.results
      if (r?.naming[seat]) {
        const grace = ctx.now + ctx.t.namingGraceMs
        r.namingDeadline = r.namingDeadline == null ? grace : Math.min(r.namingDeadline, grace)
      } else {
        s.presence = r?.participants.includes(seat) ? 'done' : 'absent'
      }
      refreshOffer(ctx)
      break
    }
  }
  ctx.touch()
}

function onSeatSync(ctx: Ctx, seat: Seat) {
  const st = ctx.state
  const s = st.seats[seat]
  if (Object.keys(s.held).length === 0 && !s.hold) return
  if (st.phase === 'PLAYING' && !st.pause) releaseHeld(ctx, seat)
  s.held = {}
  s.hold = null
  ctx.touch()
}

/** Synthesise "up" for every key a seat is holding. During PLAYING the game sees them. */
function releaseHeld(ctx: Ctx, seat: Seat) {
  const st = ctx.state
  const s = st.seats[seat]
  const keys = Object.keys(s.held)
  if (keys.length === 0) return
  const round = st.round
  for (const key of keys) {
    const since = s.held[key] ?? ctx.now
    delete s.held[key]
    if (st.phase === 'PLAYING' && round && round.participants.includes(seat) && !st.pause) {
      const gameNow = roundClock(round, ctx.now)
      const ev: InputEvent = {
        seat,
        key,
        type: 'up',
        clientTs: 0,
        serverTs: ctx.now,
        gameNow,
        durationMs: ctx.now - since,
        synthetic: true,
      }
      if (ctx.game.keys.includes(key)) round.gameState = ctx.game.onInput(round.gameState, seat, ev)
    }
  }
  s.hold = null
  ctx.touch()
}

// ---------------------------------------------------------------- input

function onInput(ctx: Ctx, raw: Omit<InputEvent, 'gameNow'>) {
  const st = ctx.state
  const s = st.seats[raw.seat]
  if (!s.connected) return
  if (raw.type === 'down') {
    if (s.held[raw.key] != null) return
    s.held[raw.key] = ctx.now
    s.stuck = false
    s.lastInputAt = ctx.now
    if (st.phase === 'LOBBY') st.idleDeadline = ctx.now + ctx.t.idleToAttractMs
    ctx.touch()
  } else {
    if (s.held[raw.key] == null) return
    delete s.held[raw.key]
    ctx.touch()
  }

  switch (st.phase) {
    case 'ATTRACT':
      if (raw.type === 'down') toLobby(ctx)
      return
    case 'LOBBY':
    case 'COUNTDOWN':
    case 'RESULTS': {
      const g = gesture(ctx, s, raw)
      if (g) onGesture(ctx, s, g)
      return
    }
    case 'PLAYING':
      playingInput(ctx, s, raw)
      return
  }
}

type Gesture = 'tap' | 'hold' | 'repeat' | 'accept'

/** Hub-level space bar semantics: tap (short press) or hold. Holds fire from the tick so feedback is immediate. */
function gesture(ctx: Ctx, s: SeatState, raw: Omit<InputEvent, 'gameNow'>): Gesture | null {
  if (raw.key !== HUB_KEY) return null
  if (raw.type === 'down') {
    s.hold = { key: raw.key, since: ctx.now, consumed: false, repeatAt: 0 }
    return null
  }
  const h = s.hold
  s.hold = null
  if (!h || h.consumed) return null
  const duration = raw.durationMs ?? ctx.now - h.since
  return duration >= holdThreshold(ctx, s) ? 'hold' : 'tap'
}

/** Cancelling a ready choice takes a deliberate hold, so a finger resting on space does not undo it. */
function holdThreshold(ctx: Ctx, s: SeatState): number {
  const st = ctx.state
  if ((st.phase === 'LOBBY' || st.phase === 'COUNTDOWN') && s.presence === 'ready') return ctx.t.acceptHoldMs
  return ctx.t.holdMs
}

function tickGestures(ctx: Ctx) {
  const st = ctx.state
  if (st.phase !== 'LOBBY' && st.phase !== 'COUNTDOWN' && st.phase !== 'RESULTS') return
  for (const seat of SEATS) {
    const s = st.seats[seat]
    const h = s.hold
    if (!s.connected || !h) continue
    const heldFor = ctx.now - h.since
    const isOfferTarget = st.phase === 'RESULTS' && st.results?.offer?.to === seat
    if (isOfferTarget) {
      if (!h.consumed && heldFor >= ctx.t.acceptHoldMs) {
        h.consumed = true
        onGesture(ctx, s, 'accept')
      }
      continue
    }
    if (!h.consumed) {
      if (heldFor >= holdThreshold(ctx, s)) {
        h.consumed = true
        h.repeatAt = s.presence === 'idle' ? ctx.now + ctx.t.cycleRepeatMs : 0
        onGesture(ctx, s, 'hold')
      }
    } else if (h.repeatAt && ctx.now >= h.repeatAt) {
      h.repeatAt += ctx.t.cycleRepeatMs
      onGesture(ctx, s, 'repeat')
    }
  }
}

function onGesture(ctx: Ctx, s: SeatState, g: Gesture) {
  const st = ctx.state
  if (st.phase === 'LOBBY' || st.phase === 'COUNTDOWN') {
    const options = lobbyOptions(ctx.game)
    if (options.length === 0) return
    if (g === 'tap') {
      if (s.presence === 'idle') {
        const opt = options[Math.min(s.cursor, options.length - 1)]
        if (!opt) return
        s.choice = opt.id
        s.presence = 'ready'
        recomputeCountdown(ctx)
        ctx.touch()
      }
      return
    }
    if (g === 'hold' && s.presence === 'ready') {
      s.presence = 'idle'
      s.choice = null
      recomputeCountdown(ctx)
      ctx.touch()
      return
    }
    if ((g === 'hold' || g === 'repeat') && s.presence === 'idle') {
      s.cursor = (s.cursor + 1) % options.length
      ctx.touch()
    }
    return
  }

  if (st.phase === 'RESULTS') {
    const r = st.results
    if (!r) return
    const naming = r.naming[s.seat]
    if (naming) {
      if (g === 'tap') {
        const i = naming.cursor
        naming.letters[i] = ((naming.letters[i] ?? 0) + 1) % NAME_ALPHABET.length
        ctx.touch()
      } else if (g === 'hold') {
        naming.cursor += 1
        ctx.touch()
        if (naming.cursor >= naming.letters.length) submitName(ctx, s.seat)
      }
      return
    }
    if (g === 'accept' && r.offer?.to === s.seat) {
      acceptOffer(ctx)
      return
    }
    if (g === 'tap' && r.holdEndsAt != null && !r.offer && ctx.now >= r.restartAfter) {
      toLobby(ctx)
    }
  }
}

function playingInput(ctx: Ctx, s: SeatState, raw: Omit<InputEvent, 'gameNow'>) {
  const st = ctx.state
  const round = st.round
  if (!round) return
  if (!round.participants.includes(s.seat)) {
    if (s.presence === 'idle') {
      s.presence = 'watching'
      ctx.touch()
    }
    return
  }
  if (st.pause) return
  const game = ctx.game
  if (!game.keys.includes(raw.key)) return
  const ev: InputEvent = { ...raw, gameNow: roundClock(round, ctx.now) }
  const next = game.onInput(round.gameState, s.seat, ev)
  if (next !== round.gameState) {
    round.gameState = next
    ctx.touch()
  }
  checkOver(ctx)
}

// ---------------------------------------------------------------- tick

function onTick(ctx: Ctx) {
  const st = ctx.state
  if (st.notice && ctx.now >= st.notice.until) {
    st.notice = null
    ctx.touch()
  }
  stuckWatch(ctx)
  tickGestures(ctx)
  switch (st.phase) {
    case 'ATTRACT':
      return
    case 'LOBBY':
      if (st.idleDeadline != null && ctx.now >= st.idleDeadline) toAttract(ctx)
      return
    case 'COUNTDOWN':
      if (st.countdown && ctx.now >= st.countdown.endsAt) startRound(ctx)
      return
    case 'PLAYING': {
      const round = st.round
      if (!round) {
        toLobbyOrAttract(ctx)
        return
      }
      if (st.pause) {
        // Once everyone is back the resume beat always completes; the grace clock no longer applies.
        if (st.pause.resumeAt != null) {
          if (ctx.now >= st.pause.resumeAt) resume(ctx)
        } else if (ctx.now >= st.pause.graceEndsAt) {
          graceExpired(ctx)
        }
        return
      }
      const next = ctx.game.onTick(round.gameState, roundClock(round, ctx.now))
      if (next !== round.gameState) {
        round.gameState = next
        ctx.touch()
      }
      checkOver(ctx)
      return
    }
    case 'RESULTS': {
      const r = st.results
      if (!r) {
        toLobbyOrAttract(ctx)
        return
      }
      if (r.namingDeadline != null && ctx.now >= r.namingDeadline) {
        // Present players get their letters as typed; a seat that never came back is dropped, not written as AAA.
        for (const seat of SEATS) {
          if (!r.naming[seat]) continue
          if (st.seats[seat].connected) submitName(ctx, seat)
          else dropNaming(ctx, seat)
        }
      }
      if (r.holdEndsAt != null && ctx.now >= r.holdEndsAt) toLobbyOrAttract(ctx)
      return
    }
  }
}

function stuckWatch(ctx: Ctx) {
  const st = ctx.state
  for (const seat of SEATS) {
    const s = st.seats[seat]
    for (const [key, since] of Object.entries(s.held)) {
      if (ctx.now - since < ctx.t.stuckKeyMs) continue
      s.stuck = true
      ctx.log('warn', `${seat}: key ${key} held for ${ctx.now - since}ms, treating as stuck`)
      releaseHeld(ctx, seat)
      ctx.touch()
      break
    }
  }
}

// ---------------------------------------------------------------- lobby & countdown

function recomputeCountdown(ctx: Ctx) {
  const st = ctx.state
  const game = ctx.game
  const ready = SEATS.filter((seat) => st.seats[seat].connected && st.seats[seat].presence === 'ready')
  if (ready.length === 0) {
    st.countdown = null
    if (st.phase === 'COUNTDOWN') {
      st.phase = 'LOBBY'
      st.idleDeadline = ctx.now + ctx.t.idleToAttractMs
    }
    ctx.touch()
    return
  }
  const versus = game.variants.find((v) => v.mode === 'versus')
  const soloVariants = game.variants.filter((v) => v.mode === 'solo')

  if (ready.length === 2 && versus) {
    if (!st.countdown || st.countdown.mode !== 'versus') {
      st.countdown = {
        endsAt: ctx.now + ctx.t.versusCountdownMs,
        mode: 'versus',
        variantId: versus.id,
        participants: [...ready],
        joinable: false,
      }
    }
  } else {
    const seat = ready[0] as Seat
    const choice = st.seats[seat].choice
    const variant =
      soloVariants.find((v) => v.id === choice) ?? soloVariants.find((v) => v.scored) ?? soloVariants[0]
    if (!variant) {
      // A versus-only game with one player ready: keep the lobby open, the other seat can still join.
      st.countdown = null
      st.phase = 'LOBBY'
      st.idleDeadline = ctx.now + ctx.t.idleToAttractMs
      ctx.touch()
      return
    }
    const same =
      st.countdown && st.countdown.mode === 'solo' && st.countdown.participants[0] === seat
    if (!same) {
      st.countdown = {
        endsAt: ctx.now + ctx.t.soloCountdownMs,
        mode: 'solo',
        variantId: variant.id,
        participants: [seat],
        joinable: Boolean(versus),
      }
    } else if (st.countdown) {
      st.countdown.variantId = variant.id
    }
  }
  st.phase = 'COUNTDOWN'
  st.idleDeadline = null
  ctx.touch()
}

function startRound(ctx: Ctx) {
  const st = ctx.state
  const cd = st.countdown
  if (!cd) {
    toLobby(ctx)
    return
  }
  const game = ctx.game
  const names: Partial<Record<Seat, string>> = {}
  for (const seat of cd.participants) if (st.seats[seat].name) names[seat] = st.seats[seat].name
  const gameState = game.init({
    mode: cd.mode,
    variantId: cd.variantId,
    participants: [...cd.participants],
    names,
    config: ctx.deps.gameConfigs[game.id] ?? game.defaultConfig,
    data: ctx.deps.gameData[game.id],
    leaderboard: ctx.deps.leaderboard.filter((e) => e.gameId === game.id),
    seed: Math.floor(ctx.deps.random() * 2 ** 31),
  })
  st.round = {
    mode: cd.mode,
    variantId: cd.variantId,
    participants: [...cd.participants],
    startedAt: ctx.now,
    pausedAt: null,
    pausedTotal: 0,
    gameState,
  }
  for (const seat of SEATS) {
    const s = st.seats[seat]
    s.held = {}
    s.hold = null
    if (cd.participants.includes(seat)) s.presence = 'playing'
    else s.presence = s.connected ? 'watching' : 'absent'
    s.choice = null
  }
  st.countdown = null
  st.pause = null
  st.results = null
  st.idleDeadline = null
  st.phase = 'PLAYING'
  ctx.touch()
  checkOver(ctx)
}

// ---------------------------------------------------------------- playing

function checkOver(ctx: Ctx): boolean {
  const st = ctx.state
  const round = st.round
  if (!round || st.phase !== 'PLAYING') return false
  const outcome = ctx.game.outcome(round.gameState)
  if (!outcome.over) return false
  enterResults(ctx, outcome)
  return true
}

function beginPause(ctx: Ctx, seat: Seat) {
  const st = ctx.state
  const round = st.round
  if (!round) return
  for (const p of round.participants) releaseHeld(ctx, p)
  if (checkOver(ctx)) return
  const gameNow = roundClock(round, ctx.now)
  round.pausedAt = ctx.now
  const grace = round.mode === 'versus' ? ctx.t.pauseGraceVersusMs : ctx.t.pauseGraceSoloMs
  st.pause = { seats: [seat], since: ctx.now, graceEndsAt: ctx.now + grace, resumeAt: null }
  const game = ctx.game
  if (game.onPause) round.gameState = game.onPause(round.gameState, gameNow)
  ctx.touch()
}

function resume(ctx: Ctx) {
  const st = ctx.state
  const round = st.round
  if (!round || !st.pause) return
  if (round.pausedAt != null) {
    round.pausedTotal += ctx.now - round.pausedAt
    round.pausedAt = null
  }
  st.pause = null
  const game = ctx.game
  if (game.onResume) round.gameState = game.onResume(round.gameState, roundClock(round, ctx.now))
  ctx.touch()
}

/** The pause grace ran out. Whoever is still missing loses; if everyone is missing the round is abandoned. */
function graceExpired(ctx: Ctx) {
  const st = ctx.state
  const round = st.round
  const pause = st.pause
  if (!round || !pause) return
  const missing = round.participants.filter((p) => pause.seats.includes(p))
  const present = round.participants.filter((p) => !pause.seats.includes(p))
  if (missing.length === 0) {
    resume(ctx)
    return
  }
  if (present.length === 0 || round.mode === 'solo') {
    if (round.pausedAt != null) {
      round.pausedTotal += ctx.now - round.pausedAt
      round.pausedAt = null
    }
    st.pause = null
    ctx.notice('Round abandoned.', 5000)
    toLobbyOrAttract(ctx)
    return
  }
  forfeit(ctx, missing[0] as Seat)
}

function forfeit(ctx: Ctx, seat: Seat) {
  const st = ctx.state
  const round = st.round
  if (!round) return
  if (round.pausedAt != null) {
    round.pausedTotal += ctx.now - round.pausedAt
    round.pausedAt = null
  }
  st.pause = null
  const game = ctx.game
  if (round.mode === 'versus') {
    const gameNow = roundClock(round, ctx.now)
    if (game.onForfeit) round.gameState = game.onForfeit(round.gameState, seat, gameNow)
    let outcome = game.outcome(round.gameState)
    const winner = otherSeat(seat)
    if (!outcome.over) {
      outcome = {
        ...outcome,
        over: true,
        winner,
        headline: `${winner} wins. ${seat} left the game.`,
      }
    }
    enterResults(ctx, outcome)
  } else {
    ctx.notice('Round abandoned.', 5000)
    toLobbyOrAttract(ctx)
  }
}

// ---------------------------------------------------------------- results

function enterResults(ctx: Ctx, outcome: GameOutcome) {
  const st = ctx.state
  const round = st.round
  if (!round) return
  const game = ctx.game
  const variant = game.variants.find((v) => v.id === round.variantId)
  const naming: Partial<Record<Seat, NamingState>> = {}
  for (const seat of round.participants) {
    const s = st.seats[seat]
    const so = outcome.seats[seat]
    if (variant?.scored && so?.qualifies && s.connected) {
      naming[seat] = { letters: [0, 0, 0], cursor: 0 }
      s.presence = 'naming'
    } else {
      s.presence = 'done'
    }
    s.held = {}
    s.hold = null
  }
  const anyNaming = Object.keys(naming).length > 0
  st.results = {
    outcome,
    mode: round.mode,
    variantId: round.variantId,
    participants: [...round.participants],
    gameState: round.gameState,
    gameNow: roundClock(round, ctx.now),
    holdEndsAt: anyNaming ? null : ctx.now + ctx.t.resultsHoldMs,
    namingDeadline: anyNaming ? ctx.now + ctx.t.namingCapMs : null,
    naming,
    entries: [],
    offer: null,
    restartAfter: ctx.now + ctx.t.resultsMinMs,
  }
  if (outcome.data !== undefined) ctx.effects.push({ type: 'gameData.set', gameId: game.id, data: outcome.data })
  st.round = null
  st.pause = null
  st.countdown = null
  st.phase = 'RESULTS'
  refreshOffer(ctx)
  ctx.touch()
}

/** Hot-join: after a solo round, a watching seat can hold space to start head-to-head. */
function refreshOffer(ctx: Ctx) {
  const st = ctx.state
  const r = st.results
  if (!r) return
  const versus = ctx.game.variants.find((v) => v.mode === 'versus')
  const from = r.participants[0]
  if (r.mode !== 'solo' || !versus || !from) {
    r.offer = null
    return
  }
  const to = otherSeat(from)
  const other = st.seats[to]
  const eligible = other.connected && (other.presence === 'watching' || other.presence === 'idle')
  const fromPresent = st.seats[from].connected
  const namingDone = Object.keys(r.naming).length === 0
  r.offer = eligible && fromPresent && namingDone ? { to, from } : null
}

/** Drop a name entry without writing anything (the seat never came back). */
function dropNaming(ctx: Ctx, seat: Seat) {
  const st = ctx.state
  const r = st.results
  if (!r?.naming[seat]) return
  delete r.naming[seat]
  st.seats[seat].presence = st.seats[seat].connected ? 'done' : 'absent'
  if (Object.keys(r.naming).length === 0) {
    r.holdEndsAt = ctx.now + ctx.t.resultsHoldMs
    r.namingDeadline = null
    refreshOffer(ctx)
  }
  ctx.touch()
}

function submitName(ctx: Ctx, seat: Seat) {
  const st = ctx.state
  const r = st.results
  if (!r) return
  const naming = r.naming[seat]
  if (!naming) return
  const so = r.outcome.seats[seat]
  const name = nameFromLetters(naming.letters)
  delete r.naming[seat]
  const s = st.seats[seat]
  s.name = name
  s.presence = 'done'
  if (so) {
    const entry: LeaderboardEntry = {
      id: ctx.deps.newId(),
      name,
      score: so.score,
      scoreText: so.scoreText,
      gameId: st.gameId,
      variantId: r.variantId,
      mode: r.mode,
      at: ctx.now,
      detail: so.detail,
    }
    r.entries.push(entry)
    ctx.effects.push({ type: 'leaderboard.add', entry })
    const game = ctx.game
    if (game.onName) {
      const data = game.onName(ctx.deps.gameData[game.id], { seat, name, at: ctx.now })
      if (data !== undefined) ctx.effects.push({ type: 'gameData.set', gameId: game.id, data })
    }
  }
  if (Object.keys(r.naming).length === 0) {
    r.holdEndsAt = ctx.now + ctx.t.resultsHoldMs
    r.namingDeadline = null
    refreshOffer(ctx)
  }
  ctx.touch()
}

function acceptOffer(ctx: Ctx) {
  const st = ctx.state
  const r = st.results
  if (!r?.offer) return
  const { to, from } = r.offer
  if (!st.seats[from].connected || !st.seats[to].connected) {
    r.offer = null
    ctx.touch()
    return
  }
  for (const seat of SEATS) if (r.naming[seat]) submitName(ctx, seat)
  const versus = ctx.game.variants.find((v) => v.mode === 'versus')
  if (!versus) return
  for (const seat of [from, to]) {
    const s = st.seats[seat]
    s.presence = 'ready'
    s.choice = versus.id
    s.hold = null
  }
  st.results = null
  st.countdown = {
    endsAt: ctx.now + ctx.t.versusCountdownMs,
    mode: 'versus',
    variantId: versus.id,
    participants: [from, to],
    joinable: false,
  }
  st.phase = 'COUNTDOWN'
  st.idleDeadline = null
  ctx.touch()
}

// ---------------------------------------------------------------- phase changes

function resetForPhase(ctx: Ctx, presence: (s: SeatState) => Presence) {
  const st = ctx.state
  if (st.phase === 'RESULTS' && st.results) {
    // An operator skip or a force must not throw away a legitimate score: write the letters as typed.
    for (const seat of SEATS) {
      if (!st.results.naming[seat]) continue
      if (st.seats[seat].connected) submitName(ctx, seat)
      else dropNaming(ctx, seat)
    }
  }
  st.countdown = null
  st.round = null
  st.pause = null
  st.results = null
  for (const seat of SEATS) {
    const s = st.seats[seat]
    s.presence = presence(s)
    s.choice = null
    s.hold = null
  }
}

export function toLobby(ctx: Ctx) {
  const st = ctx.state
  resetForPhase(ctx, (s) => (s.connected ? 'idle' : 'absent'))
  st.phase = 'LOBBY'
  st.idleDeadline = ctx.now + ctx.t.idleToAttractMs
  ctx.touch()
}

function toAttract(ctx: Ctx) {
  const st = ctx.state
  resetForPhase(ctx, (s) => (s.connected ? 'idle' : 'absent'))
  for (const seat of SEATS) {
    st.seats[seat].name = ''
    st.seats[seat].cursor = 0
  }
  st.phase = 'ATTRACT'
  st.idleDeadline = null
  ctx.touch()
}

function toLobbyOrAttract(ctx: Ctx) {
  const anyConnected = SEATS.some((seat) => ctx.state.seats[seat].connected)
  if (anyConnected) toLobby(ctx)
  else toAttract(ctx)
}

// ---------------------------------------------------------------- control

function onControl(ctx: Ctx, cmd: ControlCommand) {
  const st = ctx.state
  switch (cmd.cmd) {
    case 'selectGame': {
      if (!ctx.deps.games[cmd.gameId]) {
        ctx.log('warn', `selectGame: unknown game ${cmd.gameId}`)
        return
      }
      if (st.gameId === cmd.gameId) return
      st.gameId = cmd.gameId
      for (const seat of SEATS) st.seats[seat].cursor = 0
      if (st.phase === 'ATTRACT') resetForPhase(ctx, (s) => (s.connected ? 'idle' : 'absent'))
      else toLobbyOrAttract(ctx)
      ctx.touch()
      return
    }
    case 'start': {
      if (st.phase === 'ATTRACT') {
        toLobby(ctx)
        return
      }
      if (st.phase === 'LOBBY') {
        const options = lobbyOptions(ctx.game)
        for (const seat of SEATS) {
          const s = st.seats[seat]
          if (s.connected && s.presence === 'idle') {
            s.presence = 'ready'
            s.choice = options[Math.min(s.cursor, options.length - 1)]?.id ?? null
          }
        }
        recomputeCountdown(ctx)
        if (st.countdown) st.countdown.endsAt = ctx.now + ctx.t.versusCountdownMs
        ctx.touch()
        return
      }
      if (st.phase === 'COUNTDOWN' && st.countdown) {
        st.countdown.endsAt = ctx.now
        ctx.touch()
      }
      return
    }
    case 'skip': {
      switch (st.phase) {
        case 'ATTRACT':
          toLobby(ctx)
          return
        case 'LOBBY':
          toAttract(ctx)
          return
        case 'COUNTDOWN':
          if (st.countdown) st.countdown.endsAt = ctx.now
          ctx.touch()
          return
        case 'PLAYING':
          endRoundByOperator(ctx)
          return
        case 'RESULTS':
          toLobbyOrAttract(ctx)
          return
      }
      return
    }
    case 'endRound':
      if (st.phase === 'PLAYING') endRoundByOperator(ctx)
      else if (st.phase === 'COUNTDOWN') toLobby(ctx)
      return
    case 'resetScores':
      ctx.effects.push({ type: 'leaderboard.reset' })
      ctx.notice('Leaderboard cleared.')
      return
    case 'forceAttract':
      toAttract(ctx)
      return
    case 'kick':
      kick(ctx, cmd.seat)
      return
    case 'mute':
      if (st.muted !== cmd.muted) {
        st.muted = cmd.muted
        ctx.touch()
      }
      return
    case 'highWash':
      if (st.highWash !== cmd.on) {
        st.highWash = cmd.on
        ctx.touch()
      }
      return
    case 'reloadContent':
      // Handled by the runtime, which then dispatches content.reloaded.
      return
    case 'hardReset': {
      const fresh = initialState(ctx.deps.config, st.gameId, ctx.now)
      for (const seat of SEATS) {
        fresh.seats[seat].connected = st.seats[seat].connected
        fresh.seats[seat].presence = st.seats[seat].connected ? 'idle' : 'absent'
      }
      fresh.muted = st.muted
      fresh.highWash = st.highWash
      fresh.contentVersion = st.contentVersion
      fresh.startedAt = st.startedAt
      ctx.state = fresh
      ctx.notice('Session reset.')
      ctx.touch()
      return
    }
  }
}

function endRoundByOperator(ctx: Ctx) {
  const st = ctx.state
  const round = st.round
  if (!round) return
  if (round.pausedAt != null) {
    round.pausedTotal += ctx.now - round.pausedAt
    round.pausedAt = null
  }
  st.pause = null
  const base = ctx.game.outcome(round.gameState)
  const seats: GameOutcome['seats'] = {}
  for (const seat of round.participants) {
    const so = base.seats[seat]
    seats[seat] = so ? { ...so, qualifies: false } : { score: 0, scoreText: '—', qualifies: false }
  }
  enterResults(ctx, { ...base, over: true, seats, headline: base.headline ?? 'Round ended by the operator.' })
}

function kick(ctx: Ctx, seat: Seat) {
  const st = ctx.state
  const s = st.seats[seat]
  const participant = st.round?.participants.includes(seat) ?? false
  if (st.phase === 'PLAYING' && participant) {
    if (st.round?.mode === 'versus') {
      st.pause = null
      forfeit(ctx, seat)
    } else {
      ctx.notice(`${seat} was reset by the operator.`)
      toLobbyOrAttract(ctx)
    }
  } else if (st.phase === 'COUNTDOWN' && st.countdown?.participants.includes(seat)) {
    s.presence = 'idle'
    s.choice = null
    recomputeCountdown(ctx)
  } else if (st.phase === 'RESULTS' && st.results) {
    const r = st.results
    if (r.naming[seat]) {
      delete r.naming[seat]
      if (Object.keys(r.naming).length === 0) {
        r.holdEndsAt = ctx.now + ctx.t.resultsHoldMs
        r.namingDeadline = null
      }
    }
    if (r.offer?.to === seat) r.offer = null
  }
  s.name = ''
  s.cursor = 0
  s.choice = null
  s.held = {}
  s.hold = null
  s.stuck = false
  if (!s.connected) s.presence = 'absent'
  else if (st.phase === 'PLAYING') s.presence = st.round?.participants.includes(seat) ? 'playing' : 'watching'
  else if (st.phase === 'RESULTS') s.presence = 'done'
  else s.presence = 'idle'
  ctx.notice(`${seat} was reset.`, 4000)
  ctx.touch()
}
