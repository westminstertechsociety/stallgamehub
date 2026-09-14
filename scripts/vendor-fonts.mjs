// Copies the self-hosted font files from the Fontsource package into public/fonts.
// The copies are committed, so this only matters when upgrading the font package.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = path.join(root, 'node_modules', '@fontsource-variable', 'archivo')
const out = path.join(root, 'public', 'fonts')
mkdirSync(out, { recursive: true })

const files = [
  ['files/archivo-latin-wdth-normal.woff2', 'archivo-latin-wdth-normal.woff2'],
  ['LICENSE', 'LICENSE-archivo.txt'],
]

const hash = (p) => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : '')

for (const [src, dst] of files) {
  const from = path.join(pkg, src)
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
