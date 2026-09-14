// Post-build tripwire: every game server module exports SERVER_MARKER. If that string
// ever appears in the client bundle, server logic leaked into the browser.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const MARKER = '__STALLHUB_SERVER_ONLY__'
const root = path.resolve('.next/static')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|mjs)$/.test(name)) out.push(p)
  }
  return out
}

let files = []
try {
  files = walk(root)
} catch {
  console.log('check-bundle: no .next/static directory, skipping')
  process.exit(0)
}
const leaks = files.filter((f) => readFileSync(f, 'utf8').includes(MARKER))
if (leaks.length) {
  console.error('check-bundle: server code leaked into the client bundle:\n' + leaks.join('\n'))
  process.exit(1)
}
console.log(`check-bundle: ok (${files.length} client chunks scanned)`)
