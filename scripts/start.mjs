// Cross-platform production start: `pnpm start` works the same on macOS, Windows and Linux.
// Runs tsx's JS entry with the current node so no .cmd shim or shell is involved, and forwards signals.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' }
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
if (!existsSync(tsxCli)) {
  console.error('tsx is not installed. Run pnpm install (with network) first.')
  process.exit(1)
}
const child = spawn(process.execPath, [tsxCli, path.join('server', 'index.ts')], { cwd: root, env, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
