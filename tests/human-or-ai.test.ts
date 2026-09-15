import { test } from 'node:test'
import assert from 'node:assert/strict'
import { humanOrAi, hoaConfigSchema, drawItems, type HoaState } from '@/games/human-or-ai/server'
import type { DeckItem } from '@/games/human-or-ai/shared'
import type { GameContext, InputEvent, Seat } from '@/games/types'

const deck: DeckItem[] = []
for (let i = 0; i < 30; i++) {
  const source = i % 2 === 0 ? 'human' : 'ai'
  deck.push({
    id: `${source}-${i}`,
    text: `item ${i} ${'word '.repeat(20)}`,
    source,
    tell: 'because',
    durationMs: 8000,
    difficulty: (i % 3) + 1 === 1 ? 1 : i % 3 === 1 ? 2 : 3,
  })
}
const cfg = hoaConfigSchema.parse({ deck: { items: deck }, itemsPerMatch: 9, revealMs: 6000 })

function ctxFor(mode: 'solo' | 'versus', variantId: string, participants: Seat[], data: unknown = {}, seed = 3): GameContext<typeof cfg> {
  return { mode, variantId, participants, names: {}, config: cfg, data, leaderboard: [], seed }
}
const down = (seat: Seat, t: number): InputEvent => ({ seat, key: 'Space', type: 'down', clientTs: t, serverTs: t, gameNow: t })
const up = (seat: Seat, t: number, durationMs: number): InputEvent => ({ seat, key: 'Space', type: 'up', clientTs: t, serverTs: t, gameNow: t, durationMs })

test('a match draws nine items, opens easy, and stays near 50/50 without recent repeats', () => {
  const items = drawItems(deck, cfg, ['human-0', 'ai-1'], () => 0.42)
  assert.equal(items.length, 9)
  assert.ok(items.slice(0, 2).every((i) => i.difficulty === 1), 'two easy openers')
  const humans = items.filter((i) => i.source === 'human').length
  assert.ok(humans === 4 || humans === 5)
  assert.ok(!items.some((i) => i.id === 'human-0' || i.id === 'ai-1'), 'recent items avoided')
  assert.equal(new Set(items.map((i) => i.id)).size, 9)
})

test('versus: correct buzz +1 with a speed bonus for the first, wrong buzz -1 and locked out, silence 0', () => {
  let s: HoaState = humanOrAi.init(ctxFor('versus', 'versus', ['P1', 'P2']))
  const first = s.items[0]!
  // Make the first item AI for the test by choosing a seed where it is, or swap.
  if (first.source !== 'ai') {
    const aiIdx = s.items.findIndex((i) => i.source === 'ai')
    const tmp = s.items[0]!
    s.items[0] = s.items[aiIdx]!
    s.items[aiIdx] = tmp
  }
  s = humanOrAi.onInput(s, 'P1', down('P1', 1200))
  assert.equal(s.seats.P1.score, 2, 'first correct buzz earns +1 and the speed bonus')
  assert.equal(s.seats.P1.buzzedAt, 1200)
  s = humanOrAi.onInput(s, 'P2', down('P2', 2500))
  assert.equal(s.seats.P2.score, 1, 'second correct buzz earns +1 only')
  assert.equal(s.phase, 'reveal', 'both decided: straight to the reveal')
  const dv = humanOrAi.displayView(s, 2500)
  assert.equal(dv.source, 'ai')
  assert.equal(dv.reveal?.P1?.bonus, true)
  s = humanOrAi.onTick(s, 2500 + 6100)
  assert.equal(s.index, 1)
  assert.equal(s.phase, 'item')
  // Second item: force human, P1 buzzes wrongly and is locked out; P2 stays silent.
  if (s.items[1]!.source !== 'human') {
    const hIdx = s.items.findIndex((i, k) => k > 1 && i.source === 'human')
    const tmp = s.items[1]!
    s.items[1] = s.items[hIdx]!
    s.items[hIdx] = tmp
  }
  const t0 = s.itemStartedAt
  s = humanOrAi.onInput(s, 'P1', down('P1', t0 + 500))
  assert.equal(s.seats.P1.score, 1)
  assert.equal(s.seats.P1.lockedOut, true)
  const pv = humanOrAi.playerView(s, 'P1', t0 + 600)
  assert.equal(pv.me.lockedOut, true, 'the buzzer sees the lock-out at once')
  const pv2 = humanOrAi.playerView(s, 'P2', t0 + 600)
  assert.equal(pv2.me.buzzedAt, null)
  const dv2 = humanOrAi.displayView(s, t0 + 600)
  assert.equal(dv2.reveal, null, 'the projector shows nothing about buzzes until the reveal')
  s = humanOrAi.onInput(s, 'P1', down('P1', t0 + 900))
  assert.equal(s.seats.P1.score, 1, 'locked out: further presses ignored')
  s = humanOrAi.onTick(s, t0 + 8100)
  assert.equal(s.phase, 'reveal', 'clock ran out')
  assert.equal(s.seats.P2.score, 1, 'silence on a human item scores nothing')
})

