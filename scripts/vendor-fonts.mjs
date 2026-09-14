// Copies the self-hosted font files from their Fontsource packages into public/fonts.
// The copies are committed, so this only matters when upgrading a font package.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'public', 'fonts')
mkdirSync(out, { recursive: true })
const files = [
  ['@fontsource/jersey-10', 'files/jersey-10-latin-400-normal.woff2', 'jersey-10-latin-400-normal.woff2'],
  ['@fontsource/jersey-10', 'LICENSE', 'LICENSE-jersey-10.txt'],
  ['@fontsource-variable/momo-trust-sans', 'files/momo-trust-sans-latin-wght-normal.woff2', 'momo-trust-sans-latin-wght-normal.woff2'],
  ['@fontsource-variable/momo-trust-sans', 'LICENSE', 'LICENSE-momo-trust-sans.txt'],
]
const hash = (p) => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : '')
for (const [pkg, src, dst] of files) {
  const from = path.join(root, 'node_modules', pkg, src)
  const to = path.join(out, dst)
  if (!existsSync(from)) {
    console.error(`missing ${from}. Run pnpm install with network access first.`)
    process.exit(1)
  }
  if (hash(from) === hash(to)) {
    console.log(`up to date: ${dst}`)
    continue
  }
  copyFileSync(from, to)
  console.log(`copied: ${dst}`)
}
