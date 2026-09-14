// The trivial pipeline test: both players race to press space N times. Proves seats, input, views and results.
import { z } from 'zod'
import { SEATS, type GameModule, type GameOutcome, type InputEvent, type Seat } from '@/games/types'
import { SERVER_MARKER } from '@/games/server-marker'
import type { PressSpaceDisplayView, PressSpacePlayerView } from './shared'

const configSchema = z.object({
  target: z.number().int().min(1).max(100).default(10),
  timeLimitMs: z.number().int().min(1000).default(30_000),
})
type Config = z.infer<typeof configSchema>

interface State {
  mode: 'solo' | 'versus'
  target: number
  timeLimitMs: number
  participants: Seat[]
  counts: Record<Seat, number>
  finishedMs: Partial<Record<Seat, number>>
  winner: Seat | null
  over: boolean
  forfeited: Seat | null
}

function fmt(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`
}

export const pressSpace: GameModule<State, PressSpaceDisplayView, PressSpacePlayerView, Config> = {
  id: 'press-space',
  name: 'Press space',
  modes: ['solo', 'versus'],
  variants: [
    { id: 'solo', label: 'Time trial', mode: 'solo', scored: true, order: 'asc', blurb: 'Press space ten times as fast as you can.' },
    { id: 'versus', label: 'Head-to-head', mode: 'versus', scored: true, order: 'asc', blurb: 'First to ten presses wins.' },
  ],
  keys: ['Space'],
  configSchema,
  defaultConfig: { target: 10, timeLimitMs: 30_000 },
  serverMarker: SERVER_MARKER,

  init(ctx) {
    return {
      mode: ctx.mode,
      target: ctx.config.target,
      timeLimitMs: ctx.config.timeLimitMs,
      participants: ctx.participants,
      counts: { P1: 0, P2: 0 },
      finishedMs: {},
      winner: null,
      over: false,
      forfeited: null,
    }
  },

  onInput(state, seat, input: InputEvent) {
    if (state.over || input.type !== 'down' || input.key !== 'Space') return state
    if (state.finishedMs[seat] != null) return state
    const counts = { ...state.counts, [seat]: state.counts[seat] + 1 }
    const next: State = { ...state, counts }
    if (counts[seat] >= state.target) {
      next.finishedMs = { ...state.finishedMs, [seat]: input.gameNow }
      if (state.mode === 'versus') {
        next.winner = seat
        next.over = true
      } else {
        next.over = true
      }
    }
    return next
  },

  onTick(state, gameNow) {
    if (state.over) return state
    if (gameNow < state.timeLimitMs) return state
    // Time is up: versus goes to whoever pressed more (draw possible), solo just ends unscored.
    if (state.mode === 'versus') {
      const [a, b] = SEATS
      const winner = state.counts[a] === state.counts[b] ? null : state.counts[a] > state.counts[b] ? a : b
      return { ...state, over: true, winner }
    }
    return { ...state, over: true }
  },

  onForfeit(state, seat) {
    const other = state.participants.find((s) => s !== seat) ?? null
    return { ...state, over: true, winner: other, forfeited: seat }
  },

  outcome(state): GameOutcome {
    const seats: GameOutcome['seats'] = {}
    for (const seat of state.participants) {
      const ms = state.finishedMs[seat]
      seats[seat] =
        ms != null
          ? { score: ms, scoreText: fmt(ms), qualifies: state.mode === 'solo' || state.winner === seat }
          : { score: 0, scoreText: `${state.counts[seat]}/${state.target}`, qualifies: false }
    }
    let headline: string | undefined
    if (state.over) {
      if (state.mode === 'versus') {
        headline = state.winner ? `${state.winner} wins` : 'Draw'
      } else {
        const seat = state.participants[0]
        const ms = seat ? state.finishedMs[seat] : undefined
        headline = ms != null ? `${state.target} presses in ${fmt(ms)}` : 'Time up'
      }
    }
    return { over: state.over, winner: state.mode === 'versus' ? state.winner : undefined, seats, headline }
  },

  displayView(state, _gameNow) {
    return {
      target: state.target,
      mode: state.mode,
      participants: state.participants,
      counts: state.counts,
      finishedMs: state.finishedMs,
      winner: state.winner,
      over: state.over,
    }
  },

  playerView(state, seat, _gameNow) {
    const ms = state.finishedMs[seat]
    return {
      target: state.target,
      count: state.counts[seat],
      remaining: Math.max(0, state.target - state.counts[seat]),
      finishedMs: ms ?? null,
      over: state.over,
      youWon: state.mode === 'versus' && state.over ? state.winner === seat : null,
    }
  },
}
