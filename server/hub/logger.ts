// Console plus a size-capped log file under logs/. The operator can read it on the day without a terminal history.

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import type { Logger } from './persistence'

const MAX_BYTES = 5 * 1024 * 1024

export function createLogger(dir: string): Logger {
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'hub.log')
  let written = 0
  try {
    written = statSync(file).size
  } catch {
    written = 0
  }
  const write = (level: string, msg: string) => {
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${msg}\n`
    if (level === 'error') console.error(line.trimEnd())
    else if (level === 'warn') console.warn(line.trimEnd())
    else console.log(line.trimEnd())
    try {
      if (written > MAX_BYTES) {
        renameSync(file, `${file}.1`)
        written = 0
      }
      appendFileSync(file, line)
      written += line.length
    } catch {
      // never let logging take the hub down
    }
  }
  return {
    info: (msg) => write('info', msg),
    warn: (msg) => write('warn', msg),
    error: (msg) => write('error', msg),
  }
}
