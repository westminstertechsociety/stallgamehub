'use client'
import { useEffect, useRef, useState } from 'react'
import type { GameDisplayProps, GamePlayerProps, GameViews, Seat } from '@/games/types'
import { Lane, Lanes } from '@/components/display/Lane'
import { useFrameClock } from '@/lib/client/useFrameClock'
import { LETTERS, MORSE, type LaneView, type MorseDisplayView, type MorsePlayerView, type StreamGroup } from './shared'

// ---------------------------------------------------------------- glyphs

/** Dots and dashes drawn as shapes, never as punctuation: seat fill with an ink stroke reads at 10 m. */
function Glyphs({ symbols, tone, landLast = false }: { symbols: string; tone: string; landLast?: boolean }) {
  return (
    <span className={`glyphs glyphs-${tone}`} aria-label={symbols.replace(/\./g, 'dot ').replace(/-/g, 'dash ')}>
      {symbols.split('').map((s, i) => (
        <span
          key={i}
          className={`glyph ${s === '.' ? 'glyph-dot' : 'glyph-dash'}${landLast && i === symbols.length - 1 ? ' land' : ''}`}
        />
      ))}
    </span>
  )
}

function Stream({ groups, tone }: { groups: StreamGroup[]; tone: string }) {
  return (
    <div className="stream" aria-hidden="true">
      {groups.map((g, i) => (
        <span
          key={`${i}-${g.symbols}`}
          className={`stream-group${g.ok === true ? ' stream-ok' : g.ok === false ? ' stream-bad' : ' stream-pending'}`}
        >
          <Glyphs symbols={g.symbols} tone={tone} landLast={i === groups.length - 1 && g.letter === null} />
          <span className="stream-letter">{g.letter ?? ''}</span>
        </span>
      ))}
    </div>
  )
}

/** The growing symbol while the key is down: a dot that stretches into a dash after one unit. */
function HoldBar({ heldMs, unitMs, dotMaxUnits, tone }: { heldMs: number; unitMs: number; dotMaxUnits: number; tone: string }) {
  const dash = heldMs >= unitMs * dotMaxUnits
  const width = Math.min(3, 0.35 + (heldMs / unitMs) * 0.9)
  return (
    <span className={`glyphs glyphs-${tone}`}>
      <span className={`glyph glyph-live${dash ? ' glyph-dash' : ' glyph-dot'}`} style={{ width: `${width}em` }} />
    </span>
  )
}

function Slots({ word, committed, tone, showLetters = true }: { word: string; committed: string; tone: string; showLetters?: boolean }) {
  return (
    <div className="slots" aria-label={`${committed.length} of ${word.length} letters`}>
      {word.split('').map((ch, i) => {
        const filled = i < committed.length
        return (
          <span key={i} className={`slot slot-${tone}${filled ? ' slot-filled rise' : ''}`}>
            {filled ? committed[i] : ''}
            <span className="slot-target">{!filled && showLetters ? ch : ''}</span>
          </span>
        )
      })}
    </div>
  )
}

function toneOf(l: LaneView): string {
  return l.kind === 'ghost' ? 'ghost' : l.slot
}

// ---------------------------------------------------------------- projector

function Display({ view, names, present, builtAt, serverNow, reducedMotion }: GameDisplayProps<MorseDisplayView>) {
  const anyHolding = view.lanes.some((l) => l.holdingSince != null)
  const frame = useFrameClock(anyHolding && !reducedMotion)
  void frame
  const gameNow = view.gameNow + (serverNow() - builtAt)
  const solo = view.mode === 'solo'
  const winnerName = (who: Seat | 'ghost' | null) =>
    who === 'ghost' ? 'The ghost' : who ? names[who] : 'Nobody'

  return (
    <div className="morse-display">
      <div className="morse-word">
        {view.learn ? (
          <>
            <div className="hero morse-learn-letter" key={view.learn.letter}>
              {view.learn.letter}
            </div>
            <div className="morse-learn-pattern">
              <Glyphs symbols={view.learn.pattern} tone="ink" />
            </div>
            <div className="small tnum">
              Letter {view.learn.index + 1} of {view.learn.count}
            </div>
          </>
        ) : (
          <>
            <div className="hero morse-target" key={view.word}>
              {view.word}
            </div>
            {view.phase === 'between' && (
              <div className="morse-takes" key={`takes-${view.wordIndex}`}>
                {view.lastWordWinner ? `${winnerName(view.lastWordWinner)} takes it` : 'Time is up'}
              </div>
            )}
            <div className="small tnum">
              Word {view.wordIndex + 1} of {view.totalWords}
            </div>
          </>
        )}
      </div>
      <Lanes solo={solo && !view.lanes.some((l) => l.kind === 'ghost')}>
        {view.lanes.map((l) => {
          if (l.kind === 'open') {
            return (
              <Lane key={l.slot} seat={l.slot} name="" open>
                <p className="lead">
                  {present[l.slot] ? 'Press space to join the next round.' : 'Sit here and press space to join the next round.'}
                </p>
              </Lane>
            )
          }
          const tone = toneOf(l)
          const heldMs = l.holdingSince != null ? Math.max(0, gameNow - l.holdingSince) : null
          const name = l.kind === 'ghost' ? l.name : names[l.seat as Seat]
          return (
            <Lane
              key={l.slot}
              seat={l.slot}
              name={name}
              end={
                view.learn ? null : (
                  <span className="morse-lane-end">
                    {l.doneMs != null ? <span className="tnum">{(l.doneMs / 1000).toFixed(1)}s</span> : null}
                    <span className="morse-wins tnum">{l.wins}</span>
                  </span>
                )
              }
            >
              {view.learn ? (
                <div className="morse-learn-lane">
                  {view.learn.last && (
                    <div className={`morse-feedback ${view.learn.last.ok ? 'morse-feedback-ok' : 'morse-feedback-bad'}`} key={view.learn.last.at}>
                      {view.learn.last.ok ? `${view.learn.last.letter}. Yes.` : `That was ${view.learn.last.got}.`}
                    </div>
                  )}
                </div>
              ) : (
                <Slots word={view.word} committed={l.committed} tone={tone} showLetters={false} />
              )}
              <div className="morse-stream-row">
                <Stream groups={l.stream} tone={tone} />
                {heldMs != null && (
                  <HoldBar heldMs={heldMs} unitMs={view.unitMs} dotMaxUnits={view.dotMaxUnits} tone={tone} />
                )}
              </div>
            </Lane>
          )
        })}
      </Lanes>
    </div>
  )
}

