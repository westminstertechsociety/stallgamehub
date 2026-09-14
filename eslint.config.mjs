import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'

const serverOnlyPatterns = [
  { group: ['**/server', '**/server.ts', '@/server/*', '@/server/**'], message: 'Client code must not import server modules. Use shared.ts / types.ts.' },
  { group: ['node:*', 'fs', 'path', 'http', 'os', 'child_process'], message: 'Node built-ins are server-only.' },
  { group: ['**/registry.server'], message: 'Use registry.client on the client.' },
]

export default defineConfig([
  globalIgnores(['.next/**', 'out/**', 'dist/**', 'next-env.d.ts', 'node_modules/**', 'data/**']),
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Bundle boundary: nothing rendered in the browser may reach into server code.
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/client/**/*.{ts,tsx}', 'games/**/views.tsx', 'games/registry.client.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: serverOnlyPatterns }],
    },
  },
])
