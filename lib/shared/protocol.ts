// Socket event names and the three view payloads. Imported by both server and client (types + constants only).

import type { GameOutcome, LeaderboardEntry, Mode, Seat, SeatOutcome } from '@/games/types'

export type Role = 'display' | 'play' | 'control'
export type Phase = 'ATTRACT' | 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'RESULTS'
export type Presence = 'absent' | 'idle' | 'ready' | 'playing' | 'watching' | 'naming' | 'done'

export const EVENTS = {
  // client -> server
  input: 'input',
  sync: 'seat:sync',
  ping: 'hub:ping',
  control: 'control:cmd',
  // server -> client
  displayView: 'display:view',
  playerView: 'player:view',
  controlView: 'control:view',
  pong: 'hub:pong',
  superseded: 'seat:superseded',
  contentVersion: 'content:version',
  error: 'hub:error',
} as const

export interface HandshakeAuth {
  role: Role
  seat?: Seat
  deviceId: string
  tabId: string
}

export interface ClientInput {
  key: string
  type: 'down' | 'up'
  clientTs: number
  durationMs?: number
  gapMs?: number
}

export type ControlCommand =
  | { cmd: 'selectGame'; gameId: string }
  | { cmd: 'start' }
  | { cmd: 'skip' }
  | { cmd: 'endRound' }
  | { cmd: 'resetScores' }
  | { cmd: 'forceAttract' }
  | { cmd: 'kick'; seat: Seat }
  | { cmd: 'mute'; muted: boolean }
  | { cmd: 'highWash'; on: boolean }
  | { cmd: 'reloadContent' }
  | { cmd: 'hardReset' }

export interface SeatSummary {
  seat: Seat
  connected: boolean
  presence: Presence
  name: string
  stuck: boolean
}

export interface LobbyOption {
  id: string
  label: string
  sub?: string
  blurb?: string
  mode: Mode
}

export interface CountdownView {
  endsAt: number
  mode: Mode
  variantLabel: string
  participants: Seat[]
  /** Solo countdown that a second player can still join. */
  joinable: boolean
}

export interface PauseView {
  /** Participants currently disconnected. The first is the one named on screen. */
  seats: Seat[]
  graceEndsAt: number
  resumeAt: number | null
}

export interface ResultsSeat extends SeatOutcome {
  name: string
}

export interface ResultsView {
  headline: string
  mode: Mode
  variantId: string
  variantLabel: string
  winner: Seat | null | undefined
  seats: Partial<Record<Seat, ResultsSeat>>
  /** null while someone is still entering a name. */
  holdEndsAt: number | null
  naming: Seat[]
  /** Hot-join offer: which seat can hold space to start head-to-head. */
  offer: { to: Seat; from: Seat } | null
  entries: LeaderboardEntry[]
}

interface CommonView {
  seq: number
  serverNow: number
  phase: Phase
  gameId: string
  gameName: string
  seats: Record<Seat, SeatSummary>
  countdown: CountdownView | null
  pause: PauseView | null
  notice: string | null
  contentVersion: number
  muted: boolean
  highWash: boolean
  reducedMotion: boolean
  holdMs: number
  variants: Array<{ id: string; label: string; mode: Mode; scored: boolean; order: 'desc' | 'asc' }>
}

export interface DisplayView extends CommonView {
  lobby: {
    options: LobbyOption[]
    cursors: Record<Seat, number>
    ready: Record<Seat, string | null>
  } | null
  game: unknown | null
  results: ResultsView | null
  leaderboard: LeaderboardEntry[]
  idleDeadline: number | null
  attractCardMs: number
}

export interface PlayerView extends CommonView {
  seat: Seat | null
  presence: Presence
  name: string
  other: SeatSummary | null
  lobby: {
    options: LobbyOption[]
    cursor: number
    ready: string | null
    otherReady: string | null
  } | null
  game: unknown | null
  results: {
    headline: string
    you: ResultsSeat | null
    winner: Seat | null | undefined
    naming: { letters: string[]; cursor: number; deadline: number | null } | null
    /** 'toYou': hold space to play head-to-head. 'pending': the other seat is deciding. */
    offer: 'toYou' | 'pending' | null
    canRestart: boolean
    holdEndsAt: number | null
  } | null
  keys: string[]
  audio: { p1Hz: number; p2Hz: number }
}

export interface ControlView extends CommonView {
  games: Array<{ id: string; name: string }>
  sockets: { display: number; play: number; control: number }
  seatsDetail: Record<Seat, SeatSummary & { deviceId: string | null; rtt: number | null }>
  results: ResultsView | null
  leaderboard: LeaderboardEntry[]
  content: { ok: boolean; error: string | null; loadedAt: number }
  errors: number
  uptimeMs: number
  ips: string[]
  port: number
  outcomePreview: GameOutcome | null
}

export const NAME_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
