// Morse code race. Both players key the same word on the space bar; the server decodes every press.
// Wrong letters are rejected with immediate feedback, so committed letters are always the correct prefix
// and partial progress is simply how many letters are in. First to the full word wins the word; best of N.
//
// Solo flavours: learn (one letter at a time, untimed, no score), timeattack (same words, against the
// clock, on the leaderboard), ghost (time attack against the recorded best run for each word).

import { z } from 'zod'
import { SEATS, otherSeat, type GameModule, type GameOutcome, type InputEvent, type Seat } from '@/games/types'
import { SERVER_MARKER } from '@/games/server-marker'
import {
  correctPrefix,
  freshDecoder,
  onDown,
  onTick as decoderTick,
  onUp,
  release,
  type DecoderEvent,
  type DecoderState,
  type DecoderTiming,
} from './decode'
import {
  LEARN_ORDER,
  MORSE,
  type LaneView,
  type LearnView,
  type MorseDisplayView,
  type MorsePlayerView,
  type StreamGroup,
} from './shared'

export const morseConfigSchema = z.object({
  unitMs: z.number().min(50).max(2000).default(200),
  dotMaxUnits: z.number().min(0.2).max(5).default(1),
  letterGapUnits: z.number().min(1).max(20).default(3),
  wordGapUnits: z.number().min(1).max(40).default(7),
  maxSymbolsPerLetter: z.number().int().min(5).max(10).default(6),
  stuckPressUnits: z.number().min(3).max(60).default(10),
  bestOf: z.number().int().min(1).max(9).default(3),
  wordTimeLimitMs: z.number().min(5000).default(45_000),
  betweenWordsMs: z.number().min(0).default(2500),
  streamLength: z.number().int().min(3).max(20).default(8),
  words: z.array(z.string().regex(/^[A-Z0-9]{2,8}$/)).min(1),
  learn: z
    .object({
      count: z.number().int().min(1).max(40).default(10),
      letterGapUnits: z.number().min(1).max(20).default(5),
    })
    .default({ count: 10, letterGapUnits: 5 }),
})
export type MorseConfig = z.infer<typeof morseConfigSchema>

export const DEFAULT_MORSE_CONFIG: MorseConfig = morseConfigSchema.parse({
  words: ['SOS', 'HELLO', 'CODE', 'BYTE'],
})

/** Network allowance before the tick commits a letter: a press in flight must not be split. */
const TICK_SLACK_MS = 120

export interface RunEvent {
  type: 'down' | 'up'
  /** ms since the word started (round clock). */
  t: number
  /** client-measured press length (up) */
  d?: number
  /** client-measured gap since previous up (down) */
  g?: number
}

export interface GhostRun {
  word: string
  ms: number
  events: RunEvent[]
  name: string
  at: number
  /** The timing the run was keyed under: replaying it with different thresholds would garble it. */
  timing?: DecoderTiming
  /** Name still to come from that round's name entry (seat + round seed); cleared by onName. */
  pending?: { seat: Seat; seed: number }
}

export interface MorseData {
  ghosts: Record<string, GhostRun>
}

interface Lane {
  slot: Seat
  kind: 'player' | 'ghost'
  seat: Seat | null
  name: string
  decoder: DecoderState
  committed: string
  stream: StreamGroup[]
  wrong: { got: string; expected: string; at: number } | null
  doneMs: number | null
  recording: RunEvent[]
  run: GhostRun | null
  cursor: number
}

interface LearnState {
  queue: string[]
  index: number
  /** Letters keyed right at the first attempt. */
  correct: number
  /** Attempts at the current letter. */
  attempts: number
  last: LearnView['last']
}

interface WordResult {
  word: string
  winner: Seat | 'ghost' | null
  ms: Partial<Record<Seat | 'ghost', number>>
}

export interface MorseState {
  mode: 'solo' | 'versus'
  variantId: string
  participants: Seat[]
  cfg: MorseConfig
  timing: DecoderTiming
  words: string[]
  wordIndex: number
  word: string
  wordStartedAt: number
  phase: 'word' | 'between' | 'over'
  betweenUntil: number
  lanes: Record<Seat, Lane>
  wins: Record<Seat, number>
  ghostWins: number
  results: WordResult[]
  lastWordWinner: Seat | 'ghost' | null
  winner: Seat | 'ghost' | null
  forfeited: Seat | null
  totalMs: Record<Seat, number>
  learn: LearnState | null
  data: MorseData
  newRuns: boolean
  names: Partial<Record<Seat, string>>
  seed: number
}

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
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

