import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hubConfigSchema } from '@/server/hub/content'
import {
  initialState,
  reduce,
  roundClock,
  type HubDeps,
  type HubEvent,
  type HubState,
} from '@/server/hub/session'
import { pressSpace } from '@/games/press-space/server'
import type { GameModule, Seat } from '@/games/types'

const config = hubConfigSchema.parse({
  defaultGame: 'press-space',
  timings: {},
  attract: {},
  motion: {},
  audio: {},
  leaderboard: {},
})

function makeDeps(): HubDeps {
  let n = 0
  return {
    games: { 'press-space': pressSpace as unknown as GameModule },
    config,
    gameConfigs: { 'press-space': { target: 3, timeLimitMs: 30_000 } },
    gameData: {},
    leaderboard: [],
    random: () => 0.5,
    newId: () => `id${++n}`,
  }
}

class Sim {
  state: HubState
  now = 1_000_000
  effects: ReturnType<typeof reduce>['effects'] = []
  constructor(public deps = makeDeps()) {
    this.state = initialState(config, 'press-space', this.now)
  }
  send(ev: HubEvent) {
    const r = reduce(this.state, ev, this.now, this.deps)
    this.state = r.state
    this.effects.push(...r.effects)
    return r
  }
  tick(ms = 20) {
    this.now += ms
    return this.send({ type: 'tick' })
  }
  advance(ms: number) {
    const steps = Math.ceil(ms / 20)
    for (let i = 0; i < steps; i++) this.tick(20)
  }
  connect(seat: Seat) {
    return this.send({ type: 'seat.connect', seat })
  }
  disconnect(seat: Seat) {
    return this.send({ type: 'seat.disconnect', seat })
  }
  down(seat: Seat, key = 'Space') {
    return this.send({ type: 'input', input: { seat, key, type: 'down', clientTs: this.now, serverTs: this.now } })
  }
  up(seat: Seat, durationMs: number, key = 'Space') {
    return this.send({
      type: 'input',
      input: { seat, key, type: 'up', clientTs: this.now, serverTs: this.now, durationMs },
    })
  }
  tap(seat: Seat) {
    this.down(seat)
    this.now += 80
    this.up(seat, 80)
  }
  hold(seat: Seat, ms = 700) {
    this.down(seat)
    this.advance(ms)
    this.up(seat, ms)
  }
}

test('space wakes the hub from ATTRACT into LOBBY', () => {
  const sim = new Sim()
  sim.connect('P1')
  assert.equal(sim.state.phase, 'ATTRACT')
  sim.tap('P1')
  assert.equal(sim.state.phase, 'LOBBY')
  assert.equal(sim.state.seats.P1.presence, 'idle')
})

test('a lone player gets a joinable solo countdown, then plays solo', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.tap('P1') // wake
  sim.tap('P1') // pick first option
  assert.equal(sim.state.phase, 'COUNTDOWN')
  assert.equal(sim.state.countdown?.mode, 'solo')
  assert.equal(sim.state.countdown?.joinable, true)
  assert.equal(sim.state.countdown!.endsAt - sim.now, config.timings.soloCountdownMs)
  sim.advance(config.timings.soloCountdownMs + 40)
  assert.equal(sim.state.phase, 'PLAYING')
  assert.deepEqual(sim.state.round?.participants, ['P1'])
})

test('a second seat readying inside the solo window converts to head-to-head', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.connect('P2')
  sim.tap('P1')
  sim.tap('P1')
  sim.advance(3000)
  sim.tap('P2')
  assert.equal(sim.state.countdown?.mode, 'versus')
  assert.deepEqual(sim.state.countdown?.participants.sort(), ['P1', 'P2'])
  assert.equal(sim.state.countdown!.endsAt - sim.now, config.timings.versusCountdownMs)
  sim.advance(config.timings.versusCountdownMs + 40)
  assert.equal(sim.state.phase, 'PLAYING')
  assert.equal(sim.state.round?.mode, 'versus')
})

