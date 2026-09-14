// Server-side registry: game logic. Adding a game = one folder + one line here + one line in registry.client.ts.
import type { GameModule } from './types'
import { pressSpace } from './press-space/server'

export const games: Record<string, GameModule> = {
  [pressSpace.id]: pressSpace as unknown as GameModule,
}