function dataOf(raw: unknown): MorseData {
  const d = raw as Partial<MorseData> | undefined
  return { ghosts: d && typeof d === 'object' && d.ghosts ? { ...d.ghosts } : {} }
}

function lane(slot: Seat, kind: Lane['kind'], seat: Seat | null, name: string): Lane {
  return {
    slot,
    kind,
    seat,
    name,
    decoder: freshDecoder(),
    committed: '',
    stream: [],
    wrong: null,
    doneMs: null,
    recording: [],
    run: null,
    cursor: 0,
  }
}

function resetLane(l: Lane) {
  l.decoder = freshDecoder()
  l.committed = ''
  l.stream = []
  l.wrong = null
  l.doneMs = null
  l.recording = []
  l.cursor = 0
}

function playerLane(s: MorseState, seat: Seat): Lane | null {
  for (const slot of SEATS) {
    const l = s.lanes[slot]
    if (l.kind === 'player' && l.seat === seat) return l
  }
  return null
}

function timingFor(cfg: MorseConfig, learn: boolean): DecoderTiming {
  return {
    unitMs: cfg.unitMs,
    dotMaxUnits: cfg.dotMaxUnits,
    letterGapUnits: learn ? cfg.learn.letterGapUnits : cfg.letterGapUnits,
    maxSymbolsPerLetter: cfg.maxSymbolsPerLetter,
    stuckPressUnits: cfg.stuckPressUnits,
  }
}

function startWord(s: MorseState, gameNow: number) {
  s.word = s.learn ? (s.learn.queue[s.learn.index] ?? 'E') : (s.words[s.wordIndex] ?? 'SOS')
  s.wordStartedAt = gameNow
  s.phase = 'word'
  s.lastWordWinner = null
  if (s.learn) s.learn.attempts = 0
  for (const slot of SEATS) {
    const l = s.lanes[slot]
    resetLane(l)
    if (l.kind === 'ghost') {
      const run = s.data.ghosts[s.word]
      l.run = run ?? null
      l.name = run?.name || 'Ghost'
    }
  }
}

function pushStream(s: MorseState, l: Lane, group: StreamGroup) {
  l.stream.push(group)
  if (l.stream.length > s.cfg.streamLength) l.stream.splice(0, l.stream.length - s.cfg.streamLength)
}

function pendingGroup(l: Lane): StreamGroup | null {
  const last = l.stream[l.stream.length - 1]
  return last && last.letter === null ? last : null
}

/** Apply decoder events to a lane: symbols build the pending group, letters are checked against the word. */
function applyEvents(s: MorseState, l: Lane, events: DecoderEvent[], gameNow: number) {
  for (const ev of events) {
    if (ev.type === 'symbol') {
      const g = pendingGroup(l)
      if (g) g.symbols += ev.symbol
      else pushStream(s, l, { symbols: ev.symbol, letter: null, ok: null })
      continue
    }
    if (ev.type === 'stuck') continue
    const g = pendingGroup(l) ?? { symbols: ev.symbols, letter: null, ok: null }
    if (!pendingGroup(l)) pushStream(s, l, g)
    g.letter = ev.letter
    if (s.learn) {
      const expected = s.word
      const ok = ev.letter === expected
      g.ok = ok
      s.learn.attempts += 1
      s.learn.last = { letter: expected, got: ev.letter, ok, at: gameNow }
      if (ok) {
        if (s.learn.attempts === 1) s.learn.correct += 1
        l.committed = expected
        l.doneMs = gameNow - s.wordStartedAt
      } else {
        l.wrong = { got: ev.letter, expected, at: gameNow }
      }
      continue
    }
    const expected = s.word[l.committed.length] ?? ''
    if (ev.letter === expected) {
      g.ok = true
      l.committed += ev.letter
      l.wrong = null
      if (l.committed === s.word) l.doneMs = gameNow - s.wordStartedAt
    } else {
      g.ok = false
      l.wrong = { got: ev.letter, expected, at: gameNow }
    }
  }
}