test('solo accuracy: no speed bonus, score out of nine, qualifies when the match completes', () => {
  let s = humanOrAi.init(ctxFor('solo', 'solo', ['P1']))
  let t = 0
  for (let i = 0; i < 9; i++) {
    const item = s.items[i]!
    t = s.itemStartedAt + 1000
    if (item.source === 'ai') {
      // A buzz in solo decides the item at once, so the reveal starts from the buzz.
      s = humanOrAi.onInput(s, 'P1', down('P1', t))
      assert.equal(s.phase, 'reveal')
      assert.equal(s.seats.P1.bonus, false, 'no speed bonus in solo')
    } else {
      s = humanOrAi.onTick(s, s.itemStartedAt + 8100)
      assert.equal(s.phase, 'reveal', 'the clock ran out')
    }
    s = humanOrAi.onTick(s, s.revealUntil! + 10)
  }
  assert.equal(s.phase, 'over')
  const out = humanOrAi.outcome(s)
  const ais = s.items.filter((i) => i.source === 'ai').length
  assert.equal(out.seats.P1?.score, ais, 'one point per correct buzz, none for silence')
  assert.equal(out.seats.P1?.qualifies, true)
  assert.match(out.headline ?? '', /out of 9/)
  const data = out.data as { recent: string[] }
  assert.equal(data.recent.length, 9)
})

test('learn: tap means AI, hold means human, the tell shows at once, tap moves on, nothing is scored', () => {
  let s = humanOrAi.init(ctxFor('solo', 'learn', ['P1']))
  assert.equal(s.itemEndsAt, null, 'untimed')
  const item = s.items[0]!
  const verdictHold = item.source === 'human' ? 800 : 100
  s = humanOrAi.onInput(s, 'P1', down('P1', 100))
  s = humanOrAi.onInput(s, 'P1', up('P1', 100 + verdictHold, verdictHold))
  assert.equal(s.phase, 'reveal')
  assert.equal(s.learn?.right, 1)
  assert.equal(humanOrAi.displayView(s, 1000).tell, 'because')
  s = humanOrAi.onTick(s, 60_000)
  assert.equal(s.phase, 'reveal', 'the reveal waits for a tap in learn')
  s = humanOrAi.onInput(s, 'P1', down('P1', 61_000))
  s = humanOrAi.onInput(s, 'P1', up('P1', 61_080, 80))
  assert.equal(s.index, 1)
  assert.equal(humanOrAi.outcome(s).seats.P1?.qualifies, false)
})

test('an empty deck ends immediately with a clear headline', () => {
  const empty = hoaConfigSchema.parse({ deck: { items: [] } })
  const s = humanOrAi.init({ ...ctxFor('solo', 'solo', ['P1']), config: empty })
  assert.equal(s.phase, 'over')
  assert.match(humanOrAi.outcome(s).headline ?? '', /No deck/)
})

test('idle ticks return the same reference', () => {
  const s = humanOrAi.init(ctxFor('versus', 'versus', ['P1', 'P2']))
  assert.equal(humanOrAi.onTick(s, 10), s)
})
