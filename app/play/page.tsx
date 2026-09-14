'use client'
// Player laptop. Read at 50cm while the eyes are mostly on the projector. One key: space.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useHub } from '@/lib/client/useHub'
import { attachKeyCapture } from '@/lib/client/keys'
import { beepStart, beepStop, blip, unlockAudio } from '@/lib/client/audio'
import { EVENTS, type ClientInput, type PlayerView } from '@/lib/shared/protocol'
import { gameViews } from '@/games/registry.client'
import type { HeldKeys, Seat } from '@/games/types'

function pinnedSeat(raw: string | null): Seat | null {
  const v = (raw ?? '').toUpperCase()
  return v === 'P1' || v === 'P2' ? v : null
}

function useLocalClock(active: boolean): number {
  const [t, setT] = useState(() => (typeof performance !== 'undefined' ? performance.now() : 0))
  useEffect(() => {
    if (!active) return
    let raf = 0
    const loop = () => {
      setT(performance.now())
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active])
  return t
}

function seconds(msLeft: number): string {
  return String(Math.max(0, Math.ceil(msLeft / 1000)))
}

function PlayInner() {
  const params = useSearchParams()
  const seat = pinnedSeat(params.get('seat'))
  const hub = useHub<PlayerView>('play', seat)
  const { view, status, send, superseded, reconnect } = hub
  const [held, setHeld] = useState<HeldKeys>({})
  const viewRef = useRef<PlayerView | null>(null)
  useEffect(() => {
    viewRef.current = view
  }, [view])
  const anyHeld = Object.keys(held).length > 0
  const localNow = useLocalClock(anyHeld)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250)
    return () => clearInterval(id)
  }, [])
  void tick

  const onInput = useCallback(
    (input: ClientInput) => {
      send(EVENTS.input, input, true)
      const v = viewRef.current
      if (!v || v.muted || !v.seat) return
      const hz = v.seat === 'P1' ? v.audio.p1Hz : v.audio.p2Hz
      if (input.type === 'down') beepStart(hz)
      else beepStop()
    },
    [send],
  )

  useEffect(() => {
    return attachKeyCapture({
      isAllowed: (code) => {
        const v = viewRef.current
        if (!v || !v.seat) return code === 'Space'
        return v.keys.includes(code)
      },
      onInput,
      onHeldChange: setHeld,
    })
  }, [onInput])

  // Resync held keys with the server after any reconnect so nothing stays stuck.
  useEffect(() => {
    if (status === 'connected') send(EVENTS.sync, {})
  }, [status, send])

  useEffect(() => {
    document.documentElement.dataset.highWash = String(view?.highWash ?? false)
    document.documentElement.dataset.reducedMotion = String(view?.reducedMotion ?? false)
  }, [view?.highWash, view?.reducedMotion])

  const prevPhase = useRef<string | null>(null)
  useEffect(() => {
    if (!view) return
    if (prevPhase.current && prevPhase.current !== view.phase && !view.muted && view.seat) {
      blip(view.seat === 'P1' ? view.audio.p1Hz : view.audio.p2Hz, 80)
    }
    prevPhase.current = view.phase
  }, [view])

  if (superseded) {
    return (
      <div className="overlay" onClick={unlockAudio}>
        <p>{superseded.reason === 'another-tab' ? 'This seat is open in another window on this laptop.' : `Another laptop took seat ${superseded.seat}.`}</p>
        <button type="button" onClick={reconnect}>
          Take it back
        </button>
      </div>
    )
  }

  if (!view) {
    return (
      <div className="overlay">
        <p>{status === 'reconnecting' ? 'Lost the host. Reconnecting.' : 'Connecting to the hub.'}</p>
      </div>
    )
  }

  if (!view.seat) {
    return (
      <div className="overlay">
        <p>Both seats are taken.</p>
        <p style={{ fontSize: 'var(--play-body)', fontWeight: 500 }}>Watch the projector, or open this page with ?seat=P1 or ?seat=P2 on a player laptop.</p>
      </div>
    )
  }

  const mySeat = view.seat
  const views = gameViews[view.gameId]
  const now = hub.serverNow()

  let main: React.ReactNode
  switch (view.phase) {
    case 'ATTRACT':
      main = (
        <>
          <p className="play-lead">Press space to start</p>
          <p className="play-sub">{view.gameName}</p>
        </>
      )
      break
    case 'LOBBY':
    case 'COUNTDOWN': {
      const lobby = view.lobby
      const cd = view.countdown
      main = (
        <>
          {cd && cd.participants.includes(mySeat) ? (
            <>
              <p className="play-lead">{cd.mode === 'versus' ? 'Head-to-head' : 'Playing solo'}</p>
              <div className="play-number tnum">{seconds(cd.endsAt - now)}</div>
              <p className="play-sub">{cd.mode === 'versus' ? 'Get ready.' : cd.joinable ? 'A second player can still join.' : 'Get ready.'}</p>
            </>
          ) : (
            <>
              <p className="play-lead">{cd ? 'Join in?' : 'How do you want to play?'}</p>
              {lobby && (
                <div className="play-options">
                  {lobby.options.map((o, i) => {
                    const ready = lobby.ready === o.id
                    const current = !lobby.ready && lobby.cursor === i
                    return (
                      <div key={o.id} className={`play-option${current ? ' play-option-current' : ''}${ready ? ' play-option-ready' : ''}`}>
                        {o.label}
                        {o.sub ? ` · ${o.sub}` : ''}
                        {o.blurb && current && <div className="play-hint">{o.blurb}</div>}
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="play-hint">{lobby?.ready ? 'Hold space to change your mind.' : 'Hold space to cycle. Tap space to pick.'}</p>
            </>
          )}
        </>
      )
      break
    }
    case 'PLAYING': {
      if (view.game != null && views) {
        main = (
          <views.Player
            view={view.game}
            seat={mySeat}
            held={held}
            localNow={localNow}
            serverNow={hub.serverNow}
            reducedMotion={view.reducedMotion}
          />
        )
      } else {
        main = (
          <>
            <p className="play-lead">You&apos;re in.</p>
            <p className="play-sub">Playing next. Watch the projector.</p>
          </>
        )
      }
      break
    }
    case 'RESULTS': {
      const r = view.results
      if (r?.naming) {
        main = (
          <>
            <p className="play-lead">{r.you ? r.you.scoreText : ''} · Enter your name</p>
            <div className="play-name">
              {r.naming.letters.map((ch, i) => (
                <div
                  key={i}
                  className={`play-name-slot${i === r.naming!.cursor ? ' play-name-slot-current' : ''}${i < r.naming!.cursor ? ' play-name-slot-done' : ''}`}
                >
                  {ch}
                </div>
              ))}
            </div>
            <p className="play-hint">Tap space to change the letter. Hold to confirm.</p>
          </>
        )
      } else if (r?.offer === 'toYou') {
        main = (
          <>
            <p className="play-lead">Play head-to-head?</p>
            <p className="play-sub">Hold space for a second to start.</p>
          </>
        )
      } else {
        main = (
          <>
            <p className="play-lead">{r?.you ? r.you.scoreText : r?.headline || 'Round over'}</p>
            <p className="play-sub">{r?.canRestart ? 'Press space to play again.' : 'One moment.'}</p>
          </>
        )
      }
      break
    }
  }

  return (
    <div className="play" onClick={unlockAudio}>
      <header className="play-top">
        <div className="play-top-seat">
          <span className={`seat-chip seat-chip-${mySeat}`}>{mySeat}</span>
          <span>{view.name || (mySeat === 'P1' ? 'Player 1' : 'Player 2')}</span>
        </div>
        <span className="play-hint">{view.gameName}</span>
      </header>
      <main className="play-main">{main}</main>
      {status !== 'connected' && <div className="overlay">Lost the host. Reconnecting.</div>}
      {view.pause && status === 'connected' && (
        <div className="overlay">{view.pause.seat === mySeat ? 'Welcome back. Resuming.' : `${view.pause.seat} is reconnecting. Hold on.`}</div>
      )}
      {view.seats[mySeat].stuck && <div className="overlay">A key looks stuck. Let go of the space bar.</div>}
    </div>
  )
}

export default function PlayPage() {
  return (
    <Suspense fallback={<div className="overlay">Loading.</div>}>
      <PlayInner />
    </Suspense>
  )
}
