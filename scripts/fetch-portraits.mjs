// Downloads a portrait for every card in public/attract/manifest.json that names a Wikipedia page (`wiki`),
// at a sensible width, and records the Wikimedia Commons file page as the credit. Needs internet once.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(root, 'public', 'attract', 'manifest.json')
const dir = path.join(root, 'public', 'attract', 'images')
mkdirSync(dir, { recursive: true })
const UA = 'stallgamehub/1.0 (university tech society stall; contact via repo)'
const WIDTH = 1400

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
for (const card of manifest.cards) {
  if (!card.wiki) continue
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(card.wiki)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`summary ${res.status}`)
    const summary = await res.json()
    const original = (summary.originalimage?.source ?? summary.thumbnail?.source ?? '').split('?')[0]
    if (!original) throw new Error('no image on the page')
    // Build a resized thumbnail URL from the original: .../commons/a/ab/File.jpg -> .../commons/thumb/a/ab/File.jpg/1400px-File.jpg
    const m = original.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f])\/([0-9a-f]{2})\/(.+)$/)
    const fileName = m ? decodeURIComponent(m[4]) : path.basename(original)
    const isSvg = /\.svg$/i.test(fileName)
    const candidates = m
      ? [`${m[1]}/thumb/${m[2]}/${m[3]}/${m[4]}/${WIDTH}px-${m[4]}${isSvg ? '.png' : ''}`, original]
      : [original]
    let bytes = null
    let usedUrl = ''
    for (const url of candidates) {
      const r = await fetch(url, { headers: { 'User-Agent': UA } })
      if (r.ok) {
        bytes = Buffer.from(await r.arrayBuffer())
        usedUrl = url
        break
      }
    }
    if (!bytes) throw new Error('download failed')
    const ext = /\.png$/i.test(usedUrl) ? 'png' : 'jpg'
    const file = `${card.id}.${ext}`
    writeFileSync(path.join(dir, file), bytes)
    card.image = `/attract/images/${file}`
    card.credit = `Wikimedia Commons, File:${fileName}`
    console.log(`ok   ${card.name}: ${file} (${Math.round(bytes.length / 1024)} KB)`)
  } catch (err) {
    console.log(`skip ${card.name}: ${err.message}`)
  }
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
