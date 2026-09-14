// Cross-platform production start: `pnpm start` works the same on macOS, Windows and Linux.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' }
const tsx = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')
const child = spawn(tsx, ['server/index.ts'], { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' })
child.on('exit', (code) => process.exit(code ?? 0))
