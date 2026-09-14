// Small JSON store that survives a yanked power cable: writes go to a unique temp file, are fsynced,
// the previous file is kept as .bak, then the temp file is renamed into place. One write in flight at a
// time; a change during a write schedules exactly one more. Boot falls back main -> .bak -> empty.

import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { renameSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { ZodType } from 'zod'

export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export class JsonStore<T> {
  value: T
  private dirty = false
  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<void> | null = null
  private counter = 0
  /** True when the main file was unreadable at boot: the first write must not clobber the good backup. */
  private protectBackup = false
  private retry: NodeJS.Timeout | null = null

  constructor(
    private readonly file: string,
    private readonly fallback: () => T,
    private readonly schema: ZodType<T>,
    private readonly log: Logger,
    private readonly debounceMs = 300,
  ) {
    this.value = fallback()
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    for (const candidate of [this.file, `${this.file}.bak`]) {
      try {
        const raw = JSON.parse(await readFile(candidate, 'utf8')) as unknown
        const parsed = this.schema.safeParse(raw)
        if (parsed.success) {
          this.value = parsed.data
          if (candidate !== this.file) {
            this.log.warn(`${path.basename(this.file)}: main file unreadable, loaded backup`)
            this.protectBackup = true
          }
          return
        }
        this.log.warn(`${path.basename(candidate)}: invalid contents, ${parsed.error.issues.length} issue(s)`)
      } catch (err) {
        const e = err as NodeJS.ErrnoException
        if (e.code !== 'ENOENT') this.log.warn(`${path.basename(candidate)}: ${e.message}`)
      }
    }
    this.value = this.fallback()
    this.log.info(`${path.basename(this.file)}: starting empty`)
  }

  set(next: T): void {
    this.value = next
    this.dirty = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), this.debounceMs)
  }

  /** Waits until nothing is dirty and nothing is in flight. Safe to call on shutdown. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.retry) {
      clearTimeout(this.retry)
      this.retry = null
    }
    for (let i = 0; i < 20; i++) {
      if (this.inFlight) {
        await this.inFlight
        continue
      }
      if (!this.dirty) return
      this.dirty = false
      this.inFlight = this.writeNow().finally(() => {
        this.inFlight = null
      })
      await this.inFlight
    }
  }

  /** Last resort for uncaughtException handlers: synchronous, no fsync. */
  flushSync(): void {
    if (!this.dirty && !this.inFlight) return
    try {
      mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp-sync`
      writeFileSync(tmp, JSON.stringify(this.value, null, 2))
      renameSync(tmp, this.file)
      this.dirty = false
    } catch (err) {
      this.log.error(`${path.basename(this.file)}: sync flush failed: ${(err as Error).message}`)
    }
  }

  private async writeNow(): Promise<void> {
    const snapshot = JSON.stringify(this.value, null, 2)
    const tmp = `${this.file}.tmp-${process.pid}-${++this.counter}`
    try {
      const fh = await open(tmp, 'w')
      try {
        await fh.writeFile(snapshot, 'utf8')
        await fh.sync()
      } finally {
        await fh.close()
      }
      if (this.protectBackup) {
        // Keep the corrupt main file for forensics and leave the good backup alone this once.
        try {
          await copyFile(this.file, `${this.file}.corrupt`)
        } catch {
          // nothing to keep
        }
        this.protectBackup = false
      } else {
        try {
          await copyFile(this.file, `${this.file}.bak`)
        } catch {
          // no previous file yet
        }
      }
      await rename(tmp, this.file)
    } catch (err) {
      this.dirty = true
      this.log.error(`${path.basename(this.file)}: write failed: ${(err as Error).message}, retrying in 2s`)
      try {
        await unlink(tmp)
      } catch {
        // already gone
      }
      if (!this.retry) {
        this.retry = setTimeout(() => {
          this.retry = null
          void this.flush()
        }, 2000)
      }
    }
  }
}
