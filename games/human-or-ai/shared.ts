// Human or AI: shared types. No logic with side effects.
import type { Seat } from '@/games/types'

export type Source = 'human' | 'ai'

export interface DeckItem {
  id: string
  text: string
  source: Source
  /** One authored sentence explaining the tell, read at the reveal. */
  tell: string
  durationMs: number
  difficulty: 1 | 2 | 3
  /** Optional domain label used to balance a match, e.g. "meeting", "apology". */
  domain?: string
}

export interface SeatReveal {
  buzzedAt: number | null
  correct: boolean | null
  lockedOut: boolean
  delta: number
  bonus: boolean
}

export interface HoaDisplayView {
  variantId: string
  mode: 'solo' | 'versus'
  phase: 'item' | 'reveal' | 'over'
  index: number
  total: number
  text: string
  /** Only present at the reveal. */
  source: Source | null
  tell: string | null
  gameNow: number
  itemStartedAt: number
  /** null in Learn (untimed). */
  itemEndsAt: number | null
  revealUntil: number | null
  participants: Seat[]
  scores: Record<Seat, number>
  /** Per-seat facts, only filled at the reveal so nobody learns who buzzed early. */
  reveal: Partial<Record<Seat, SeatReveal>> | null
  learn: { right: number; seen: number } | null
  winner: Seat | null
}

export interface HoaPlayerView {
  variantId: string
  mode: 'solo' | 'versus'
  phase: 'item' | 'reveal' | 'over'
  index: number
  total: number
  gameNow: number
  itemStartedAt: number
  itemEndsAt: number | null
  score: number
  me: { buzzedAt: number | null; correct: boolean | null; lockedOut: boolean }
  reveal: { source: Source; tell: string; delta: number; bonus: boolean } | null
  learn: { right: number; seen: number; holdMs: number } | null
  isParticipant: boolean
}
