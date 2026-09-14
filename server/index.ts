// The host process. One HTTP server shared by Next.js and Socket.IO, bound to the LAN.
// Order matters: create the server with Next's handler first, then attach Socket.IO, then listen.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import os from 'node:os'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import next from 'next'
import { Server } from 'socket.io'
import { z } from 'zod'
import type { LeaderboardEntry } from '@/games/types'
import { games } from '@/games/registry.server'
import { ATTRACT_DIR, DATA_DIR, ROOT, loadContent } from './hub/content'
import { createLogger } from './hub/logger'
import { JsonStore } from './hub/persistence'
import { HubRuntime, sessionSnapshotSchema, type SessionSnapshot } from './hub/runtime'

const dev = process.env.NODE_ENV !== 'production'

const leaderboardSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    score: z.number(),
    scoreText: z.string(),
    gameId: z.string(),
    variantId: z.string(),
    mode: z.enum(['solo', 'versus']),
    at: z.number(),
    detail: z.string().optional(),
  }),
)

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
}

/** Serves public/attract/* straight from disk so new portraits and manifest edits show up without a restart. */
async function serveAttract(req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<boolean> {
  let rel: string
  try {
    rel = decodeURIComponent(urlPath.replace(/^\/attract\/?/, ''))
  } catch {
    return false
  }
  const file = path.resolve(ATTRACT_DIR, rel)
  if (!file.startsWith(ATTRACT_DIR + path.sep) && file !== ATTRACT_DIR) return false
  try {
    const info = await stat(file)
    if (!info.isFile()) return false
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    })
    if (req.method === 'HEAD') {
      res.end()
      return true
    }
    const stream = createReadStream(file)
    // A file that vanishes or turns unreadable mid-stream must end this response, never the process.
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
    stream.pipe(res)
    return true
  } catch {
    return false
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function main() {
  const log = createLogger(path.join(ROOT, 'logs'))
  const content = await loadContent(games)
  for (const err of content.errors) log.warn(`content: ${err}`)
  const cfg = content.hub
  const port = Number(process.env.PORT ?? cfg.port)
  const host = process.env.HOST ?? cfg.host

  const stores = {
    leaderboard: new JsonStore<LeaderboardEntry[]>(path.join(DATA_DIR, 'leaderboard.json'), () => [], leaderboardSchema, log),
    gameData: new JsonStore<Record<string, unknown>>(
      path.join(DATA_DIR, 'game-data.json'),
      () => ({}),
      z.record(z.string(), z.unknown()),
      log,
    ),
    session: new JsonStore<SessionSnapshot>(
      path.join(DATA_DIR, 'session.json'),
      () => ({ gameId: cfg.defaultGame, muted: cfg.audio.muted, highWash: cfg.highWash }),
      sessionSnapshotSchema,
      log,
    ),
  }
  await Promise.all([stores.leaderboard.load(), stores.gameData.load(), stores.session.load()])

  const app = next({ dev, hostname: 'localhost', port, dir: ROOT })
  const handle = app.getRequestHandler()
  await app.prepare()

  let runtime: HubRuntime | null = null

  const httpServer = createServer((req, res) => {
    const url = req.url ?? '/'
    const pathname = url.split('?')[0] ?? '/'
    if (pathname === '/health') {
      json(res, 200, runtime ? runtime.health() : { ok: false, starting: true })
      return
    }
    if (pathname === '/api/info') {
      json(res, 200, { port, ips: lanIps(), games: Object.keys(games) })
      return
    }
    if (pathname === '/api/leaderboard') {
      json(res, 200, stores.leaderboard.value)
      return
    }
    if (pathname === '/api/attract') {
      json(res, 200, runtime ? runtime.manifest() : { cards: [] })
      return
    }
    if (pathname.startsWith('/attract/')) {
      serveAttract(req, res, pathname)
        .then((served) => {
          if (!served) return handle(req, res)
        })
        .catch(() => {
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
      return
    }
    void handle(req, res)
  })

  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    // Next's HMR websocket shares this server in dev; do not let engine.io close upgrades it does not own.
    destroyUpgrade: false,
    pingInterval: 2000,
    pingTimeout: 4000,
    maxHttpBufferSize: 16 * 1024,
    transports: ['websocket', 'polling'],
  })

  runtime = new HubRuntime(io, content, games, stores, log, port)
  runtime.start()

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    log.warn(`${signal}: shutting down`)
    // Never hang on a stuck disk: give the flush five seconds, then go.
    setTimeout(() => process.exit(1), 5000).unref()
    runtime?.stop()
    io.close()
    httpServer.close()
    await Promise.all([stores.leaderboard.flush(), stores.gameData.flush(), stores.session.flush()])
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGHUP', () => void shutdown('SIGHUP'))
  process.on('uncaughtException', (err) => {
    log.error(`uncaughtException: ${err.stack ?? err.message}`)
    stores.leaderboard.flushSync()
    stores.gameData.flushSync()
    stores.session.flushSync()
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    log.error(`unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
  })

  httpServer.listen(port, host, () => {
    const ips = lanIps()
    log.info(`hub ready (${dev ? 'dev' : 'production'}) on http://${host}:${port}`)
    for (const ip of ips) log.info(`  players:  http://${ip}:${port}/play?seat=P1   and   /play?seat=P2`)
    for (const ip of ips) log.info(`  control:  http://${ip}:${port}/control`)
    log.info(`  display:  http://localhost:${port}/display`)
  })
}

function lanIps(): string[] {
  const out: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address)
  }
  return out
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