test('holding space cycles options, tapping picks, holding again cancels', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.tap('P1')
  assert.equal(sim.state.seats.P1.cursor, 0)
  sim.hold('P1')
  assert.equal(sim.state.seats.P1.cursor, 1)
  sim.tap('P1')
  assert.equal(sim.state.seats.P1.presence, 'ready')
  assert.equal(sim.state.seats.P1.choice, 'versus')
  // A short hold (a finger resting on space) does not cancel; a deliberate one-second hold does.
  sim.hold('P1', 700)
  assert.equal(sim.state.seats.P1.presence, 'ready')
  sim.hold('P1', config.timings.acceptHoldMs + 100)
  assert.equal(sim.state.seats.P1.presence, 'idle')
  assert.equal(sim.state.phase, 'LOBBY')
})

test('solo round ends, name entry, leaderboard write, results hold, back to lobby', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.tap('P1')
  sim.tap('P1')
  sim.advance(config.timings.soloCountdownMs + 40)
  for (let i = 0; i < 3; i++) sim.tap('P1')
  assert.equal(sim.state.phase, 'RESULTS')
  assert.equal(sim.state.seats.P1.presence, 'naming')
  assert.equal(sim.state.results?.holdEndsAt, null)
  // name "BAA": tap once on the first slot, confirm three times
  sim.tap('P1')
  sim.hold('P1')
  sim.hold('P1')
  sim.hold('P1')
  assert.equal(sim.state.seats.P1.presence, 'done')
  const add = sim.effects.find((e) => e.type === 'leaderboard.add')
  assert.ok(add && add.type === 'leaderboard.add')
  assert.equal(add.entry.name, 'BAA')
  assert.equal(add.entry.mode, 'solo')
  assert.ok(sim.state.results?.holdEndsAt)
  sim.advance(config.timings.resultsHoldMs + 40)
  assert.equal(sim.state.phase, 'LOBBY')
})

test('versus: the winner qualifies, the loser does not', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.connect('P2')
  sim.tap('P1')
  sim.hold('P1')
  sim.tap('P1') // P1 picks head-to-head
  sim.tap('P2') // P2 picks whatever: converts to versus
  sim.advance(config.timings.versusCountdownMs + 40)
  for (let i = 0; i < 3; i++) sim.tap('P2')
  assert.equal(sim.state.phase, 'RESULTS')
  assert.equal(sim.state.results?.outcome.winner, 'P2')
  assert.equal(sim.state.seats.P2.presence, 'naming')
  assert.equal(sim.state.seats.P1.presence, 'done')
})

test('a participant dropping mid-round pauses the round clock and shows who is reconnecting', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.connect('P2')
  sim.tap('P1')
  sim.tap('P1')
  sim.tap('P2')
  sim.advance(config.timings.versusCountdownMs + 40)
  sim.advance(1000)
  const before = roundClock(sim.state.round!, sim.now)
  sim.disconnect('P2')
  assert.deepEqual(sim.state.pause?.seats, ['P2'])
  sim.advance(5000)
  assert.equal(sim.state.phase, 'PLAYING')
  assert.equal(roundClock(sim.state.round!, sim.now), before)
  sim.connect('P2')
  assert.ok(sim.state.pause?.resumeAt)
  sim.advance(config.timings.resumeBeatMs + 40)
  assert.equal(sim.state.pause, null)
  assert.ok(roundClock(sim.state.round!, sim.now) - before < 200)
})

test('grace expiry forfeits versus to the other seat', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.connect('P2')
  sim.tap('P1')
  sim.tap('P1')
  sim.tap('P2')
  sim.advance(config.timings.versusCountdownMs + 40)
  sim.disconnect('P2')
  sim.advance(config.timings.pauseGraceVersusMs + 40)
  assert.equal(sim.state.phase, 'RESULTS')
  assert.equal(sim.state.results?.outcome.winner, 'P1')
})

test('grace expiry on a solo round abandons it', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.tap('P1')
  sim.tap('P1')
  sim.advance(config.timings.soloCountdownMs + 40)
  sim.disconnect('P1')
  sim.advance(config.timings.pauseGraceSoloMs + 40)
  assert.equal(sim.state.phase, 'ATTRACT')
})

