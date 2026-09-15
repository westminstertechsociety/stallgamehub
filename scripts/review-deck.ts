// Prints decks/human-or-ai.json as a checklist for a human to read every item and veto before the fair.
//   pnpm exec tsx scripts/review-deck.ts            markdown to stdout
//   pnpm exec tsx scripts/review-deck.ts > review.md
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface Item {
  id: string
  text: string
  source: 'human' | 'ai'
  tell: string
  durationMs: number
  difficulty: 1 | 2 | 3
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const deck = JSON.parse(readFileSync(path.join(root, 'decks', 'human-or-ai.json'), 'utf8')) as { items: Item[] }
const items = deck.items
const count = (pred: (i: Item) => boolean) => items.filter(pred).length
const words = (t: string) => t.trim().split(/\s+/).length

console.log(`# Human or AI deck review\n`)
console.log(`${items.length} items: ${count((i) => i.source === 'human')} human, ${count((i) => i.source === 'ai')} AI.`)
console.log(
  `Difficulty 1/2/3: ${count((i) => i.difficulty === 1)}/${count((i) => i.difficulty === 2)}/${count((i) => i.difficulty === 3)}. Missing tells: ${count((i) => !i.tell)}.\n`,
)
console.log(`Tick an item to keep it. Delete the ones you veto from decks/human-or-ai.json (or set "cut": true).\n`)
for (const d of [1, 2, 3] as const) {
  console.log(`## Difficulty ${d}\n`)
  for (const it of items.filter((i) => i.difficulty === d)) {
    const flags = [it.tell ? '' : 'NO TELL', words(it.tell) > 20 ? 'TELL TOO LONG' : '', words(it.text) < 15 || words(it.text) > 60 ? 'LENGTH' : '']
      .filter(Boolean)
      .join(', ')
    console.log(`- [ ] **${it.id}** · ${it.source.toUpperCase()} · ${words(it.text)} words · ${(it.durationMs / 1000).toFixed(0)}s${flags ? ` · ⚠ ${flags}` : ''}`)
    console.log(`  > ${it.text.replace(/\n/g, '\n  > ')}`)
    console.log(`  Tell: ${it.tell || '(none yet)'}\n`)
  }
}
