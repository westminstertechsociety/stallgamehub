// Client-side registry: React views only. Never import a server.ts here.
import type { GameViews } from './types'
import { pressSpaceViews } from './press-space/views'
import { morseViews } from './morse/views'

export const gameViews: Record<string, GameViews> = {
  morse: morseViews as unknown as GameViews,
  'press-space': pressSpaceViews as unknown as GameViews,
}
