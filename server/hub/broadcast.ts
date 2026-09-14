// Builds the three view payloads from hub state. Views are what clients render; they never see raw state.

import { SEATS, type GameModule, type LeaderboardEntry, type Seat } from '@/games/types'
import type {
  ControlView,
  CountdownView,
  DisplayView,
  LobbyOption,
  PauseView,
  PlayerView,
  ResultsView,
  SeatSummary,
} from '@/lib/shared/protocol'
import type { HubDeps, HubState, SeatState } from './session'
import { lobbyOptions, roundClock } from './session'

export interface ViewExtras {
  reducedMotion: boolean
}

function seatSummary(s: SeatState): SeatSummary {
  return { seat: s.seat, connected: s.connected, presence: s.presence, name: s.name, stuck: s.stuck }
}

function variantLabel(game: GameModule, id: string): string {
  return game.variants.find((v) => v.id === id)?.label ?? id
}

function variantsOf(game: GameModule) {
  return game.variants.map((v) => ({ id: v.id, label: v.label, mode: v.mode, scored: v.scored, order: v.order }))
}

function countdownView(st: HubState, game: GameModule): CountdownView | null {
  const cd = st.countdown
  if (!cd) return null
  return {
    endsAt: cd.endsAt,
    mode: cd.mode,
    variantLabel: variantLabel(game, cd.variantId),
    participants: cd.participants,
    joinable: cd.joinable,
  }
}

function pauseView(st: HubState): PauseView | null {
  const p = st.pause
  if (!p) return null
  return { seats: [...p.seats], graceEndsAt: p.graceEndsAt, resumeAt: p.resumeAt }
}

function resultsView(st: HubState, game: GameModule): ResultsView | null {
  const r = st.results
  if (!r) return null
  const seats: ResultsView['seats'] = {}
  for (const seat of SEATS) {
    const so = r.outcome.seats[seat]
    if (so) seats[seat] = { ...so, name: st.seats[seat].name }
  }
  return {
    headline: r.outcome.headline ?? '',
    mode: r.mode,
    variantId: r.variantId,
    variantLabel: variantLabel(game, r.variantId),
    winner: r.outcome.winner,
    seats,
    holdEndsAt: r.holdEndsAt,
    naming: SEATS.filter((seat) => Boolean(r.naming[seat])),
    offer: r.offer,
    entries: r.entries,
  }
}

/** Top entries for a game, best first per variant. */
export function topEntries(entries: LeaderboardEntry[], game: GameModule, perVariant: number): LeaderboardEntry[] {
  const out: LeaderboardEntry[] = []
  for (const v of game.variants) {
    if (!v.scored) continue
    const rows = entries
      .filter((e) => e.gameId === game.id && e.variantId === v.id)
      .sort((a, b) => (v.order === 'asc' ? a.score - b.score : b.score - a.score) || a.at - b.at)
      .slice(0, perVariant)
    out.push(...rows)
  }
  return out
}

function gameNowOf(st: HubState, now: number): number {
  if (st.round) return roundClock(st.round, now)
  return st.results?.gameNow ?? 0
}

function safeView<T>(label: string, fn: () => T): T | null {
  try {
    return fn()
  } catch (err) {
    console.error(`${label} view failed:`, err)
    return null
  }
}

function common(st: HubState, deps: HubDeps, game: GameModule, now: number, extras: ViewExtras) {
  return {
    seq: st.seq,
    serverNow: now,
    phase: st.phase,
    gameId: st.gameId,
    gameName: game.name,
    seats: { P1: seatSummary(st.seats.P1), P2: seatSummary(st.seats.P2) },
    countdown: countdownView(st, game),
    pause: pauseView(st),
    notice: st.notice && st.notice.until > now ? st.notice.text : null,
    contentVersion: st.contentVersion,
    muted: st.muted,
    highWash: st.highWash,
    reducedMotion: extras.reducedMotion || deps.config.motion.reduced,
    holdMs: deps.config.timings.holdMs,
    variants: variantsOf(game),
  }
}

export function buildDisplayView(st: HubState, deps: HubDeps, now: number, extras: ViewExtras): DisplayView {
  const game = deps.games[st.gameId] as GameModule
  const options = lobbyOptions(game)
  const inLobby = st.phase === 'LOBBY' || st.phase === 'COUNTDOWN'
  const gameState = st.round?.gameState ?? st.results?.gameState
  return {
    ...common(st, deps, game, now, extras),
    lobby: inLobby
      ? {
          quick: deps.config.lobby.quickStart,
          soloLabel: variantLabel(game, deps.config.lobby.soloVariant),
          options,
          cursors: { P1: st.seats.P1.cursor, P2: st.seats.P2.cursor },
          ready: { P1: st.seats.P1.choice, P2: st.seats.P2.choice },
        }
      : null,
    game:
      (st.phase === 'PLAYING' || st.phase === 'RESULTS') && gameState !== undefined
        ? safeView('display', () => game.displayView(gameState, gameNowOf(st, now)))
        : null,
    results: resultsView(st, game),
    leaderboard: topEntries(deps.leaderboard, game, deps.config.leaderboard.showTop),
    idleDeadline: st.idleDeadline,
    attractCardMs: deps.config.attract.cardMs,
  }
}

