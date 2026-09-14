'use client'
// Projector. Read-only. Everything here is sized to be read from ten metres.
import { useEffect } from 'react'
import { useHub } from '@/lib/client/useHub'
import { useServerClock, secondsLeft } from '@/lib/client/useServerClock'
import type { DisplayView } from '@/lib/shared/protocol'
import { EVENTS } from '@/lib/shared/protocol'
import { gameViews } from '@/games/registry.client'
import { seatLabel } from '@/components/shared/SeatChip'
import { Banner, Stage } from '@/components/display/Stage'
import { LobbyBoard } from '@/components/display/LobbyBoard'
import { ResultsBoard } from '@/components/display/ResultsBoard'
import { Ranking } from '@/components/display/Ranking'

function Attract({ view }: { view: DisplayView }) {
  // Step 4 replaces this with the museum-style attract loop; the wake-up card stays.
  return (
    <div className="centre">
      <h1 className="hero">Press space to play</h1>
      <p className="lead">Sit at either laptop and press the space bar.</p>
      <Ranking view={view} limit={3} />
    </div>
  )
}

function Playing({ view, serverNow }: { view: DisplayView; serverNow: () => number }) {
  const views = gameViews[view.gameId]
  const names = { P1: seatLabel('P1', view.seats.P1.name), P2: seatLabel('P2', view.seats.P2.name) }
  if (!views || view.game == null) return <p className="lead">Loading the game.</p>
  return (
    <views.Display
      view={view.game}
      names={names}
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

  if (!view) {
    return (
      <Stage>
        <div className="centre">
          <p className="lead">Connecting to the hub.</p>
        </div>
      </Stage>
    )
  }

  const modeLabel =
    view.phase === 'PLAYING' || view.phase === 'RESULTS'
      ? view.results?.variantLabel ?? (view.countdown?.variantLabel || '')
      : ''

  let top: React.ReactNode = <span>{view.gameName}</span>
  let bottom: React.ReactNode = null
  let body: React.ReactNode

  switch (view.phase) {
    case 'ATTRACT':
      top = null
      body = <Attract view={view} />
      break
    case 'LOBBY':
    case 'COUNTDOWN':
      body = <LobbyBoard view={view} now={now} />
      bottom = view.notice ? <span>{view.notice}</span> : null
      break
    case 'PLAYING':
      top = (
        <>
          <span>{view.gameName}</span>
          {modeLabel && <span>{modeLabel}</span>}
        </>
      )
      body = <Playing view={view} serverNow={hub.serverNow} />
      break
    case 'RESULTS':
      top = (
        <>
          <span>{view.gameName}</span>
          {modeLabel && <span>{modeLabel}</span>}
        </>
      )
      body = <ResultsBoard view={view} />
      bottom = view.results?.holdEndsAt ? (
        <>
          <span>Press space to play again</span>
          <span className="tnum">Next in {secondsLeft(view.results.holdEndsAt, now)}</span>
        </>
      ) : null
      break
  }

  return (
    <>
      <Stage top={top} bottom={bottom}>
        {body}
      </Stage>
      {status !== 'connected' && <Banner>Projector lost the host. Reconnecting.</Banner>}
      {status === 'connected' && view.pause && (
        <Banner right={view.pause.resumeAt ? '' : `${secondsLeft(view.pause.graceEndsAt, now)}`}>
          {view.pause.resumeAt
            ? 'Resuming.'
            : `${seatLabel(view.pause.seat, view.seats[view.pause.seat].name)} is reconnecting. Hold on.`}
        </Banner>
      )}
    </>
  )
}