test('hot-join: a seat joining mid solo round watches, then can hold to start head-to-head', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.tap('P1')
  sim.tap('P1')
  sim.advance(config.timings.soloCountdownMs + 40)
  sim.tap('P1')
  sim.connect('P2')
  assert.equal(sim.state.seats.P2.presence, 'watching')
  sim.tap('P2') // must not interrupt
  assert.equal(sim.state.phase, 'PLAYING')
  assert.deepEqual(sim.state.round?.participants, ['P1'])
  sim.tap('P1')
  sim.tap('P1')
  assert.equal(sim.state.phase, 'RESULTS')
  // No offer while P1 is still entering a name, so accepting can never cut the entry short.
  assert.equal(sim.state.results?.offer, null)
  sim.hold('P1')
  sim.hold('P1')
  sim.hold('P1')
  assert.deepEqual(sim.state.results?.offer, { to: 'P2', from: 'P1' })
  // P2 accepts by holding for acceptHoldMs
  sim.down('P2')
  sim.advance(config.timings.acceptHoldMs + 40)
  assert.equal(sim.state.phase, 'COUNTDOWN')
  assert.equal(sim.state.countdown?.mode, 'versus')
  sim.up('P2', config.timings.acceptHoldMs + 40)
  assert.equal(sim.state.phase, 'COUNTDOWN')
})

test('an idle lobby falls back to attract', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.tap('P1')
  assert.equal(sim.state.phase, 'LOBBY')
  sim.advance(config.timings.idleToAttractMs + 40)
  assert.equal(sim.state.phase, 'ATTRACT')
})

test('a stuck key is released and does not keep the lobby alive', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.tap('P1')
  sim.down('P1')
  sim.advance(config.timings.stuckKeyMs + 40)
  assert.equal(sim.state.seats.P1.stuck, true)
  assert.deepEqual(sim.state.seats.P1.held, {})
  sim.advance(config.timings.idleToAttractMs)
  assert.equal(sim.state.phase, 'ATTRACT')
})

test('kicking a versus participant forfeits; kick in lobby resets the seat', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.connect('P2')
  sim.tap('P1')
  sim.tap('P1')
  sim.tap('P2')
  sim.advance(config.timings.versusCountdownMs + 40)
  sim.send({ type: 'control', cmd: { cmd: 'kick', seat: 'P1' } })
  assert.equal(sim.state.phase, 'RESULTS')
  assert.equal(sim.state.results?.outcome.winner, 'P2')
  sim.send({ type: 'control', cmd: { cmd: 'forceAttract' } })
  sim.tap('P1')
  sim.tap('P1')
  sim.send({ type: 'control', cmd: { cmd: 'kick', seat: 'P1' } })
  assert.equal(sim.state.phase, 'LOBBY')
  assert.equal(sim.state.seats.P1.presence, 'idle')
})

test('a game that throws is contained: the hub goes back to the lobby and keeps serving', () => {
  const deps = makeDeps()
  const broken: GameModule = {
    ...(pressSpace as unknown as GameModule),
    id: 'broken',
    onInput: () => {
      throw new Error('boom')
    },
  }
  deps.games.broken = broken
  const sim = new Sim(deps)
  sim.state.gameId = 'broken'
  sim.connect('P1')
  sim.tap('P1')
  sim.tap('P1')
  sim.advance(config.timings.soloCountdownMs + 40)
  assert.equal(sim.state.phase, 'PLAYING')
  sim.tap('P1')
  assert.equal(sim.state.phase, 'LOBBY')
  assert.equal(sim.state.errors, 1)
  sim.tick()
  assert.equal(sim.state.phase, 'LOBBY')
})

test('unchanged ticks do not bump seq', () => {
  const sim = new Sim()
  sim.connect('P1')
  const seq = sim.state.seq
  const r = sim.tick()
  assert.equal(r.changed, false)
  assert.equal(sim.state.seq, seq)
})

