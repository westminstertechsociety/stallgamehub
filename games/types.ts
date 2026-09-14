// The game module contract. A game is one folder under games/ plus one line in each registry.
// server.ts implements GameModule (pure functions, no I/O). views.tsx implements GameViews.
// Anything both sides need (constants, view types) lives in shared.ts.

import type { ComponentType } from 'react'
import type { ZodType } from 'zod'

export type Seat = 'P1' | 'P2'
export const SEATS = ['P1', 'P2'] as const satisfies readonly Seat[]
export type Mode = 'solo' | 'versus'

export function otherSeat(seat: Seat): Seat {
  return seat === 'P1' ? 'P2' : 'P1'
}

/** One way to play a game. The lobby lists solo variants under "Play solo" and the versus variant as "Play head-to-head". */
export interface GameVariant {
  id: string
  /** Shown to players: "Learn", "Time attack", "Ghost race", "Head-to-head". */
  label: string
  mode: Mode
  /** Results go on the leaderboard. */
  scored: boolean
  /** How to rank leaderboard scores for this variant. */
  order: 'desc' | 'asc'
  /** One plain sentence for the lobby. */
  blurb?: string
}

/**
 * Normalised input. Games never see DOM events.
 * clientTs comes from the player's own monotonic clock; durationMs and gapMs are measured on that clock,
 * so Wi-Fi jitter cannot turn a dot into a dash. serverTs orders events across seats. gameNow is the round
 * clock (ms since the round started, pauses excluded) and is what games should use for their own timers.
 */
export interface InputEvent {
  seat: Seat
  /** KeyboardEvent.code, e.g. "Space". */
  key: string
  type: 'down' | 'up'
  clientTs: number
  serverTs: number
  gameNow: number
  /** For "up": how long the key was held, measured on the client. */
  durationMs?: number
  /** For "down": time since this key's previous "up", measured on the client. Absent for the first press. */
  gapMs?: number
  /** True when the hub synthesised this event (pause, stuck key, disconnect) rather than a player producing it. */
  synthetic?: boolean
}

export interface LeaderboardEntry {
  id: string
  name: string
  score: number
  /** Formatted score for display, e.g. "4.2s" or "2–1". */
  scoreText: string
  gameId: string
  variantId: string
  mode: Mode
  at: number
  detail?: string
}

export interface GameContext<C = unknown> {
  mode: Mode
  variantId: string
  /** Seats actually playing this round. One seat in solo, two in versus. */
  participants: Seat[]
  names: Partial<Record<Seat, string>>
  /** Frozen snapshot of config/<gameId>.json for the whole round. */
  config: C
  /** The game's own persisted data (for example recorded ghost runs). Read-only snapshot. */
  data: unknown
  /** Leaderboard entries for this game. */
  leaderboard: LeaderboardEntry[]
  seed: number
}

export interface SeatOutcome {
  score: number
  scoreText: string
  /** Goes on the leaderboard (the hub also checks the variant is scored). */
  qualifies: boolean
  detail?: string
}

export interface GameOutcome {
  over: boolean
  /** Versus only. null means a draw. */
  winner?: Seat | null
  seats: Partial<Record<Seat, SeatOutcome>>
  /** One line for the projector: "HELLO in 4.2s", "P1 wins 2–1". */
  headline?: string
  /** When present, replaces the game's persisted data (e.g. a new best ghost run). */
  data?: unknown
}

export interface GameModule<S = unknown, DV = unknown, PV = unknown, C = unknown> {
  id: string
  name: string
  modes: Mode[]
  variants: GameVariant[]
  /** KeyboardEvent.code values the game wants during PLAYING. Everything else is dropped before it reaches the game. */
  keys: string[]
  configSchema: ZodType<C>
  defaultConfig: C
  /** Always SERVER_MARKER from games/server-marker.ts. The build fails if it reaches the client bundle. */
  serverMarker: string
  init(ctx: GameContext<C>): S
  onInput(state: S, seat: Seat, input: InputEvent): S
  onTick(state: S, gameNow: number): S
  /** A participant dropped: the hub has already synthesised "up" for every held key. */
  onPause?(state: S, gameNow: number): S
  onResume?(state: S, gameNow: number): S
  /** A participant is gone for good (grace expired or kicked). Return a state whose outcome() is over. */
  onForfeit?(state: S, seat: Seat, gameNow: number): S
  outcome(state: S): GameOutcome
  /** What the projector sees. gameNow is the round clock at build time so views can extrapolate locally. */
  displayView(state: S, gameNow: number): DV
  /** What one seat sees. Private per seat: P1's view can differ from P2's. */
  playerView(state: S, seat: Seat, gameNow: number): PV
  /** A player entered their name after the round: attach it to anything the game persisted (ghost runs). */
  onName?(data: unknown, info: { seat: Seat; name: string; at: number }): unknown
}

/** Keys currently held on this laptop: code -> performance.now() when pressed. Used for local prediction. */
export type HeldKeys = Record<string, number>

export interface GameDisplayProps<DV> {
  view: DV
  names: Record<Seat, string>
  /** Server time when this view was built; pair with serverNow() to extrapolate the round clock. */
  builtAt: number
  serverNow: () => number
  reducedMotion: boolean
}

export interface GamePlayerProps<PV> {
  view: PV
  seat: Seat
  held: HeldKeys
  /** performance.now() at render; ticks continuously while a key is held. */
  localNow: number
  builtAt: number
  serverNow: () => number
  reducedMotion: boolean
}

export interface GameViews<DV = unknown, PV = unknown> {
  Display: ComponentType<GameDisplayProps<DV>>
  Player: ComponentType<GamePlayerProps<PV>>
}
