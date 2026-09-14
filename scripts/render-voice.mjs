// Renders every narration line and every pioneer bio to WAV with Kokoro (runs locally, needs the model
// cached once with internet). Output: public/voice/*.wav plus public/voice/manifest.json with durations.
// Clips whose text and voice are unchanged are skipped, so re-running after an edit is quick.
//   node scripts/render-voice.mjs            render what changed
//   node scripts/render-voice.mjs --all      re-render everything
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'voice')
mkdirSync(outDir, { recursive: true })
const narration = JSON.parse(readFileSync(path.join(root, 'config', 'narration.json'), 'utf8'))
const attract = JSON.parse(readFileSync(path.join(root, 'public', 'attract', 'manifest.json'), 'utf8'))
const voice = narration.voice ?? 'bf_emma'
const all = process.argv.includes('--all')

const jobs = []
for (const [key, lines] of Object.entries(narration.lines)) {
  lines.forEach((text, i) => jobs.push({ key, index: i, text }))
}
for (const card of attract.cards) {
  if (card.speak) jobs.push({ key: `pioneer.${card.id}`, index: 0, text: card.speak })
}

const hash = (t) => createHash('sha1').update(`${voice}\n${t}`).digest('hex').slice(0, 10)
// WAV from Kokoro is ~47 KB per second; with ffmpeg on the machine the clips are shrunk to mono MP3 (~8 KB/s).
const haveFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
function compress(wavPath) {
  if (!haveFfmpeg) return wavPath
  const mp3 = wavPath.replace(/\.wav$/, '.mp3')
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-ac', '1', '-b:a', '64k', mp3], { stdio: 'inherit' })
  if (r.status !== 0) return wavPath
  unlinkSync(wavPath)
  return mp3
}
const manifestPath = path.join(outDir, 'manifest.json')
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { clips: {} }
const clips = {}
let tts = null
let rendered = 0
for (const job of jobs) {
  const base = `${job.key}-${job.index}-${hash(job.text)}`
  const wavFile = `${base}.wav`
  const target = path.join(outDir, wavFile)
  const prev = previous.clips?.[job.key]?.find((c) => c.file === wavFile || c.file === `${base}.mp3`)
  if (!all && prev && existsSync(path.join(outDir, prev.file))) {
    // Already rendered; compress a leftover WAV if ffmpeg has appeared since.
    const finalPath = prev.file.endsWith('.wav') ? compress(path.join(outDir, prev.file)) : path.join(outDir, prev.file)
    ;(clips[job.key] ||= []).push({ ...prev, file: path.basename(finalPath) })
    continue
  }
  if (!tts) {
    const { KokoroTTS } = await import('kokoro-js')
    console.log('loading Kokoro (first run downloads the model)')
    tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' })
  }
  const t0 = Date.now()
  const audio = await tts.generate(job.text, { voice })
  await audio.save(target)
  const seconds = Math.round((audio.audio.length / audio.sampling_rate) * 10) / 10
  const file = path.basename(compress(target))
  ;(clips[job.key] ||= []).push({ file, seconds, text: job.text })
  rendered++
  console.log(`${job.key}[${job.index}] ${seconds}s (${Date.now() - t0} ms)`)
}
// Remove clips no longer referenced.
const keep = new Set(Object.values(clips).flat().map((c) => c.file))
for (const name of readdirSync(outDir)) if (/\.(wav|mp3)$/.test(name) && !keep.has(name)) unlinkSync(path.join(outDir, name))
writeFileSync(manifestPath, JSON.stringify({ voice, renderedAt: new Date().toISOString(), clips }, null, 2) + '\n')
console.log(`voice: ${rendered} rendered, ${Object.values(clips).flat().length} clips total`)