export function buildPlayerView(
  st: HubState,
  seat: Seat | null,
  deps: HubDeps,
  now: number,
  extras: ViewExtras,
): PlayerView {
  const game = deps.games[st.gameId] as GameModule
  const base = common(st, deps, game, now, extras)
  const audio = { p1Hz: deps.config.audio.p1Hz, p2Hz: deps.config.audio.p2Hz }
  if (!seat) {
    return {
      ...base,
      seat: null,
      presence: 'absent',
      name: '',
      other: null,
      lobby: null,
      game: null,
      results: null,
      keys: [],
      audio,
    }
  }
  const s = st.seats[seat]
  const other = st.seats[seat === 'P1' ? 'P2' : 'P1']
  const options: LobbyOption[] = lobbyOptions(game)
  const inLobby = st.phase === 'LOBBY' || st.phase === 'COUNTDOWN'
  const participant =
    (st.phase === 'PLAYING' && (st.round?.participants.includes(seat) ?? false)) ||
    (st.phase === 'RESULTS' && (st.results?.participants.includes(seat) ?? false))
  const gameState = st.round?.gameState ?? st.results?.gameState
  const r = st.results
  const naming = r?.naming[seat]
  const t = deps.config.timings
  const longHold =
    (inLobby && s.presence === 'ready') || (st.phase === 'RESULTS' && r?.offer?.to === seat)
  return {
    ...base,
    holdMs: longHold ? t.acceptHoldMs : t.holdMs,
    seat,
    presence: s.presence,
    name: s.name,
    other: seatSummary(other),
    lobby: inLobby
      ? {
          quick: deps.config.lobby.quickStart,
          soloLabel: variantLabel(game, deps.config.lobby.soloVariant),
          options,
          cursor: s.cursor,
          ready: s.choice,
          otherReady: other.choice,
        }
      : null,
    game:
      participant && gameState !== undefined
        ? safeView('player', () => game.playerView(gameState, seat, gameNowOf(st, now)))
        : null,
    results: r
      ? {
          headline: r.outcome.headline ?? '',
          you: r.outcome.seats[seat] ? { ...r.outcome.seats[seat], name: s.name } : null,
          winner: r.outcome.winner,
          naming: naming
            ? {
                letters: naming.letters.map((i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i] ?? 'A'),
                cursor: naming.cursor,
                deadline: naming.deadline,
              }
            : null,
          offer: r.offer ? (r.offer.to === seat ? 'toYou' : 'pending') : null,
          canRestart: r.holdEndsAt != null && !r.offer && now >= r.restartAfter,
          holdEndsAt: r.holdEndsAt,
        }
      : null,
    keys: st.phase === 'PLAYING' && participant ? game.keys : ['Space'],
    audio,
  }
}

export interface ControlDiagnostics {
  sockets: { display: number; play: number; control: number }
  seatMeta: Record<Seat, { deviceId: string | null; rtt: number | null }>
  content: { ok: boolean; error: string | null; loadedAt: number }
  uptimeMs: number
  ips: string[]
  port: number
}

export function buildControlView(
  st: HubState,
  deps: HubDeps,
  now: number,
  extras: ViewExtras,
  diag: ControlDiagnostics,
): ControlView {
  const game = deps.games[st.gameId] as GameModule
  const seatsDetail = {} as ControlView['seatsDetail']
  for (const seat of SEATS) {
    seatsDetail[seat] = { ...seatSummary(st.seats[seat]), ...diag.seatMeta[seat] }
  }
  const gameState = st.round?.gameState
  return {
    ...common(st, deps, game, now, extras),
    games: Object.values(deps.games).map((g) => ({ id: g.id, name: g.name })),
    sockets: diag.sockets,
    seatsDetail,
    results: resultsView(st, game),
    leaderboard: topEntries(deps.leaderboard, game, deps.config.leaderboard.showTop),
    content: diag.content,
    errors: st.errors,
    uptimeMs: diag.uptimeMs,
    ips: diag.ips,
    port: diag.port,
    outcomePreview:
      st.phase === 'PLAYING' && gameState !== undefined ? safeView('outcome', () => game.outcome(gameState)) : null,
  }
}
