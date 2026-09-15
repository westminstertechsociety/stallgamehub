// Human or AI. A short text on the projector; space is the AI buzzer, silence means "a human wrote this".
// One shared clock per item, private buzzes, a reveal with the authored tell. Best of nine.
//
// Variants: learn (untimed, tap = AI, hold = human, immediate tell, no score), solo (accuracy, out of nine),
// versus (speed bonus for the first correct buzzer).

import { z } from 'zod'
import { SEATS, otherSeat, type GameModule, type GameOutcome, type InputEvent, type Seat } from '@/games/types'
import { SERVER_MARKER } from '@/games/server-marker'
import type { DeckItem, HoaDisplayView, HoaPlayerView, SeatReveal } from './shared'

const deckItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  source: z.enum(['human', 'ai']),
  tell: z.string().min(1),
  durationMs: z.number().min(3000).max(60000),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  domain: z.string().optional(),
})

export const hoaConfigSchema = z.object({
  itemsPerMatch: z.number().int().min(1).max(30).default(9),
  revealMs: z.number().min(1000).default(6000),
  speedBonus: z.number().int().min(0).default(1),
  /** The first N items of a match are drawn from difficulty 1. */
  easyOpeners: z.number().int().min(0).default(2),
  /** Items shown in the last N matches are not drawn again while the deck allows it. */
  avoidRecentMatches: z.number().int().min(0).default(3),
  learnHoldMs: z.number().min(200).default(600),
  /** Path of the deck JSON, relative to the project. The content loader inlines it as `deck`. */
  deckFile: z.string().default('decks/human-or-ai.json'),
  deck: z.object({ items: z.array(deckItemSchema) }).default({ items: [] }),
})
export type HoaConfig = z.infer<typeof hoaConfigSchema>

export const DEFAULT_HOA_CONFIG: HoaConfig = hoaConfigSchema.parse({})

interface SeatPlay {
  score: number
  buzzedAt: number | null
  correct: boolean | null
  lockedOut: boolean
  bonus: boolean
  delta: number
}

interface HoaData {
  recent: string[]
}

export interface HoaState {
  mode: 'solo' | 'versus'
  variantId: string
  participants: Seat[]
  cfg: HoaConfig
  items: DeckItem[]
  index: number
  phase: 'item' | 'reveal' | 'over'
  itemStartedAt: number
  itemEndsAt: number | null
  revealUntil: number | null
  seats: Record<Seat, SeatPlay>
  learn: { right: number; seen: number } | null
  firstCorrectClaimed: boolean
  forfeited: Seat | null
  winner: Seat | null
  data: HoaData
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}

function dataOf(raw: unknown): HoaData {
  const d = raw as Partial<HoaData> | undefined
  return { recent: Array.isArray(d?.recent) ? [...d.recent] : [] }
}

/**
 * Draw a match: avoid recently shown items, open with easy ones, and keep sources near 50/50 so
 * buzzing on everything is exactly break-even.
 */
export function drawItems(deck: DeckItem[], cfg: HoaConfig, recent: string[], rand: () => number): DeckItem[] {
  const n = Math.min(cfg.itemsPerMatch, deck.length)
  if (n === 0) return []
  const recentSet = new Set(recent)
  let pool = deck.filter((i) => !recentSet.has(i.id))
  if (pool.length < n) pool = deck
  const humans = shuffle(pool.filter((i) => i.source === 'human'), rand)
  const ais = shuffle(pool.filter((i) => i.source === 'ai'), rand)
  const picked: DeckItem[] = []
  const takeFrom = (list: DeckItem[], pred: (i: DeckItem) => boolean) => {
    const idx = list.findIndex(pred)
    if (idx < 0) return null
    return list.splice(idx, 1)[0] ?? null
  }
  let nextSource: 'human' | 'ai' = rand() < 0.5 ? 'human' : 'ai'
  for (let k = 0; k < n; k++) {
    const easy = k < cfg.easyOpeners
    const primary = nextSource === 'human' ? humans : ais
    const secondary = nextSource === 'human' ? ais : humans
    const item =
      takeFrom(primary, (i) => !easy || i.difficulty === 1) ??
      takeFrom(secondary, (i) => !easy || i.difficulty === 1) ??
      takeFrom(primary, () => true) ??
      takeFrom(secondary, () => true)
    if (!item) break
    picked.push(item)
    nextSource = nextSource === 'human' ? 'ai' : 'human'
  }
  return picked
}

function seatInit(): SeatPlay {
  return { score: 0, buzzedAt: null, correct: null, lockedOut: false, bonus: false, delta: 0 }
}

function startItem(s: HoaState, gameNow: number) {
  const item = s.items[s.index]
  s.phase = 'item'
  s.itemStartedAt = gameNow
  s.itemEndsAt = s.learn || !item ? null : gameNow + item.durationMs
  s.revealUntil = null
  s.firstCorrectClaimed = false
  for (const seat of SEATS) {
    const p = s.seats[seat]
    p.buzzedAt = null
    p.correct = null
    p.lockedOut = false
    p.bonus = false
    p.delta = 0
  }
}