test('reconnecting in the last second of the grace window still resumes', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.connect('P2')
  sim.tap('P1')
  sim.tap('P1')
  sim.tap('P2')
  sim.advance(config.timings.versusCountdownMs + 40)
  sim.disconnect('P2')
  sim.advance(config.timings.pauseGraceVersusMs - 300)
  sim.connect('P2')
  sim.advance(config.timings.resumeBeatMs + 100)
  assert.equal(sim.state.phase, 'PLAYING')
  assert.equal(sim.state.pause, null)
})

test('both versus players dropping abandons the round; one coming back alone wins by forfeit', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.connect('P2')
  sim.tap('P1')
  sim.tap('P1')
  sim.tap('P2')
  sim.advance(config.timings.versusCountdownMs + 40)
  sim.disconnect('P2')
  sim.advance(2000)
  sim.disconnect('P1')
  assert.deepEqual(sim.state.pause?.seats.sort(), ['P1', 'P2'])
  sim.advance(config.timings.pauseGraceVersusMs + 40)
  assert.equal(sim.state.phase, 'ATTRACT')

  const sim2 = new Sim()
  sim2.connect('P1')
  sim2.connect('P2')
  sim2.tap('P1')
  sim2.tap('P1')
  sim2.tap('P2')
  sim2.advance(config.timings.versusCountdownMs + 40)
  sim2.disconnect('P2')
  sim2.disconnect('P1')
  sim2.advance(1000)
  sim2.connect('P1')
  assert.equal(sim2.state.pause?.resumeAt, null, 'still waiting for P2')
  sim2.advance(config.timings.pauseGraceVersusMs + 40)
  assert.equal(sim2.state.phase, 'RESULTS')
  assert.equal(sim2.state.results?.outcome.winner, 'P1')
})

test('a naming seat that never comes back is dropped, not written as AAA', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.tap('P1')
  sim.tap('P1')
  sim.advance(config.timings.soloCountdownMs + 40)
  for (let i = 0; i < 3; i++) sim.tap('P1')
  assert.equal(sim.state.seats.P1.presence, 'naming')
  sim.disconnect('P1')
  sim.advance(config.timings.namingGraceMs + 40)
  assert.equal(sim.effects.find((e) => e.type === 'leaderboard.add'), undefined)
  assert.ok(sim.state.results === null || sim.state.results.holdEndsAt != null)
})

test('results cannot be skipped by the next tap of a still-mashing player', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.connect('P2')
  sim.tap('P1')
  sim.tap('P1')
  sim.tap('P2')
  sim.advance(config.timings.versusCountdownMs + 40)
  for (let i = 0; i < 3; i++) sim.tap('P1')
  assert.equal(sim.state.phase, 'RESULTS')
  for (let i = 0; i < 3; i++) sim.hold('P1') // name
  sim.tap('P2')
  assert.equal(sim.state.phase, 'RESULTS')
  sim.advance(config.timings.resultsMinMs)
  sim.tap('P2')
  assert.equal(sim.state.phase, 'LOBBY')
})

test('an operator skip during name entry keeps the score with the letters typed so far', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.tap('P1')
  sim.tap('P1')
  sim.advance(config.timings.soloCountdownMs + 40)
  for (let i = 0; i < 3; i++) sim.tap('P1')
  sim.tap('P1') // B
  sim.hold('P1')
  sim.send({ type: 'control', cmd: { cmd: 'skip' } })
  const add = sim.effects.find((e) => e.type === 'leaderboard.add')
  assert.ok(add && add.type === 'leaderboard.add')
  assert.equal(add.entry.name, 'BAA')
  assert.equal(sim.state.phase, 'LOBBY')
})

test('notices clear themselves', () => {
  const sim = new Sim()
  sim.connect('P1')
  sim.send({ type: 'control', cmd: { cmd: 'resetScores' } })
  assert.ok(sim.state.notice)
  sim.advance(6100)
  assert.equal(sim.state.notice, null)
})
