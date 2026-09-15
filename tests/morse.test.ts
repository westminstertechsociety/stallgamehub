import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDecoder, onDown, onTick, onUp, correctPrefix, type DecoderTiming } from '@/games/morse/decode'
import { morse, morseConfigSchema, type MorseState } from '@/games/morse/server'
import { MORSE } from '@/games/morse/shared'
import type { GameContext, InputEvent, Seat } from '@/games/types'

const T: DecoderTiming = { unitMs: 200, dotMaxUnits: 1, letterGapUnits: 3, maxSymbolsPerLetter: 6, stuckPressUnits: 10 }

test('press shorter than one unit is a dot, one unit or more is a dash', () => {
  let s = freshDecoder()
  let r = onDown(s, T, 1000, undefined)
  s = r.state
  r = onUp(s, T, 1199, 199)
  assert.deepEqual(r.events, [{ type: 'symbol', symbol: '.' }])
  s = r.state
  r = onDown(s, T, 1300, 101)
  s = r.state
  r = onUp(s, T, 1500, 200)
  assert.deepEqual(r.events, [{ type: 'symbol', symbol: '-' }])
  assert.equal(r.state.symbols, '.-')
})

test('client-measured duration wins over server timing', () => {
  let s = freshDecoder()
  s = onDown(s, T, 1000, undefined).state
  // server saw 350ms between packets, but the laptop measured 150ms: still a dot
  const r = onUp(s, T, 1350, 150)
  assert.deepEqual(r.events, [{ type: 'symbol', symbol: '.' }])
})

test('a gap of three units before the next press commits the letter', () => {
  let s = freshDecoder()
  s = onUp(onDown(s, T, 0, undefined).state, T, 100, 100).state // .
  s = onUp(onDown(s, T, 200, 100).state, T, 300, 100).state // ..
  s = onUp(onDown(s, T, 400, 100).state, T, 500, 100).state // ... = S
  const r = onDown(s, T, 1200, 700)
  assert.deepEqual(r.events, [{ type: 'letter', letter: 'S', symbols: '...' }])
  assert.equal(r.state.symbols, '')
})

test('the tick commits after the gap plus slack, not before', () => {
  let s = freshDecoder()
  s = onUp(onDown(s, T, 0, undefined).state, T, 300, 300).state // -
  assert.equal(onTick(s, T, 300 + 600 + 100, 120).events.length, 0)
  const r = onTick(s, T, 300 + 600 + 120, 120)
  assert.deepEqual(r.events, [{ type: 'letter', letter: 'T', symbols: '-' }])
})

test('unknown patterns commit as ?, and six symbols force a commit', () => {
  let s = freshDecoder()
  for (let i = 0; i < 6; i++) s = onUp(onDown(s, T, i * 200, 100).state, T, i * 200 + 100, 100).state
  assert.equal(s.symbols, '')
  let t = freshDecoder()
  t = onUp(onDown(t, T, 0, undefined).state, T, 100, 100).state
  t = onUp(onDown(t, T, 200, 100).state, T, 500, 300).state
  t = onUp(onDown(t, T, 600, 100).state, T, 700, 100).state
  t = onUp(onDown(t, T, 800, 100).state, T, 1100, 300).state // .-.- is not a letter
  const r = onTick(t, T, 3000, 0)
  assert.deepEqual(r.events, [{ type: 'letter', letter: '?', symbols: '.-.-' }])
})

test('a press longer than the stuck threshold is discarded', () => {
  let s = freshDecoder()
  s = onDown(s, T, 0, undefined).state
  const r = onUp(s, T, 5000, 5000)
  assert.equal(r.events[0]?.type, 'stuck')
  assert.equal(r.state.symbols, '')
})

test('correctPrefix counts letters in position', () => {
  assert.equal(correctPrefix('HEL', 'HELLO'), 3)
  assert.equal(correctPrefix('HAL', 'HELLO'), 1)
  assert.equal(correctPrefix('', 'HELLO'), 0)
})

