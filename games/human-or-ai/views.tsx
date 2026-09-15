'use client'
import type { GameDisplayProps, GamePlayerProps, GameViews } from '@/games/types'
import { SEATS } from '@/games/types'
import { Player as PlayerCol, Players } from '@/components/display/Players'
import { Centre } from '@/components/play/PlayFrame'
import { HoldRing } from '@/components/play/HoldRing'
import { useFrameClock } from '@/lib/client/useFrameClock'
import type { HoaDisplayView, HoaPlayerView } from './shared'

/** The draining clock. Never a number: a bar that empties, and turns urgent for the last two seconds. */
function Bar({ startedAt, endsAt, now, className = '' }: { startedAt: number; endsAt: number | null; now: number; className?: string }) {
  if (endsAt == null) return null
  const total = Math.max(1, endsAt - startedAt)
  const left = Math.max(0, endsAt - now)
  const frac = Math.min(1, left / total)
  const urgent = left <= 2000
  return (
    <div className={`bar${urgent ? ' bar-urgent' : ''} ${className}`.trim()} role="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <div className="bar-fill" style={{ transform: `scaleX(${frac})` }} />
    </div>
  )
}

function verdictWord(source: 'human' | 'ai'): string {
  return source === 'ai' ? 'AI' : 'Human'
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function Display({ view, names, present, builtAt, serverNow, reducedMotion }: GameDisplayProps<HoaDisplayView>) {
  const running = view.phase === 'item' && view.itemEndsAt != null
  const frame = useFrameClock(running && !reducedMotion)
  void frame
  const gameNow = view.gameNow + (serverNow() - builtAt)
  const revealing = view.phase !== 'item'
  return (
    <div className="hoa-display">
      <blockquote className={`hoa-text${revealing ? ' hoa-text-revealed' : ''}`} key={view.index}>
        {view.text}
      </blockquote>
      {revealing && view.source ? (
        <div className="hoa-reveal rise" key={`reveal-${view.index}`}>
          <div className={`word hoa-verdict hoa-verdict-${view.source}`}>{verdictWord(view.source)}</div>
          <p className="lead hoa-tell">{view.tell}</p>
        </div>
      ) : (
        <Bar startedAt={view.itemStartedAt} endsAt={view.itemEndsAt} now={gameNow} className="hoa-bar" />
      )}
      <div className="small tnum">
        {view.total ? `${view.index + 1} of ${view.total}` : ''}
        {view.learn ? ` · ${view.learn.right} of ${view.learn.seen} spotted` : ''}
      </div>
      <Players>
        {SEATS.map((seat) => {
          const playing = view.participants.includes(seat)
          if (!playing) {
            return (
              <PlayerCol
                key={seat}
                seat={seat}
                icon="user"
                label={present[seat] ? names[seat] : 'Seat open'}
                off
                sub={present[seat] ? 'Press space to join the next round.' : 'Sit here and press space to join.'}
              />
            )
          }
          const r = view.reveal?.[seat]
          let icon: 'user' | 'check' | 'times' | 'bolt' = 'user'
          let sub: string | undefined
          if (r) {
            if (r.buzzedAt == null) {
              icon = r.correct === null && view.source === 'human' ? 'check' : 'user'
              sub = view.source === 'human' ? 'Stayed silent. Right call, no points.' : 'Stayed silent. It was AI.'
              if (view.learn && r.correct != null) sub = r.correct ? 'Said human. Correct.' : 'Said human. It was AI.'
            } else if (r.correct) {
              icon = r.bonus ? 'bolt' : 'check'
              sub = view.learn ? `Said AI. Correct.` : `Buzzed at ${seconds(r.buzzedAt)} · +${r.delta}${r.bonus ? ' with the speed bonus' : ''}`
            } else {
              icon = 'times'
              sub = view.learn ? 'Said AI. It was human.' : `Buzzed at ${seconds(r.buzzedAt)} · locked out, −1`
            }
          }
          const score = view.learn ? undefined : `${view.scores[seat]} point${Math.abs(view.scores[seat]) === 1 ? '' : 's'}`
          return (
            <PlayerCol key={seat} seat={seat} icon={icon} label={names[seat]} sub={sub ?? (view.learn ? undefined : score)}>
              {sub && score && <div className="hoa-score tnum">{score}</div>}
            </PlayerCol>
          )
        })}
      </Players>
    </div>
  )
}

function Player({ view, seat, held, builtAt, serverNow, reducedMotion }: GamePlayerProps<HoaPlayerView>) {
  const holdingSince = held.Space ?? null
  const running = view.phase === 'item' && view.itemEndsAt != null
  const localNow = useFrameClock(!reducedMotion && (running || holdingSince != null))
  const gameNow = view.gameNow + (serverNow() - builtAt)
  void seat
  if (!view.isParticipant) {
    return (
      <Centre>
        <p className="play-lead">You&apos;re in.</p>
        <p className="play-sub">Playing next. Watch the projector.</p>
      </Centre>
    )
  }
  if (view.phase === 'over') {
    return (
      <Centre>
        <p className="play-lead">Done</p>
      </Centre>
    )
  }
  if (view.reveal) {
    const r = view.reveal
    const me = view.me
    const line = view.learn
      ? me.buzzedAt == null
        ? 'No answer.'
        : me.correct
          ? 'Correct.'
          : 'Not this time.'
      : me.buzzedAt == null
        ? r.source === 'human'
          ? 'You stayed silent. Right call, no points.'
          : 'You stayed silent. It was AI.'
        : me.correct
          ? `Correct buzz. +${r.delta}${r.bonus ? ', speed bonus' : ''}.`
          : 'Wrong buzz. −1.'
    return (
      <Centre>
        <p className="play-big">{verdictWord(r.source)}</p>
        <p className="play-lead">{line}</p>
        <p className="play-sub">{r.tell}</p>
        {view.learn && <p className="play-hint">Tap space for the next one.</p>}
      </Centre>
    )
  }
  if (view.learn) {
    return (
      <Centre>
        <p className="play-lead">Read the text on the projector</p>
        <p className="play-sub">Tap space if you think an AI wrote it. Hold space if you think a human did.</p>
        <HoldRing heldSince={holdingSince} localNow={localNow} ms={view.learn.holdMs} />
      </Centre>
    )
  }
  return (
    <Centre>
      <Bar startedAt={view.itemStartedAt} endsAt={view.itemEndsAt} now={gameNow} className="play-bar" />
      {view.me.lockedOut ? (
        <>
          <p className="play-big">Locked out</p>
          <p className="play-sub">Wrong buzz. Wait for the reveal.</p>
        </>
      ) : view.me.buzzedAt != null ? (
        <>
          <p className="play-big">Buzzed</p>
          <p className="play-sub">{seconds(view.me.buzzedAt)}. Hold tight for the reveal.</p>
        </>
      ) : (
        <>
          <p className="play-lead">Space if you think it&apos;s AI</p>
          <p className="play-sub">Say nothing if you think a human wrote it.</p>
        </>
      )}
      <p className="play-hint tnum">
        {view.index + 1} of {view.total} · {view.score} point{Math.abs(view.score) === 1 ? '' : 's'}
      </p>
    </Centre>
  )
}

export const humanOrAiViews: GameViews<HoaDisplayView, HoaPlayerView> = {
  Display,
  Player,
  headline: (view) =>
    view.learn ? 'Human or AI? Tap space for AI, hold for human' : 'Human or AI? Space is the AI buzzer. Silence means human',
}
