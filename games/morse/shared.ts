// Everything both the Morse server module and its views need. No logic with side effects, no I/O.
import type { Seat } from '@/games/types'

export const MORSE: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
}

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/** Reverse lookup: symbols -> letter, or null when the pattern matches nothing. */
export function decodeSymbols(symbols: string): string | null {
  for (const [letter, code] of Object.entries(MORSE)) if (code === symbols) return letter
  return null
}

/** Learn mode order: the shortest, most common codes first. */
export const LEARN_ORDER = 'ETIANMSURWDKGOHVFLPJBXCYZQ'.split('')

export interface StreamGroup {
  symbols: string
  /** Decoded letter, '?' for an unknown pattern, null while pending. */
  letter: string | null
  /** true = accepted, false = rejected (wrong letter), null while pending. */
  ok: boolean | null
}

export interface LaneView {
  slot: Seat
  kind: 'player' | 'ghost' | 'open'
  seat: Seat | null
  name: string
  committed: string
  pending: string
  /** gameNow when the current press started, or null. */
  holdingSince: number | null
  stream: StreamGroup[]
  /** ms to finish the current word, or null. */
  doneMs: number | null
  wrong: { got: string; expected: string; at: number } | null
  wins: number
}

export interface MorseDisplayView {
  variantId: string
  mode: 'solo' | 'versus'
  word: string
  wordIndex: number
  totalWords: number
  gameNow: number
  phase: 'word' | 'between' | 'over'
  betweenUntil: number
  lanes: LaneView[]
  lastWordWinner: Seat | 'ghost' | null
  winner: Seat | 'ghost' | null
  learn: LearnView | null
  timeLimitAt: number
  unitMs: number
  dotMaxUnits: number
}

export interface LearnView {
  letter: string
  pattern: string
  index: number
  count: number
  correct: number
  /** The last attempt's result, for immediate feedback. */
  last: { letter: string; got: string; ok: boolean; at: number } | null
}

export interface MorsePlayerView {
  variantId: string
  mode: 'solo' | 'versus'
  word: string
  wordIndex: number
  totalWords: number
  committed: string
  pending: string
  /** The next letter to key, only when the hub decides to show a hint (or always in Learn mode). */
  hint: string | null
  wrong: { got: string; expected: string; at: number } | null
  doneMs: number | null
  phase: 'word' | 'between' | 'over'
  wins: Record<Seat, number>
  gameNow: number
  /** gameNow of the last key-up, for the local "letter commits in…" ring. */
  lastUpAt: number | null
  /** gameNow when the current word started: silence is measured from here until the first key-up. */
  wordStartedAt: number
  ghost: { name: string; ms: number } | null
  learn: LearnView | null
  timing: { unitMs: number; dotMaxUnits: number; letterGapUnits: number; wordGapUnits: number }
  totalMs: number
}

export function symbolsToText(symbols: string): string {
  return symbols.replace(/\./g, '·').replace(/-/g, '—')
}
