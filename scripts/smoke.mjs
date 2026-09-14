// Pre-fair check over real sockets. Start the hub first (pnpm start), then: node scripts/smoke.mjs [http://host:3000]
// Drives a display, two pinned players and a control panel through press-space and a Morse time attack.
import { io } from 'socket.io-client'

const URL = process.argv[2] ?? 'http://localhost:3000'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const auth = (role, seat) => ({
  role,
  seat,
  deviceId: 'smoke_' + role + (seat ?? ''),
  tabId: 'smoke_' + Math.random().toString(36).slice(2, 10),
})
const connect = (role, seat) =>
  new Promise((resolve, reject) => {
    const s = io(URL, { auth: auth(role, seat), transports: ['websocket', 'polling'] })
    s.latest = null
    s.on(role === 'display' ? 'display:view' : role === 'play' ? 'player:view' : 'control:view', (v) => {
      s.latest = v
    })
    s.on('connect', () => resolve(s))
    s.on('connect_error', reject)
  })
let failures = 0
const check = (cond, msg) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg)
  if (!cond) failures++
}
const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..' }
const lastUp = new Map()
const press = async (s, ms) => {
  const t0 = performance.now()
  const prev = lastUp.get(s.id)
  s.emit('input', { key: 'Space', type: 'down', clientTs: t0, gapMs: prev != null ? t0 - prev : undefined })
  await sleep(ms)
  const t1 = performance.now()
  s.emit('input', { key: 'Space', type: 'up', clientTs: t1, durationMs: t1 - t0 })
  lastUp.set(s.id, t1)
}
const tap = (s) => press(s, 60)
const hold = (s, ms = 700) => press(s, ms)
const keyLetter = async (s, ch) => {
  for (const sym of MORSE[ch]) {
    await press(s, sym === '.' ? 90 : 320)
    await sleep(120)
  }
  await sleep(800)
}
const until = async (fn, ms = 15000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (fn()) return true
    await sleep(50)
  }
  return false
}
const pickOption = async (p, id) => {
  for (let i = 0; i < 6 && p.latest?.lobby?.options[p.latest.lobby.cursor]?.id !== id; i++) {
    await hold(p)
    await sleep(250)
  }
  check(p.latest?.lobby?.options[p.latest.lobby.cursor]?.id === id, `cursor on ${id}`)
  await tap(p)
  await sleep(250)
}

console.log(`smoke against ${URL}`)
let health = null
try {
  health = await (await fetch(URL + '/health', { signal: AbortSignal.timeout(4000) })).json()
} catch {
  console.log(`  FAIL cannot reach ${URL}. Is the hub running, and is this the host's LAN address?`)
  process.exit(1)
}
check(health?.ok, 'GET /health')
const force = process.argv.includes('--force')
if ((health?.seats?.P1 || health?.seats?.P2) && !force) {
  console.log('  FAIL a player laptop is already connected. The smoke takes both seats and plays fake rounds;')
  console.log('       run it before opening the kiosks, or pass --force to kick them for a minute.')
  process.exit(1)
}
const before = await (await fetch(URL + '/api/leaderboard')).json().catch(() => [])
const control = await connect('control')
const display = await connect('display')
const p1 = await connect('play', 'P1')
const p2 = await connect('play', 'P2')
await sleep(400)
check(display.latest && p1.latest?.seat === 'P1' && p2.latest?.seat === 'P2', 'display, P1, P2 and control connected')

console.log('press-space')
control.emit('control:cmd', { cmd: 'forceAttract' })
control.emit('control:cmd', { cmd: 'selectGame', gameId: 'press-space' })
await sleep(300)
await tap(p1)
await sleep(250)
check(display.latest?.phase === 'LOBBY', 'space wakes the hub')
const quick = Boolean(display.latest?.lobby?.quick)
if (quick) {
  await tap(p1)
  await sleep(250)
} else {
  await pickOption(p1, 'solo')
}
check(display.latest?.countdown?.mode === 'solo' && display.latest.countdown.joinable, 'one confirmed seat: solo countdown that a second player can join')
await tap(p2)
await sleep(250)
check(display.latest?.countdown?.mode === 'versus', 'second seat confirms: head-to-head')
check(await until(() => display.latest?.phase === 'PLAYING', 6000), 'round starts')
for (let i = 0; i < 10; i++) await press(p2, 30)
check(await until(() => display.latest?.phase === 'RESULTS', 3000) && display.latest.results.winner === 'P2', 'P2 wins press-space')
for (let i = 0; i < 3; i++) {
  await hold(p2)
  await sleep(150)
}
check(await until(() => display.latest?.results?.entries?.length === 1, 3000), 'name entered, leaderboard written')

console.log('morse')
control.emit('control:cmd', { cmd: 'forceAttract' })
control.emit('control:cmd', { cmd: 'selectGame', gameId: 'morse' })
await sleep(300)
await tap(p1)
await sleep(250)
// Head-to-head with P2 confirmed but idle: P1 keys every word and qualifies as the winner.
if (quick) {
  await tap(p1)
  await sleep(200)
  await tap(p2)
} else {
  await pickOption(p1, 'versus')
  await pickOption(p2, 'versus')
}
await sleep(250)
check(display.latest?.countdown?.mode === 'versus', 'morse head-to-head countdown')
check(await until(() => display.latest?.phase === 'PLAYING', 6000), 'morse round starts')
for (let w = 0; w < 2; w++) {
  const word = display.latest.game.word
  for (const ch of word) await keyLetter(p1, ch)
  check(await until(() => display.latest?.phase === 'RESULTS' || display.latest?.game?.phase === 'between' || display.latest?.game?.word !== word, 3000), `keyed ${word}`)
  await sleep(2800)
}
check(await until(() => display.latest?.phase === 'RESULTS', 8000), 'best of three decided')
check(display.latest?.results?.winner === 'P1', 'P1 wins the match')
check(p1.latest?.results?.naming != null, 'winner asked for a name')
for (let i = 0; i < 3; i++) {
  await hold(p1)
  await sleep(150)
}
check(await until(() => display.latest?.results?.entries?.length === 1, 3000), `head-to-head on the leaderboard: ${display.latest?.results?.entries?.[0]?.scoreText ?? '?'}`)
const voiceRes = await fetch(URL + '/voice/manifest.json').catch(() => null)
check(voiceRes?.ok, 'narrator manifest served')
const manifest = voiceRes?.ok ? await voiceRes.json() : null
const firstClip = manifest && Object.values(manifest.clips)[0]?.[0]?.file
const clipRes = firstClip ? await fetch(URL + '/voice/' + firstClip, { method: 'HEAD' }).catch(() => null) : null
check(clipRes?.ok && /audio/.test(clipRes.headers.get('content-type') ?? ''), `narrator clip served (${clipRes?.headers.get('content-type')})`)
control.emit('control:cmd', { cmd: 'forceAttract' })
await sleep(300)
if (before.length === 0) {
  // Leave no trace: the fake scores and the fake ghost runs go, since there was nothing real to keep.
  control.emit('control:cmd', { cmd: 'resetScores' })
  control.emit('control:cmd', { cmd: 'resetGhosts' })
  await sleep(500)
  console.log('  ok   test scores and ghosts cleared again')
} else {
  console.log('  note the leaderboard already had entries, so the smoke\'s AAA entries and ghost runs were kept. Clear them from /control if you want.')
}
for (const s of [display, control, p1, p2]) s.disconnect()
console.log(failures ? `${failures} check(s) failed` : 'all checks passed')
process.exit(failures ? 1 : 0)