function finishWord(s: MorseState, gameNow: number, winner: Seat | 'ghost' | null) {
  const result: WordResult = { word: s.word, winner, ms: {} }
  for (const slot of SEATS) {
    const l = s.lanes[slot]
    if (l.kind === 'ghost') {
      if (l.run) result.ms.ghost = l.run.ms
      continue
    }
    if (!l.seat) continue
    const ms = l.doneMs ?? s.cfg.wordTimeLimitMs
    result.ms[l.seat] = ms
    s.totalMs[l.seat] += ms
    if (l.doneMs != null && !s.learn) rememberRun(s, l, gameNow)
  }
  s.results.push(result)
  s.lastWordWinner = winner
  if (winner === 'ghost') s.ghostWins += 1
  else if (winner) s.wins[winner] += 1
  s.phase = 'between'
  s.betweenUntil = gameNow + s.cfg.betweenWordsMs
}

/** Keep the fastest run per word so the ghost lane always has something real to replay. */
function rememberRun(s: MorseState, l: Lane, at: number) {
  if (!l.seat || l.doneMs == null) return
  const best = s.data.ghosts[s.word]
  if (best && best.ms <= l.doneMs) return
  s.data.ghosts[s.word] = {
    word: s.word,
    ms: l.doneMs,
    events: l.recording.slice(0, 2000),
    name: s.names[l.seat] ?? '',
    at: Date.now(),
    timing: { ...s.timing },
    pending: s.names[l.seat] ? undefined : { seat: l.seat, seed: s.seed },
  }
  void at
  s.newRuns = true
}

function majority(s: MorseState): number {
  return Math.floor(s.cfg.bestOf / 2) + 1
}

function advance(s: MorseState, gameNow: number) {
  if (s.learn) {
    s.learn.index += 1
    if (s.learn.index >= s.learn.queue.length) {
      s.phase = 'over'
      return
    }
    startWord(s, gameNow)
    return
  }
  const need = majority(s)
  if (s.mode === 'versus') {
    const [a, b] = SEATS
    if (s.wins[a] >= need) s.winner = a
    else if (s.wins[b] >= need) s.winner = b
  }
  if (s.winner || s.wordIndex + 1 >= s.words.length) {
    s.phase = 'over'
    if (!s.winner) {
      if (s.mode === 'versus') {
        const [a, b] = SEATS
        s.winner = s.wins[a] === s.wins[b] ? null : s.wins[a] > s.wins[b] ? a : b
      } else if (s.variantId === 'ghost') {
        const seat = s.participants[0] as Seat
        s.winner = s.wins[seat] === s.ghostWins ? null : s.wins[seat] > s.ghostWins ? seat : 'ghost'
      } else {
        s.winner = s.participants[0] ?? null
      }
    }
    return
  }
  s.wordIndex += 1
  startWord(s, gameNow)
}

function checkWordEnd(s: MorseState, gameNow: number): boolean {
  if (s.phase !== 'word') return false
  if (s.learn) {
    const l = s.lanes[s.participants[0] as Seat]
    if (l.doneMs != null) {
      finishWord(s, gameNow, l.seat)
      return true
    }
    return false
  }
  // First lane home wins the word.
  let best: { who: Seat | 'ghost'; ms: number } | null = null
  for (const slot of SEATS) {
    const l = s.lanes[slot]
    if (l.doneMs == null) continue
    const who: Seat | 'ghost' = l.kind === 'ghost' ? 'ghost' : (l.seat as Seat)
    if (!best || l.doneMs < best.ms) best = { who, ms: l.doneMs }
  }
  if (best) {
    finishWord(s, gameNow, best.who)
    return true
  }
  if (gameNow - s.wordStartedAt >= s.cfg.wordTimeLimitMs) {
    // Nobody finished. Versus: most letters wins, else nobody.
    let winner: Seat | null = null
    if (s.mode === 'versus') {
      const [a, b] = SEATS
      const pa = correctPrefix(s.lanes[a].committed, s.word)
      const pb = correctPrefix(s.lanes[b].committed, s.word)
      winner = pa === pb ? null : pa > pb ? a : b
    }
    finishWord(s, gameNow, winner)
    return true
  }
  return false
}