// ---------------------------------------------------------------- game flow

const cfg = morseConfigSchema.parse({ words: ['SOS', 'HELLO', 'CODE', 'BYTE'], bestOf: 3, betweenWordsMs: 1000 })

function ctxFor(mode: 'solo' | 'versus', variantId: string, participants: Seat[], data: unknown = {}, seed = 7): GameContext<typeof cfg> {
  return { mode, variantId, participants, names: {}, config: cfg, data, leaderboard: [], seed }
}

/** Keys one letter for a seat starting at `t`; returns the time after the letter gap. */
function keyLetter(state: MorseState, seat: Seat, letter: string, t: number): { state: MorseState; t: number } {
  const pattern = MORSE[letter] ?? ''
  let s = state
  let lastUp: number | null = null
  for (const sym of pattern) {
    const dur = sym === '.' ? 90 : 320
    const down: InputEvent = { seat, key: 'Space', type: 'down', clientTs: t, serverTs: t, gameNow: t, gapMs: lastUp != null ? t - lastUp : undefined }
    s = morse.onInput(s, seat, down)
    t += dur
    const up: InputEvent = { seat, key: 'Space', type: 'up', clientTs: t, serverTs: t, gameNow: t, durationMs: dur }
    s = morse.onInput(s, seat, up)
    lastUp = t
    t += 120
  }
  t += 1300 // past the letter gap (learn mode uses a longer one) plus slack
  s = morse.onTick(s, t)
  return { state: s, t }
}

function keyWord(state: MorseState, seat: Seat, word: string, t: number) {
  let s = state
  for (const ch of word) ({ state: s, t } = keyLetter(s, seat, ch, t))
  return { state: s, t }
}

test('versus: first to key the word wins it, best of three ends the match', () => {
  let s = morse.init(ctxFor('versus', 'versus', ['P1', 'P2']))
  assert.equal(s.words.length, 3)
  let t = 100
  for (let i = 0; i < 2; i++) {
    const word = s.word
    ;({ state: s, t } = keyWord(s, 'P1', word, t))
    assert.equal(s.phase, i === 1 ? 'between' : 'between')
    assert.equal(s.lastWordWinner, 'P1')
    t += 1100
    s = morse.onTick(s, t)
  }
  assert.equal(s.phase, 'over')
  assert.equal(s.winner, 'P1')
  const out = morse.outcome(s)
  assert.equal(out.over, true)
  assert.equal(out.winner, 'P1')
  assert.equal(out.seats.P1?.qualifies, true)
  assert.equal(out.seats.P2?.qualifies, false)
  assert.ok(out.data, 'best runs are persisted')
})

test('a wrong letter resets the word: the player starts again from no letters', () => {
  let s = morse.init(ctxFor('solo', 'timeattack', ['P1']))
  const word = s.word
  let r = keyLetter(s, 'P1', word[0] as string, 100)
  assert.equal(r.state.lanes.P1.committed, word[0])
  const wrong = word[1] === 'E' ? 'T' : 'E'
  r = keyLetter(r.state, 'P1', wrong, r.t)
  s = r.state
  assert.equal(s.lanes.P1.committed, '', 'progress is wiped')
  assert.equal(s.lanes.P1.wrong?.got, wrong)
  assert.equal(s.lanes.P1.wrong?.expected, word[1])
  const r2 = keyLetter(s, 'P1', word[0] as string, r.t)
  assert.equal(r2.state.lanes.P1.committed, word[0])
  assert.equal(r2.state.lanes.P1.wrong, null)
})

