// Client-side registry: React views only. Never import a server.ts here.
import type { GameViews } from './types'
import { pressSpaceViews } from './press-space/views'

export const gameViews: Record<string, GameViews> = {
  'press-space': pressSpaceViews as unknown as GameViews,
}