function replayGhost(s: MorseState, l: Lane, gameNow: number): boolean {
  if (!l.run || l.doneMs != null) return false
  const elapsed = gameNow - s.wordStartedAt
  const timing = l.run.timing ?? s.timing
  let changed = false
  while (l.cursor < l.run.events.length) {
    const ev = l.run.events[l.cursor] as RunEvent
    if (ev.t > elapsed) break
    l.cursor += 1
    const t = s.wordStartedAt + ev.t
    const r = ev.type === 'down' ? onDown(l.decoder, timing, t, ev.g) : onUp(l.decoder, timing, t, ev.d)
    l.decoder = r.state
    applyEvents(s, l, r.events, t)
    changed = true
  }
  if (l.doneMs == null) {
    const r = decoderTick(l.decoder, timing, gameNow, TICK_SLACK_MS)
    if (r.events.length) {
      l.decoder = r.state
      applyEvents(s, l, r.events, gameNow)
      changed = true
    }
  }
  if (l.doneMs == null && elapsed >= l.run.ms + TICK_SLACK_MS) {
    // The recording ends with the finishing letter; guard against a run whose replay drifted.
    l.committed = s.word
    l.doneMs = l.run.ms
    changed = true
  }
  return changed
}

export const morse: GameModule<MorseState, MorseDisplayView, MorsePlayerView, MorseConfig> = {
  id: 'morse',
  name: 'Morse code race',
  modes: ['solo', 'versus'],
  variants: [
    {
      id: 'learn',
      label: 'Learn',
      mode: 'solo',
      scored: false,
      order: 'asc',
      blurb: 'One letter at a time, no clock, no score.',
    },
    {
      id: 'timeattack',
      label: 'Time attack',
      mode: 'solo',
      scored: true,
      order: 'asc',
      blurb: 'Three words against the clock.',
    },
    {
      id: 'ghost',
      label: 'Ghost race',
      mode: 'solo',
      scored: true,
      order: 'asc',
      blurb: 'Race the fastest run of the day.',
    },
    {
      id: 'versus',
      label: 'Head-to-head',
      mode: 'versus',
      scored: true,
      order: 'asc',
      blurb: 'Same word, first to key it wins. Best of three.',
    },
  ],
  keys: ['Space'],
  configSchema: morseConfigSchema,
  defaultConfig: DEFAULT_MORSE_CONFIG,
  serverMarker: SERVER_MARKER,

  init(ctx) {
    const cfg = ctx.config
    const rand = mulberry32(ctx.seed)
    const data = dataOf(ctx.data)
    const isLearn = ctx.variantId === 'learn'
    const isGhost = ctx.variantId === 'ghost'
    let words: string[]
    if (isGhost) {
      const withGhost = cfg.words.filter((w) => data.ghosts[w])
      const rest = cfg.words.filter((w) => !data.ghosts[w])
      words = [...shuffle(withGhost, rand), ...shuffle(rest, rand)].slice(0, cfg.bestOf)
    } else {
      words = shuffle(cfg.words, rand).slice(0, cfg.bestOf)
    }
    const lanes = {} as Record<Seat, Lane>
    const solo = ctx.participants[0] as Seat
    for (const slot of SEATS) {
      if (ctx.participants.includes(slot)) lanes[slot] = lane(slot, 'player', slot, ctx.names[slot] ?? '')
      else if (isGhost) lanes[slot] = lane(slot, 'ghost', null, 'Ghost')
      else lanes[slot] = lane(slot, 'player', null, '')
    }
    void solo
    const s: MorseState = {
      mode: ctx.mode,
      variantId: ctx.variantId,
      participants: [...ctx.participants],
      cfg,
      timing: timingFor(cfg, isLearn),
      words,
      wordIndex: 0,
      word: '',
      wordStartedAt: 0,
      phase: 'word',
      betweenUntil: 0,
      lanes,
      wins: { P1: 0, P2: 0 },
      ghostWins: 0,
      results: [],
      lastWordWinner: null,
      winner: null,
      forfeited: null,
      totalMs: { P1: 0, P2: 0 },
      learn: isLearn
        ? { queue: LEARN_ORDER.slice(0, cfg.learn.count), index: 0, correct: 0, attempts: 0, last: null }
        : null,
      data,
      newRuns: false,
      names: { ...ctx.names },
      seed: ctx.seed,
    }
    startWord(s, 0)
    return s
  },

  onInput(state, seat, input: InputEvent) {
    if (state.phase !== 'word' || input.key !== 'Space') return state
    const s = { ...state }
    const l = playerLane(s, seat)
    if (!l || l.doneMs != null) return state
    const t = input.gameNow
    if (!input.synthetic) {
      l.recording.push(
        input.type === 'down'
          ? { type: 'down', t: t - s.wordStartedAt, g: input.gapMs }
          : { type: 'up', t: t - s.wordStartedAt, d: input.durationMs },
      )
      if (l.recording.length > 2000) l.recording.length = 2000
    }
    const r =
      input.type === 'down' ? onDown(l.decoder, s.timing, t, input.gapMs) : onUp(l.decoder, s.timing, t, input.durationMs)
    l.decoder = r.state
    applyEvents(s, l, r.events, t)
    checkWordEnd(s, t)
    return s
  },

  onTick(state, gameNow) {
    if (state.phase === 'over') return state
    if (state.phase === 'between') {
      if (gameNow < state.betweenUntil) return state
      const s = { ...state }
      advance(s, gameNow)
      return s
    }
    let changed = false
    const s = { ...state }
    for (const slot of SEATS) {
      const l = s.lanes[slot]
      if (l.kind === 'ghost') {
        if (replayGhost(s, l, gameNow)) changed = true
        continue
      }
      if (!l.seat || l.doneMs != null) continue
      const r = decoderTick(l.decoder, s.timing, gameNow, TICK_SLACK_MS)
      if (r.events.length) {
        l.decoder = r.state
        applyEvents(s, l, r.events, gameNow)
        changed = true
      }
    }
    if (checkWordEnd(s, gameNow)) changed = true
    return changed ? s : state
  },

  onPause(state, gameNow) {
    const s = { ...state }
    for (const slot of SEATS) {
      const l = s.lanes[slot]
      if (l.kind === 'player') l.decoder = release(l.decoder, gameNow)
    }
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
    const seats: GameOutcome['seats'] = {}
    const finished = (seat: Seat, r: WordResult) => (r.ms[seat] ?? Infinity) < state.cfg.wordTimeLimitMs
    // Solo: every word must have been keyed in time for an honest total.
    const finishedAll = (seat: Seat) =>
      state.results.length === state.words.length && state.results.every((r) => finished(seat, r))
    // Versus: the winner is ranked by the time of the words they actually won.
    const wonMs = (seat: Seat) =>
      state.results.filter((r) => r.winner === seat).reduce((sum, r) => sum + (r.ms[seat] ?? 0), 0)
    for (const seat of state.participants) {
      if (state.learn) {
        seats[seat] = {
          score: state.learn.correct,
          scoreText: `${state.learn.correct} of ${state.learn.queue.length} letters`,
          qualifies: false,
        }
        continue
      }
      const total = state.totalMs[seat]
      if (state.mode === 'versus') {
        const isWinner = state.winner === seat
        seats[seat] = {
          score: wonMs(seat),
          scoreText: `${state.wins[seat]}–${state.wins[otherSeat(seat)]} · ${fmtMs(wonMs(seat))}`,
          qualifies: over && isWinner && !state.forfeited && state.wins[seat] > 0,
          detail: state.results.map((r) => r.word).join(' '),
        }
      } else {
        seats[seat] = {
          score: total,
          scoreText: fmtMs(total),
          qualifies: over && !state.forfeited && finishedAll(seat),
          detail: state.results.map((r) => r.word).join(' '),
        }
      }
    }
    let headline: string | undefined
    if (over) {
      const seat = state.participants[0] as Seat
      if (state.learn) headline = `${state.learn.correct} of ${state.learn.queue.length} letters right first time`
      else if (state.mode === 'versus')
        headline = state.forfeited
          ? `${state.winner} wins. ${state.forfeited} left the game.`
          : state.winner && state.winner !== 'ghost'
            ? `${state.winner} wins ${state.wins[state.winner]}–${state.wins[otherSeat(state.winner)]}`
            : 'Draw'
      else if (state.variantId === 'ghost')
        headline =
          state.winner === 'ghost'
            ? `The ghost wins ${state.ghostWins}–${state.wins[seat]}`
            : state.winner === null
              ? 'Draw with the ghost'
              : `You beat the ghost ${state.wins[seat]}–${state.ghostWins}`
      else headline = `${state.words.length} words in ${fmtMs(state.totalMs[seat])}`
    }
    return {
      over,
      winner: state.mode === 'versus' ? (state.winner === 'ghost' ? null : state.winner) : undefined,
      seats,
      headline,
      data: state.newRuns ? state.data : undefined,
    }
  },

  onName(data, info) {
    const d = dataOf(data)
    let changed = false
    for (const run of Object.values(d.ghosts)) {
      if (!run.pending) continue
      if (run.pending.seat === info.seat && run.pending.seed === info.seed) {
        run.name = info.name
        delete run.pending
        changed = true
      }
    }
    return changed ? d : undefined
  },

  displayView(state, gameNow): MorseDisplayView {
    const lanes: LaneView[] = SEATS.map((slot) => {
      const l = state.lanes[slot]
      const open = l.kind === 'player' && !l.seat
      return {
        slot,
        kind: open ? 'open' : l.kind,
        seat: l.seat,
        name: l.kind === 'ghost' ? (l.run ? `${l.name || 'Ghost'} · ${fmtMs(l.run.ms)}` : 'No ghost yet') : l.name,
        committed: l.committed,
        pending: l.decoder.symbols,
        holdingSince: l.decoder.pressStart,
        stream: l.stream,
        doneMs: l.doneMs,
        wrong: l.wrong,
        wins: l.kind === 'ghost' ? state.ghostWins : l.seat ? state.wins[l.seat] : 0,
      }
    })
    return {
      variantId: state.variantId,
      mode: state.mode,
      word: state.word,
      wordIndex: state.wordIndex,
      totalWords: state.learn ? state.learn.queue.length : state.words.length,
      gameNow,
      phase: state.phase,
      betweenUntil: state.betweenUntil,
      lanes,
      lastWordWinner: state.lastWordWinner,
      winner: state.winner,
      learn: state.learn
        ? {
            letter: state.word,
            pattern: MORSE[state.word] ?? '',
            index: state.learn.index,
            count: state.learn.queue.length,
            correct: state.learn.correct,
            last: state.learn.last,
          }
        : null,
      timeLimitAt: state.wordStartedAt + state.cfg.wordTimeLimitMs,
      unitMs: state.cfg.unitMs,
      dotMaxUnits: state.cfg.dotMaxUnits,
    }
  },

  playerView(state, seat, gameNow): MorsePlayerView {
    const l = playerLane(state, seat)
    const ghostLane = SEATS.map((slot) => state.lanes[slot]).find((x) => x.kind === 'ghost')
    return {
      variantId: state.variantId,
      mode: state.mode,
      word: state.word,
      wordIndex: state.wordIndex,
      totalWords: state.learn ? state.learn.queue.length : state.words.length,
      committed: l?.committed ?? '',
      pending: l?.decoder.symbols ?? '',
      hint: state.learn ? state.word : null,
      wrong: l?.wrong ?? null,
      doneMs: l?.doneMs ?? null,
      phase: state.phase,
      wins: state.wins,
      gameNow,
      lastUpAt: l?.decoder.lastUpAt ?? null,
      ghost: ghostLane?.run ? { name: ghostLane.run.name || 'Ghost', ms: ghostLane.run.ms } : null,
      learn: state.learn
        ? {
            letter: state.word,
            pattern: MORSE[state.word] ?? '',
            index: state.learn.index,
            count: state.learn.queue.length,
            correct: state.learn.correct,
            last: state.learn.last,
          }
        : null,
      timing: {
        unitMs: state.cfg.unitMs,
        dotMaxUnits: state.cfg.dotMaxUnits,
        letterGapUnits: state.timing.letterGapUnits,
        wordGapUnits: state.cfg.wordGapUnits,
      },
      totalMs: state.totalMs[seat],
    }
  },
}