test('time attack: three words, total time on the leaderboard, ghost runs recorded', () => {
  let s = morse.init(ctxFor('solo', 'timeattack', ['P1']))
  let t = 100
  for (let i = 0; i < 3; i++) {
    ;({ state: s, t } = keyWord(s, 'P1', s.word, t))
    t += 1100
    s = morse.onTick(s, t)
  }
  assert.equal(s.phase, 'over')
  const out = morse.outcome(s)
  assert.equal(out.seats.P1?.qualifies, true)
  assert.ok((out.seats.P1?.score ?? 0) > 0)
  const data = out.data as { ghosts: Record<string, { ms: number; events: unknown[] }> }
  assert.equal(Object.keys(data.ghosts).length, 3)
  for (const run of Object.values(data.ghosts)) assert.ok(run.events.length > 0)
})

test('ghost race replays the recorded run and the ghost can win a word', () => {
  // Record a fast run first.
  let s = morse.init(ctxFor('solo', 'timeattack', ['P1']))
  let t = 100
  for (let i = 0; i < 3; i++) {
    ;({ state: s, t } = keyWord(s, 'P1', s.word, t))
    t += 1100
    s = morse.onTick(s, t)
  }
  const data = morse.outcome(s).data
  // Now race the ghost and do nothing: the ghost should finish each word.
  let g = morse.init(ctxFor('solo', 'ghost', ['P2'], data))
  assert.equal(g.lanes.P1.kind, 'ghost')
  assert.ok(g.lanes.P1.run, 'ghost lane loaded a run for the first word')
  let now = 0
  for (let i = 0; i < 600; i++) {
    now += 100
    g = morse.onTick(g, now)
    if (g.phase === 'over') break
  }
  assert.equal(g.phase, 'over')
  assert.equal(g.winner, 'ghost')
  assert.equal(g.ghostWins, 3, 'every word is played, the ghost takes them all')
  const out = morse.outcome(g)
  assert.match(out.headline ?? '', /ghost wins/i)
})

test('onName attaches the player name to their pending ghost runs', () => {
  let s = morse.init(ctxFor('solo', 'timeattack', ['P1']))
  let t = 100
  for (let i = 0; i < 3; i++) {
    ;({ state: s, t } = keyWord(s, 'P1', s.word, t))
    t += 1100
    s = morse.onTick(s, t)
  }
  const data = morse.outcome(s).data
  // A name from a different round (other seed) must not attach to these runs.
  assert.equal(morse.onName?.(data, { seat: 'P1', name: 'BAD', at: 1, seed: 99 }), undefined)
  const named = morse.onName?.(data, { seat: 'P1', name: 'ZED', at: 1, seed: 7 }) as { ghosts: Record<string, { name: string; pending?: unknown }> }
  for (const run of Object.values(named.ghosts)) {
    assert.equal(run.name, 'ZED')
    assert.equal(run.pending, undefined)
  }
})

test('ghost race plays every word; beating the ghost in all three qualifies for the leaderboard', () => {
  // A slow ghost: recorded with generous gaps.
  let s = morse.init(ctxFor('solo', 'timeattack', ['P1']))
  let t = 100
  for (let i = 0; i < 3; i++) {
    ;({ state: s, t } = keyWord(s, 'P1', s.word, t + 4000))
    t += 1100
    s = morse.onTick(s, t)
  }
  const data = morse.outcome(s).data
  let g = morse.init(ctxFor('solo', 'ghost', ['P2'], data, 11))
  t = 100
  for (let i = 0; i < 3; i++) {
    ;({ state: g, t } = keyWord(g, 'P2', g.word, t))
    assert.equal(g.lastWordWinner, 'P2', `word ${i + 1} won by the player`)
    t += 1100
    g = morse.onTick(g, t)
  }
  assert.equal(g.phase, 'over')
  assert.equal(g.results.length, 3, 'all three words were played')
  assert.equal(g.winner, 'P2')
  const out = morse.outcome(g)
  assert.equal(out.seats.P2?.qualifies, true)
  assert.match(out.headline ?? '', /beat the ghost 3–0/)
})

