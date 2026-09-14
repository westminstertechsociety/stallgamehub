// Types both the server module and the views need. No logic, no I/O.
import type { Seat } from '@/games/types'

export interface PressSpaceDisplayView {
  target: number
  mode: 'solo' | 'versus'
  participants: Seat[]
  counts: Record<Seat, number>
  finishedMs: Partial<Record<Seat, number>>
  winner: Seat | null
  over: boolean
}

export interface PressSpacePlayerView {
  target: number
  count: number
  remaining: number
  finishedMs: number | null
  over: boolean
  youWon: boolean | null
}