function resolveItem(s: HoaState, gameNow: number) {
  // Silence is a "human" judgement worth nothing either way; buzzing is the only way to score.
  s.phase = 'reveal'
  s.revealUntil = s.learn ? null : gameNow + s.cfg.revealMs
  if (s.learn) {
    const seat = s.participants[0] as Seat
    const p = s.seats[seat]
    s.learn.seen += 1
    if (p.correct) s.learn.right += 1
  }
}

function advance(s: HoaState, gameNow: number) {
  if (s.index + 1 >= s.items.length) {
    s.phase = 'over'
    if (s.mode === 'versus') {
      const [a, b] = SEATS
      s.winner = s.seats[a].score === s.seats[b].score ? null : s.seats[a].score > s.seats[b].score ? a : b
    }
    s.data.recent = [...s.items.map((i) => i.id), ...s.data.recent].slice(0, s.cfg.itemsPerMatch * s.cfg.avoidRecentMatches)
    return
  }
  s.index += 1
  startItem(s, gameNow)
}

/** A player commits to a verdict. In timed modes only "ai" is possible (the buzz); Learn also allows "human". */
function judge(s: HoaState, seat: Seat, verdict: 'human' | 'ai', gameNow: number) {
  const item = s.items[s.index]
  const p = s.seats[seat]
  if (!item || s.phase !== 'item' || p.buzzedAt != null || p.lockedOut) return
  const correct = item.source === verdict
  p.buzzedAt = gameNow - s.itemStartedAt
  p.correct = correct
  if (s.learn) return
  if (verdict !== 'ai') return
  if (correct) {
    let delta = 1
    if (s.mode === 'versus' && !s.firstCorrectClaimed && s.cfg.speedBonus > 0) {
      delta += s.cfg.speedBonus
      p.bonus = true
    }
    s.firstCorrectClaimed = true
    p.delta = delta
    p.score += delta
  } else {
    p.delta = -1
    p.score -= 1
    p.lockedOut = true
  }
}

function allDecided(s: HoaState): boolean {
  return s.participants.every((seat) => s.seats[seat].buzzedAt != null || s.seats[seat].lockedOut)
}

function fmtScore(score: number, total: number): string {
  return `${score} / ${total}`
}

