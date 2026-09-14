// Pure Morse decoder for one lane. Press lengths and gaps come in already measured (on the player's clock
// or from a recorded ghost run); this module only classifies and commits. No timers: onTick is called with
// the round clock and does the timeout commit when a player stops keying mid-letter.

import { decodeSymbols } from './shared'

export interface DecoderTiming {
  unitMs: number
  dotMaxUnits: number
  letterGapUnits: number
  maxSymbolsPerLetter: number
  stuckPressUnits: number
}

export interface DecoderState {
  /** Symbols keyed so far for the letter in progress, e.g. ".-" */
  symbols: string
  /** Round clock when the current press began, or null when the key is up. */
  pressStart: number | null
  /** Round clock of the last key-up. */
  lastUpAt: number | null
  /** Round clock of the last key-down. */
  lastDownAt: number | null
}

export type DecoderEvent =
  | { type: 'symbol'; symbol: '.' | '-' }
  | { type: 'letter'; letter: string; symbols: string }
  | { type: 'stuck'; durationMs: number }

export function freshDecoder(): DecoderState {
  return { symbols: '', pressStart: null, lastUpAt: null, lastDownAt: null }
}

function commit(state: DecoderState, events: DecoderEvent[]): DecoderState {
  if (!state.symbols) return state
  const letter = decodeSymbols(state.symbols) ?? '?'
  events.push({ type: 'letter', letter, symbols: state.symbols })
  return { ...state, symbols: '' }
}

/**
 * Key down. `gapMs` is the client-measured silence since the previous key-up when available; otherwise the
 * round clock is used. A gap of a letter or more commits whatever was pending before the new press starts.
 */
export function onDown(
  state: DecoderState,
  t: DecoderTiming,
  now: number,
  gapMs: number | undefined,
): { state: DecoderState; events: DecoderEvent[] } {
  const events: DecoderEvent[] = []
  if (state.pressStart != null) return { state, events } // duplicate down, ignore
  let next = state
  const gap = gapMs ?? (state.lastUpAt != null ? now - state.lastUpAt : undefined)
  if (next.symbols && gap != null && gap >= t.letterGapUnits * t.unitMs) next = commit(next, events)
  return { state: { ...next, pressStart: now, lastDownAt: now }, events }
}

/** Key up. `durationMs` is client-measured when available. */
export function onUp(
  state: DecoderState,
  t: DecoderTiming,
  now: number,
  durationMs: number | undefined,
): { state: DecoderState; events: DecoderEvent[] } {
  const events: DecoderEvent[] = []
  if (state.pressStart == null) return { state, events } // up without down, ignore
  const duration = Math.max(0, durationMs ?? now - state.pressStart)
  let next: DecoderState = { ...state, pressStart: null, lastUpAt: now }
  if (duration > t.stuckPressUnits * t.unitMs) {
    events.push({ type: 'stuck', durationMs: duration })
    return { state: next, events }
  }
  const symbol: '.' | '-' = duration < t.dotMaxUnits * t.unitMs ? '.' : '-'
  events.push({ type: 'symbol', symbol })
  next = { ...next, symbols: next.symbols + symbol }
  if (next.symbols.length >= t.maxSymbolsPerLetter) next = commit(next, events)
  return { state: next, events }
}

/**
 * Round clock tick. Commits the pending letter once the player has been silent for a letter gap plus
 * `slackMs` (network allowance: a press that left the laptop just before the deadline must not be split).
 */
export function onTick(
  state: DecoderState,
  t: DecoderTiming,
  now: number,
  slackMs: number,
): { state: DecoderState; events: DecoderEvent[] } {
  const events: DecoderEvent[] = []
  if (!state.symbols || state.pressStart != null || state.lastUpAt == null) return { state, events }
  if (now - state.lastUpAt < t.letterGapUnits * t.unitMs + slackMs) return { state, events }
  return { state: commit(state, events), events }
}

/** Force-close a press (pause, disconnect, stuck key). The half-finished symbol is discarded. */
export function release(state: DecoderState, now: number): DecoderState {
  if (state.pressStart == null) return state
  return { ...state, pressStart: null, lastUpAt: now }
}

/** Correct letters in position, the number the projector shows as progress. */
export function correctPrefix(committed: string, target: string): number {
  let n = 0
  while (n < committed.length && n < target.length && committed[n] === target[n]) n++
  return n
}
