'use client'
// Projector. Read-only. Everything here is sized to be read from ten metres.
import { useEffect } from 'react'
import { useHub } from '@/lib/client/useHub'
import { useServerClock, secondsLeft } from '@/lib/client/useServerClock'
import type { DisplayView } from '@/lib/shared/protocol'
import { EVENTS } from '@/lib/shared/protocol'
import { gameViews } from '@/games/registry.client'
import { seatLabel } from '@/components/shared/SeatChip'
import { requestKioskLocks } from '@/lib/client/keys'
import { Banner, Stage } from '@/components/display/Stage'
import { useNarrator } from '@/lib/client/useNarrator'
import { unlockVoice } from '@/lib/client/voice'
import { LobbyBoard } from '@/components/display/LobbyBoard'
import { ResultsBoard } from '@/components/display/ResultsBoard'
import { AttractLoop } from '@/components/display/AttractLoop'

function Playing({ view, serverNow }: { view: DisplayView; serverNow: () => number }) {
  const views = gameViews[view.gameId]
  const names = { P1: seatLabel('P1', view.seats.P1.name), P2: seatLabel('P2', view.seats.P2.name) }
  const present = { P1: view.seats.P1.connected, P2: view.seats.P2.connected }
  if (!views || view.game == null) return <p className="lead">Loading the game.</p>
  return (
    <views.Display
      view={view.game}
      names={names}
      present={present}
      builtAt={view.serverNow}
      serverNow={serverNow}
      reducedMotion={view.reducedMotion}
    />
  )
}

export default function DisplayPage() {
  const hub = useHub<DisplayView>('display')
  const { view, status, send } = hub
  const now = useServerClock(hub.serverNow)
  const narrator = useNarrator(view)

  // Operator chord: Ctrl+Alt+Shift+R hard-resets the session (not Ctrl+Shift+R, which is browser reload).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyR') {
        e.preventDefault()
        send(EVENTS.control, { cmd: 'hardReset' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [send])

  useEffect(() => {
    document.documentElement.dataset.highWash = String(view?.highWash ?? false)
    document.documentElement.dataset.reducedMotion = String(view?.reducedMotion ?? false)
  }, [view?.highWash, view?.reducedMotion])

  useEffect(() => requestKioskLocks(), [])

  if (!view) {
    return (
      <Stage>
        <div className="centre">
          <p className="lead">Connecting to the hub.</p>
        </div>
      </Stage>
    )
  }


  const modeLabel = view.results?.variantLabel ?? view.countdown?.variantLabel ?? ''
  const learn = view.phase === 'PLAYING' && Boolean((view.game as { learn?: unknown } | null)?.learn)

  let headline: React.ReactNode = null
  let bottom: React.ReactNode = null
  let body: React.ReactNode

  switch (view.phase) {
    case 'ATTRACT':
      body = <AttractLoop view={view} />
      bottom = <span>Press space on either laptop to play</span>
      break
    case 'LOBBY':
    case 'COUNTDOWN':
      headline = view.countdown ? (view.countdown.mode === 'versus' ? 'Head-to-head' : 'Playing solo') : 'Confirm your seat with the space bar'
      body = <LobbyBoard view={view} now={now} />
      bottom = view.notice ? <span>{view.notice}</span> : <span>{view.gameName}</span>
      break
    case 'PLAYING':
      headline = learn
        ? 'Key this letter: short press for a dot, long press for a dash'
        : 'Type the following word in morse code as fast as you can'
      body = <Playing view={view} serverNow={hub.serverNow} />
      bottom = <span>{modeLabel || view.gameName}</span>
      break
    case 'RESULTS':
      headline = modeLabel || view.gameName
      body = <ResultsBoard view={view} />
      bottom = view.results?.holdEndsAt ? (
        <>
          <span>{view.results.offer ? '' : 'Press space to play again'}</span>
          <span className="tnum">Next in {secondsLeft(view.results.holdEndsAt, now)}</span>
        </>
      ) : null
      break
  }

  return (
    <div onClick={unlockVoice}>
      <Stage headline={headline} bottom={bottom} logo={view.phase !== 'ATTRACT'}>
        {body}
      </Stage>
      {status !== 'connected' && <Banner>Projector lost the host. Reconnecting.</Banner>}
      {status === 'connected' && narrator.blocked && !view.muted && (
        <Banner quiet>Click anywhere on this screen once to switch the narrator on.</Banner>
      )}
      {status === 'connected' && view.pause && (
        <Banner right={view.pause.resumeAt ? '' : `${secondsLeft(view.pause.graceEndsAt, now)}`}>
          {view.pause.resumeAt
            ? 'Resuming.'
            : `${view.pause.seats.map((s) => seatLabel(s, view.seats[s].name)).join(' and ')} reconnecting. Hold on.`}
        </Banner>
      )}
    </div>
  )
}