test('a ghost recorded under other timings replays with its own timings', () => {
  let s = morse.init(ctxFor('solo', 'timeattack', ['P1']))
  let t = 100
  for (let i = 0; i < 3; i++) {
    ;({ state: s, t } = keyWord(s, 'P1', s.word, t))
    t += 1100
    s = morse.onTick(s, t)
  }
  const data = morse.outcome(s).data as { ghosts: Record<string, { timing?: { unitMs: number } }> }
  for (const run of Object.values(data.ghosts)) assert.equal(run.timing?.unitMs, 200)
  // Retune: a 90ms press would now be a dash if the current timing were used.
  const retuned = { ...cfg, unitMs: 80, dotMaxUnits: 1 }
  const ctx = { ...ctxFor('solo', 'ghost', ['P2'], data), config: retuned }
  let g = morse.init(ctx)
  let now = 0
  for (let i = 0; i < 300 && g.phase !== 'over'; i++) {
    now += 100
    g = morse.onTick(g, now)
  }
  assert.equal(g.phase, 'over')
  assert.equal(g.ghostWins, 3, 'the ghost still keys every word correctly')
})

test('learn headline counts letters right at the first attempt', () => {
  let s = morse.init(ctxFor('solo', 'learn', ['P1']))
  let r = keyLetter(s, 'P1', 'T', 100) // wrong (E expected)
  r = keyLetter(r.state, 'P1', 'E', r.t) // right on the second try
  s = morse.onTick(r.state, r.t + 1100)
  assert.equal(s.learn?.correct, 0)
  r = keyLetter(s, 'P1', 'T', r.t + 1200) // T expected now, right first time
  assert.equal(r.state.learn?.correct, 1)
})

test('learn mode: one letter at a time with immediate feedback, never scored', () => {
  const s = morse.init(ctxFor('solo', 'learn', ['P1']))
  assert.equal(s.learn?.queue[0], 'E')
  assert.equal(s.word, 'E')
  let r = keyLetter(s, 'P1', 'T', 100)
  assert.equal(r.state.learn?.last?.ok, false)
  assert.equal(r.state.word, 'E')
  r = keyLetter(r.state, 'P1', 'E', r.t)
  assert.equal(r.state.learn?.last?.ok, true)
  assert.equal(r.state.phase, 'between')
  const s2 = morse.onTick(r.state, r.t + 1100)
  assert.equal(s2.word, 'T')
  assert.equal(morse.outcome(s2).seats.P1?.qualifies, false)
})

test('idle ticks return the same state reference', () => {
  const s = morse.init(ctxFor('versus', 'versus', ['P1', 'P2']))
  assert.equal(morse.onTick(s, 50), s)
})

test('an exact tie with the ghost goes to the player whichever seat they sit in', () => {
  let s = morse.init(ctxFor('solo', 'timeattack', ['P1']))
  let t = 100
  for (let i = 0; i < 3; i++) {
    ;({ state: s, t } = keyWord(s, 'P1', s.word, t))
    t += 1100
    s = morse.onTick(s, t)
  }
  const data = morse.outcome(s).data as { ghosts: Record<string, { events: { type: 'down' | 'up'; t: number; d?: number; g?: number }[] }> }
  for (const seat of ['P1', 'P2'] as const) {
    let g = morse.init(ctxFor('solo', 'ghost', [seat], data))
    const run = data.ghosts[g.word]!
    // Feed the ghost's own recording as the player's input, tick by tick, so both finish on the same tick.
    let now = 0
    let idx = 0
    while (g.phase === 'word' && now < 60000) {
      now += 20
      while (idx < run.events.length && run.events[idx]!.t <= now) {
        const ev = run.events[idx++]!
        const base = { seat, key: 'Space', clientTs: ev.t, serverTs: ev.t, gameNow: ev.t }
        g = morse.onInput(g, seat, ev.type === 'down' ? { ...base, type: 'down', gapMs: ev.g } : { ...base, type: 'up', durationMs: ev.d })
      }
      g = morse.onTick(g, now)
    }
    assert.equal(g.lastWordWinner, seat, `player in ${seat} wins the tie`)
  }
})
