// Loads everything the operator may edit on the day: config/hub.json, config/<gameId>.json and the attract manifest.
// A bad edit never takes the hub down: the previous good value is kept and the error is reported on /control.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { GameModule } from '@/games/types'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const CONFIG_DIR = path.join(ROOT, 'config')
export const DATA_DIR = path.join(ROOT, 'data')
export const PUBLIC_DIR = path.join(ROOT, 'public')
export const ATTRACT_DIR = path.join(PUBLIC_DIR, 'attract')

export const hubConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default('0.0.0.0'),
  defaultGame: z.string(),
  timings: z
    .object({
    soloCountdownMs: z.number().min(1000).default(8000),
    versusCountdownMs: z.number().min(500).default(3000),
    resultsHoldMs: z.number().min(2000).default(12000),
    idleToAttractMs: z.number().min(5000).default(45000),
    namingCapMs: z.number().min(5000).default(60000),
    pauseGraceVersusMs: z.number().min(2000).default(15000),
    pauseGraceSoloMs: z.number().min(2000).default(30000),
    resumeBeatMs: z.number().min(0).default(1000),
    holdMs: z.number().min(150).default(600),
    cycleRepeatMs: z.number().min(200).default(700),
    acceptHoldMs: z.number().min(300).default(1000),
    stuckKeyMs: z.number().min(2000).default(5000),
    resultsMinMs: z.number().min(0).default(3000),
    namingGraceMs: z.number().min(1000).default(10000),
    playingIdleMs: z.number().min(10000).default(90000),
    })
    .prefault({}),
  attract: z.object({ cardMs: z.number().min(3000).default(12000) }).prefault({}),
  motion: z.object({ reduced: z.boolean().default(false) }).prefault({}),
  audio: z
    .object({
      muted: z.boolean().default(false),
      p1Hz: z.number().min(100).max(4000).default(660),
      p2Hz: z.number().min(100).max(4000).default(440),
    })
    .prefault({}),
  highWash: z.boolean().default(false),
  leaderboard: z
    .object({
      keepPerVariant: z.number().int().min(1).default(50),
      showTop: z.number().int().min(1).default(8),
    })
    .prefault({}),
})
export type HubConfig = z.infer<typeof hubConfigSchema>

export const attractCardSchema = z.object({
  name: z.string().min(1),
  // Typing 1843 without quotes is the most likely hand edit; accept it.
  year: z.union([z.string().min(1), z.number()]).transform(String),
  fact: z.string().min(1),
  image: z.string().min(1),
  credit: z.string().optional(),
})
export const attractManifestSchema = z.object({
  cards: z.array(attractCardSchema),
})
export type AttractManifest = z.infer<typeof attractManifestSchema>

export interface ContentSnapshot {
  hub: HubConfig
  games: Record<string, unknown>
  manifest: AttractManifest
  loadedAt: number
  version: number
  errors: string[]
}

async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, 'utf8')
  // Windows editors like to add a byte-order mark; JSON.parse does not like it.
  return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
}

function formatZod(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

export async function loadContent(
  games: Record<string, GameModule>,
  prev?: ContentSnapshot,
): Promise<ContentSnapshot> {
  const errors: string[] = []

  let hub: HubConfig | undefined = prev?.hub
  try {
    const parsed = hubConfigSchema.safeParse(await readJson(path.join(CONFIG_DIR, 'hub.json')))
    if (parsed.success) hub = parsed.data
    else errors.push(`config/hub.json: ${formatZod(parsed.error)}`)
  } catch (err) {
    errors.push(`config/hub.json: ${(err as Error).message}`)
  }
  if (!hub) throw new Error(`config/hub.json is unreadable and there is no previous config. ${errors.join(' | ')}`)

  const gameConfigs: Record<string, unknown> = {}
  for (const game of Object.values(games)) {
    const file = path.join(CONFIG_DIR, `${game.id}.json`)
    try {
      const raw = await readJson(file)
      const parsed = game.configSchema.safeParse(raw)
      if (parsed.success) gameConfigs[game.id] = parsed.data
      else {
        errors.push(`config/${game.id}.json: ${formatZod(parsed.error)}`)
        gameConfigs[game.id] = prev?.games[game.id] ?? game.defaultConfig
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code !== 'ENOENT') errors.push(`config/${game.id}.json: ${e.message}`)
      gameConfigs[game.id] = prev?.games[game.id] ?? game.defaultConfig
    }
  }

  let manifest: AttractManifest = prev?.manifest ?? { cards: [] }
  try {
    const parsed = attractManifestSchema.safeParse(await readJson(path.join(ATTRACT_DIR, 'manifest.json')))
    if (parsed.success) manifest = parsed.data
    else errors.push(`public/attract/manifest.json: ${formatZod(parsed.error)}`)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'ENOENT') errors.push(`public/attract/manifest.json: ${e.message}`)
  }

  return {
    hub,
    games: gameConfigs,
    manifest,
    loadedAt: Date.now(),
    version: (prev?.version ?? 0) + 1,
    errors,
  }
}