export const humanOrAi: GameModule<HoaState, HoaDisplayView, HoaPlayerView, HoaConfig> = {
  id: 'human-or-ai',
  name: 'Human or AI',
  modes: ['solo', 'versus'],
  variants: [
    {
      id: 'learn',
      label: 'Learn',
      mode: 'solo',
      scored: false,
      order: 'desc',
      blurb: 'One text at a time, no clock. See the tell straight away.',
    },
    {
      id: 'solo',
      label: 'Accuracy',
      mode: 'solo',
      scored: true,
      order: 'desc',
      blurb: 'Nine texts against the clock. Buzz only when you are sure.',
    },
    {
      id: 'versus',
      label: 'Head-to-head',
      mode: 'versus',
      scored: true,
      order: 'desc',
      blurb: 'Nine texts, first correct buzz gets a bonus. Wrong buzzes cost a point.',
    },
  ],
  keys: ['Space'],
  configSchema: hoaConfigSchema,
  defaultConfig: DEFAULT_HOA_CONFIG,
  serverMarker: SERVER_MARKER,

  init(ctx) {
    const cfg = ctx.config
    const rand = mulberry32(ctx.seed)
    const data = dataOf(ctx.data)
    const isLearn = ctx.variantId === 'learn'
    const items = drawItems(cfg.deck.items, cfg, data.recent, rand)
    const s: HoaState = {
      mode: ctx.mode,
      variantId: ctx.variantId,
      participants: [...ctx.participants],
      cfg,
      items,
      index: 0,
      phase: items.length ? 'item' : 'over',
      itemStartedAt: 0,
      itemEndsAt: null,
      revealUntil: null,
      seats: { P1: seatInit(), P2: seatInit() },
      learn: isLearn ? { right: 0, seen: 0 } : null,
      firstCorrectClaimed: false,
      forfeited: null,
      winner: null,
      data,
    }
    if (items.length) startItem(s, 0)
    return s
  },

  onInput(state, seat, input: InputEvent) {
    if (input.key !== 'Space' || state.phase === 'over') return state
    if (!state.participants.includes(seat)) return state
    const s: HoaState = { ...state, seats: { P1: { ...state.seats.P1 }, P2: { ...state.seats.P2 } } }
    if (s.learn) {
      // Learn: the verdict is given on key-up so a hold can mean "human". A tap during the reveal moves on.
      if (input.type !== 'up' || input.synthetic) return state
      if (s.phase === 'reveal') {
        advance(s, input.gameNow)
        return s
      }
      const verdict = (input.durationMs ?? 0) >= s.cfg.learnHoldMs ? 'human' : 'ai'
      judge(s, seat, verdict, input.gameNow)
      resolveItem(s, input.gameNow)
      return s
    }
    if (input.type !== 'down' || s.phase !== 'item') return state
    const before = s.seats[seat]
    if (before.buzzedAt != null || before.lockedOut) return state
    judge(s, seat, 'ai', input.gameNow)
    if (allDecided(s)) resolveItem(s, input.gameNow)
    return s
  },

  onTick(state, gameNow) {
    if (state.phase === 'over' || state.learn) return state
    if (state.phase === 'item') {
      if (state.itemEndsAt == null || gameNow < state.itemEndsAt) return state
      const s: HoaState = { ...state, seats: { P1: { ...state.seats.P1 }, P2: { ...state.seats.P2 } } }
      resolveItem(s, gameNow)
      return s
    }
    if (state.revealUntil == null || gameNow < state.revealUntil) return state
    const s: HoaState = { ...state, seats: { P1: { ...state.seats.P1 }, P2: { ...state.seats.P2 } } }
    advance(s, gameNow)
    return s
  },

  onForfeit(state, seat) {
    const s = { ...state }
    s.phase = 'over'
    s.forfeited = seat
    s.winner = s.mode === 'versus' ? otherSeat(seat) : null
    return s
  },

  outcome(state): GameOutcome {
    const over = state.phase === 'over'
    const total = state.items.length
    const seats: GameOutcome['seats'] = {}
    for (const seat of state.participants) {
      const p = state.seats[seat]
      if (state.learn) {
        seats[seat] = {
          score: state.learn.right,
          scoreText: `${state.learn.right} of ${state.learn.seen} spotted`,
          qualifies: false,
        }
      } else {
        seats[seat] = {
          score: p.score,
          scoreText: fmtScore(p.score, total),
          qualifies: over && !state.forfeited && total > 0 && (state.mode === 'solo' || state.winner === seat),
        }
      }
    }
    let headline: string | undefined
    if (over) {
      const seat = state.participants[0] as Seat
      if (state.learn) headline = `${state.learn.right} of ${state.learn.seen} spotted`
      else if (state.mode === 'versus')
        headline = state.forfeited
          ? `${state.winner} wins. ${state.forfeited} left the game.`
          : state.winner
            ? `${state.winner} wins ${state.seats[state.winner].score} to ${state.seats[otherSeat(state.winner)].score}`
            : `Draw, ${state.seats.P1.score} each`
      else headline = total === 0 ? 'No deck loaded' : `${state.seats[seat].score} out of ${total}`
    }
    return {
      over,
      winner: state.mode === 'versus' ? state.winner : undefined,
      seats,
      headline,
      data: over ? state.data : undefined,
    }
  },

  displayView(state, gameNow): HoaDisplayView {
    const item = state.items[state.index]
    const revealing = state.phase !== 'item'
    const reveal: HoaDisplayView['reveal'] = revealing ? {} : null
    if (reveal) {
      for (const seat of state.participants) {
        const p = state.seats[seat]
        const r: SeatReveal = { buzzedAt: p.buzzedAt, correct: p.correct, lockedOut: p.lockedOut, delta: p.delta, bonus: p.bonus }
        reveal[seat] = r
      }
    }
    return {
      variantId: state.variantId,
      mode: state.mode,
      phase: state.phase,
      index: state.index,
      total: state.items.length,
      text: item?.text ?? 'No deck loaded. Run the deck pipeline.',
      source: revealing ? (item?.source ?? null) : null,
      tell: revealing ? (item?.tell ?? null) : null,
      gameNow,
      itemStartedAt: state.itemStartedAt,
      itemEndsAt: state.itemEndsAt,
      revealUntil: state.revealUntil,
      participants: state.participants,
      scores: { P1: state.seats.P1.score, P2: state.seats.P2.score },
      reveal,
      learn: state.learn,
      winner: state.winner,
    }
  },

  playerView(state, seat, gameNow): HoaPlayerView {
    const item = state.items[state.index]
    const p = state.seats[seat]
    const revealing = state.phase !== 'item'
    return {
      variantId: state.variantId,
      mode: state.mode,
      phase: state.phase,
      index: state.index,
      total: state.items.length,
      gameNow,
      itemStartedAt: state.itemStartedAt,
      itemEndsAt: state.itemEndsAt,
      score: p.score,
      me: { buzzedAt: p.buzzedAt, correct: p.buzzedAt != null || p.lockedOut ? p.correct : null, lockedOut: p.lockedOut },
      reveal: revealing && item ? { source: item.source, tell: item.tell, delta: p.delta, bonus: p.bonus } : null,
      learn: state.learn ? { ...state.learn, holdMs: state.cfg.learnHoldMs } : null,
      isParticipant: state.participants.includes(seat),
    }
  },
}
