'use client'
// Player laptop. Read at 50cm while the eyes are mostly on the projector. One key: space.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useHub } from '@/lib/client/useHub'
import { useServerClock, secondsLeft } from '@/lib/client/useServerClock'
import { attachKeyCapture } from '@/lib/client/keys'
import { beepStart, beepStop, blip, unlockAudio } from '@/lib/client/audio'
import { EVENTS, type ClientInput, type PlayerView } from '@/lib/shared/protocol'
import { gameViews } from '@/games/registry.client'
import type { HeldKeys, Seat } from '@/games/types'
import { Centre, Overlay, PlayFrame } from '@/components/play/PlayFrame'
import { OptionPicker } from '@/components/play/OptionPicker'
import { NameEntry } from '@/components/play/NameEntry'
import { HoldRing } from '@/components/play/HoldRing'

function pinnedSeat(raw: string | null): Seat | null {
  const v = (raw ?? '').toUpperCase()
  return v === 'P1' || v === 'P2' ? v : null
}

/** performance.now() that ticks every frame while a key is held, so local feedback is smooth. */
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
  const spaceSince = held.Space ?? null
  const localNow = useLocalClock(spaceSince != null)
  const now = useServerClock(hub.serverNow, 4)

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

  // After any reconnect, tell the server no keys are held so nothing stays stuck.
  useEffect(() => {
    if (status === 'connected') send(EVENTS.sync, {})
  }, [status, send])

  useEffect(() => {
    document.documentElement.dataset.highWash = String(view?.highWash ?? false)
    document.documentElement.dataset.reducedMotion = String(view?.reducedMotion ?? false)
  }, [view?.highWash, view?.reducedMotion])

  // A short blip marks a phase change so the player notices without looking down.
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
      <Overlay>
        <p>
          {superseded.reason === 'another-tab'
            ? 'This seat is open in another window on this laptop.'
            : `Another laptop has taken seat ${superseded.seat}.`}
        </p>
        <button type="button" onClick={reconnect}>
          Use this window
        </button>
      </Overlay>
    )
  }

  if (!view) {
    return (
      <Overlay quiet>
        <p>{status === 'reconnecting' ? 'Lost the host. Reconnecting.' : 'Connecting to the hub.'}</p>
      </Overlay>
    )
  }

  if (!view.seat) {
    return (
      <Overlay quiet>
        <p>Both seats are taken.</p>
        <p className="overlay-sub">Watch the projector, or open this page with ?seat=P1 or ?seat=P2 on a player laptop.</p>
      </Overlay>
    )
  }

  const mySeat = view.seat
  const views = gameViews[view.gameId]
  const linkOk = status === 'connected'

  let main: React.ReactNode
  switch (view.phase) {
    case 'ATTRACT':
      main = (
        <Centre>
          <p className="play-lead">Press space to start</p>
          <p className="play-sub">{view.gameName}</p>
        </Centre>
      )
      break
    case 'LOBBY':
    case 'COUNTDOWN': {
      const lobby = view.lobby
      const cd = view.countdown
      if (cd && cd.participants.includes(mySeat)) {
        main = (
          <Centre>
            <p className="play-lead">{cd.mode === 'versus' ? 'Head-to-head' : 'Playing solo'}</p>
            <div className="play-number tnum">{secondsLeft(cd.endsAt, now)}</div>
            <p className="play-sub">
              {cd.mode === 'versus' ? 'Get ready.' : cd.joinable ? 'A second player can still join.' : 'Get ready.'}
            </p>
            {lobby?.ready && <p className="play-hint">Hold space to change your mind.</p>}
          </Centre>
        )
      } else {
        main = (
          <Centre>
            <p className="play-lead">{cd ? 'Join in?' : 'How do you want to play?'}</p>
            {lobby && <OptionPicker options={lobby.options} cursor={lobby.cursor} ready={lobby.ready} />}
            <HoldRing heldSince={spaceSince} localNow={localNow} ms={view.holdMs} />
            <p className="play-hint">{lobby?.ready ? 'Hold space to change your mind.' : 'Hold space to cycle. Tap space to pick.'}</p>
          </Centre>
        )
      }
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
            builtAt={view.serverNow}
            serverNow={hub.serverNow}
            reducedMotion={view.reducedMotion}
          />
        )
      } else {
        main = (
          <Centre>
            <p className="play-lead">You&apos;re in.</p>
            <p className="play-sub">Playing next. Watch the projector.</p>
          </Centre>
        )
      }
      break
    }
    case 'RESULTS': {
      const r = view.results
      if (r?.naming) {
        main = (
          <Centre>
            <p className="play-lead">{r.you ? `${r.you.scoreText}. ` : ''}Enter your name</p>
            <NameEntry letters={r.naming.letters} cursor={r.naming.cursor} />
            <HoldRing heldSince={spaceSince} localNow={localNow} ms={view.holdMs} />
            <p className="play-hint">Tap space to change the letter. Hold to confirm it.</p>
          </Centre>
        )
      } else if (r?.offer === 'toYou') {
        main = (
          <Centre>
            <p className="play-lead">Play head-to-head?</p>
            <HoldRing heldSince={spaceSince} localNow={localNow} ms={1000} />
            <p className="play-sub">Hold space for a second to start.</p>
          </Centre>
        )
      } else {
        main = (
          <Centre>
            <p className="play-lead">
              {r?.you ? r.you.scoreText : r?.headline || 'Round over'}
            </p>
            <p className="play-sub">{r?.canRestart ? 'Press space to play again.' : 'One moment.'}</p>
          </Centre>
        )
      }
      break
    }
  }

  return (
    <div onClick={unlockAudio}>
      <PlayFrame seat={mySeat} name={view.name} gameName={view.gameName} linkOk={linkOk}>
        {main}
      </PlayFrame>
      {!linkOk && (
        <Overlay>
          <p>Lost the host. Reconnecting.</p>
        </Overlay>
      )}
      {linkOk && view.pause && (
        <Overlay quiet>
          <p>{view.pause.seat === mySeat ? 'Welcome back. Resuming.' : `${view.pause.seat} is reconnecting. Hold on.`}</p>
        </Overlay>
      )}
      {linkOk && view.seats[mySeat].stuck && (
        <Overlay>
          <p>A key looks stuck. Let go of the space bar.</p>
        </Overlay>
      )}
    </div>
  )
}

export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <Overlay quiet>
          <p>Loading.</p>
        </Overlay>
      }
    >
      <PlayInner />
    </Suspense>
  )
}