// ---------------------------------------------------------------- player laptop

function CheatSheet({ hint }: { hint: string | null }) {
  return (
    <div className="cheat" aria-label="Morse alphabet">
      {LETTERS.map((ch) => (
        <div key={ch} className={`cheat-cell${hint === ch ? ' cheat-cell-hint' : ''}`}>
          <span className="cheat-letter">{ch}</span>
          <Glyphs symbols={MORSE[ch] ?? ''} tone="ink" />
        </div>
      ))}
    </div>
  )
}

function Player({ view, seat, held, builtAt, serverNow, reducedMotion }: GamePlayerProps<MorsePlayerView>) {
  const holdingSince = held.Space ?? null
  const holding = holdingSince != null
  // The local key-up time drives the "letter commits in…" ring from the player's own clock, no round trip.
  const [lastUpLocal, setLastUpLocal] = useState<number | null>(null)
  const wasHolding = useRef(false)
  useEffect(() => {
    if (wasHolding.current && !holding) setLastUpLocal(performance.now())
    wasHolding.current = holding
  }, [holding])

  const t = view.timing
  const gapMs = t.letterGapUnits * t.unitMs
  // Keep the frame clock running while the key is down and while a pending letter's ring is filling.
  const ringActive = view.pending !== '' && lastUpLocal != null
  const localNow = useFrameClock(!reducedMotion && (holding || ringActive))
  const heldMs = holdingSince != null ? localNow - holdingSince : 0
  const sinceUp = lastUpLocal != null ? localNow - lastUpLocal : Infinity
  const commitProgress = !holding && view.pending ? Math.max(0, Math.min(1, sinceUp / gapMs)) : 0
  const gameNow = view.gameNow + (serverNow() - builtAt)
  const silentSince = Math.max(view.lastUpAt ?? -Infinity, view.wordStartedAt)
  const silentFor = holding ? 0 : gameNow - silentSince
  const hint = view.learn
    ? view.learn.letter
    : silentFor >= t.wordGapUnits * t.unitMs && view.phase === 'word' && view.doneMs == null
      ? (view.word[view.committed.length] ?? null)
      : null
  const tone = seat

  let status: React.ReactNode
  if (view.phase === 'over') {
    status = <p className="play-lead">Done</p>
  } else if (view.phase === 'between') {
    status = <p className="play-lead">{view.doneMs != null ? `${(view.doneMs / 1000).toFixed(1)}s` : 'Next word coming up'}</p>
  } else if (view.doneMs != null) {
    status = <p className="play-lead">{(view.doneMs / 1000).toFixed(1)}s. Waiting for the other lane.</p>
  } else if (view.wrong && gameNow - view.wrong.at < 2500) {
    status = (
      <p className="play-lead morse-wrong" key={view.wrong.at}>
        That was {view.wrong.got}. {view.learn ? 'Try again.' : `Need ${view.wrong.expected}.`}
      </p>
    )
  } else if (view.learn) {
    status = (
      <p className="play-lead">
        Key {view.learn.letter}
      </p>
    )
  } else {
    status = <p className="play-lead">{view.committed.length === 0 ? 'Key the word on the projector' : 'Keep going'}</p>
  }

  return (
    <div className="morse-play">
      <div className="morse-play-main">
        {status}
        {view.learn ? (
          <div className="morse-learn-target">
            <span className="morse-learn-big">{view.learn.letter}</span>
            <Glyphs symbols={view.learn.pattern} tone="ink" />
          </div>
        ) : (
          <Slots word={view.word} committed={view.committed} tone={tone} showLetters={false} />
        )}
        <div className="morse-live">
          <div className="morse-live-symbols">
            {view.pending && <Glyphs symbols={view.pending} tone={tone} landLast />}
            {holding && <HoldBar heldMs={heldMs} unitMs={t.unitMs} dotMaxUnits={t.dotMaxUnits} tone={tone} />}
            {!holding && !view.pending && <span className="morse-live-empty">Hold space</span>}
          </div>
          <div className="morse-live-label">
            {holding ? (heldMs >= t.unitMs * t.dotMaxUnits ? 'dash' : 'dot') : view.pending ? 'letter commits' : ''}
            {!holding && view.pending && (
              <span className="commit-ring" style={{ ['--p' as string]: commitProgress }} aria-hidden="true" />
            )}
          </div>
        </div>
        <p className="play-hint tnum">
          {view.learn ? `Letter ${view.learn.index + 1} of ${view.learn.count}` : `Word ${view.wordIndex + 1} of ${view.totalWords}`}
          {view.ghost ? ` · Ghost ${view.ghost.name} ${(view.ghost.ms / 1000).toFixed(1)}s` : ''}
          {view.mode === 'versus' ? ` · Words won: ${view.wins[seat]}` : ''}
        </p>
      </div>
      <CheatSheet hint={hint} />
    </div>
  )
}

export const morseViews: GameViews<MorseDisplayView, MorsePlayerView> = { Display, Player }
