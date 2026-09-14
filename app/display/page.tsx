'use client'
// Projector. Read-only. Everything here is sized to be read from ten metres.
import { useEffect, useMemo, useState } from 'react'
import { useHub } from '@/lib/client/useHub'
import type { DisplayView } from '@/lib/shared/protocol'
import { EVENTS } from '@/lib/shared/protocol'
import { gameViews } from '@/games/registry.client'
import type { Seat } from '@/games/types'
import { SEATS } from '@/games/types'

function useServerClock(serverNow: () => number, hz = 10): number {
  const [t, setT] = useState(() => serverNow())
  useEffect(() => {
    const id = setInterval(() => setT(serverNow()), 1000 / hz)
    return () => clearInterval(id)
  }, [serverNow, hz])
  return t
}

function seconds(msLeft: number): string {
  return String(Math.max(0, Math.ceil(msLeft / 1000)))
}

function seatName(view: DisplayView, seat: Seat): string {
  return view.seats[seat].name || (seat === 'P1' ? 'Player 1' : 'Player 2')
}

function Leaderboard({ view }: { view: DisplayView }) {
  const groups = view.variants
    .filter((v) => v.scored)
    .map((v) => ({ v, rows: view.leaderboard.filter((e) => e.variantId === v.id) }))
    .filter((g) => g.rows.length > 0)
  if (groups.length === 0) return <p className="leaderboard-empty">No scores yet. Be the first.</p>
  return (
    <div className="leaderboard">
      {groups.map(({ v, rows }) => (
        <div key={v.id} className="leaderboard-group">
          <div className="leaderboard-title">
            {view.gameName} · {v.label}
          </div>
          {rows.map((e, i) => (
            <div key={e.id} className="leaderboard-row">
              <span className="rank">{i + 1}</span>
              <span>{e.name}</span>
              <span>{e.scoreText}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function Attract({ view }: { view: DisplayView }) {
  return (
    <>
      <div>
        <p className="display-small">{view.gameName}</p>
      </div>
      <div style={{ display: 'grid', alignContent: 'center', gap: 'var(--space-6)' }}>
        <h1 className="display-hero">Press space to play</h1>
        <p className="display-body">Sit at either laptop and press the space bar.</p>
      </div>
      <Leaderboard view={view} />
    </>
  )
}

function Lobby({ view, now }: { view: DisplayView; now: number }) {
  const lobby = view.lobby
  const cd = view.countdown
  return (
    <>
      <div>
        <p className="display-small">{view.gameName}</p>
      </div>
      <div style={{ display: 'grid', alignContent: 'center', gap: 'var(--space-7)' }}>
        {cd ? (
          <div>
            <h1 className="display-hero tnum">{seconds(cd.endsAt - now)}</h1>
            <p className="display-body">
              {cd.mode === 'versus'
                ? `Head-to-head. ${cd.participants.map((s) => seatName(view, s)).join(' and ')}.`
                : cd.joinable
                  ? `Starting solo. A second player can still join.`
                  : `Starting solo.`}
            </p>
          </div>
        ) : (
          <div>
            <h1 className="display-hero">Choose how to play</h1>
            <p className="display-body">Hold space to cycle. Tap to pick.</p>
          </div>
        )}
        {lobby && (
          <div className="display-options">
            {SEATS.map((seat) => (
              <div key={seat} className="option-list" aria-label={`${seat} choice`}>
                <div className="lane-head">
                  <span className={`seat-chip seat-chip-${seat}`}>{seat}</span>
                  <span>{view.seats[seat].connected ? seatName(view, seat) : 'Seat open'}</span>
                </div>
                {view.seats[seat].connected &&
                  lobby.options.map((o, i) => {
                    const ready = lobby.ready[seat] === o.id
                    const current = !lobby.ready[seat] && lobby.cursors[seat] === i
                    return (
                      <div
                        key={o.id}
                        className={`option${current ? ' option-current' : ''}${ready ? ' option-ready' : ''}`}
                      >
                        {o.label}
                        {o.sub && <span className="option-sub">{o.sub}</span>}
                      </div>
                    )
                  })}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="display-footer">
        <span>{view.notice ?? ''}</span>
      </div>
    </>
  )
}

function Playing({ view, serverNow, now }: { view: DisplayView; serverNow: () => number; now: number }) {
  const views = gameViews[view.gameId]
  const names = { P1: seatName(view, 'P1'), P2: seatName(view, 'P2') }
  return (
    <>
      <div className="display-footer">
        <span className="display-small">{view.gameName}</span>
        {view.pause && (
          <span className="display-small tnum">
            {view.pause.resumeAt ? 'Resuming' : `${view.pause.seat} reconnecting · ${seconds(view.pause.graceEndsAt - now)}`}
          </span>
        )}
      </div>
      <div style={{ minHeight: 0 }}>
        {views && view.game != null ? (
          <views.Display view={view.game} names={names} serverNow={serverNow} reducedMotion={view.reducedMotion} />
        ) : (
          <p className="display-body">Loading game view.</p>
        )}
      </div>
      <div />
    </>
  )
}

function Results({ view, now }: { view: DisplayView; now: number }) {
  const r = view.results
  if (!r) return null
  const winnerName = r.winner ? seatName(view, r.winner) : null
  return (
    <>
      <div>
        <p className="display-small">
          {view.gameName} · {r.variantLabel}
        </p>
      </div>
      <div style={{ display: 'grid', alignContent: 'center', gap: 'var(--space-6)' }}>
        <h1 className="display-hero">{r.mode === 'versus' ? (winnerName ? `${winnerName} wins` : r.headline || 'Draw') : r.headline || 'Done'}</h1>
        <div className="display-options">
          {SEATS.filter((s) => r.seats[s]).map((seat) => (
            <div key={seat} className="lane-head" style={{ fontSize: 'var(--display-body)' }}>
              <span className={`seat-chip seat-chip-${seat}`}>{seat}</span>
              <span>{r.seats[seat]?.name || seatName(view, seat)}</span>
              <span className="tnum">{r.seats[seat]?.scoreText}</span>
            </div>
          ))}
        </div>
        {r.naming.length > 0 && (
          <p className="display-body">{r.naming.join(' and ')} entering a name.</p>
        )}
        {r.offer && (
          <p className="display-body">
            {r.offer.to}: hold space to play head-to-head.
          </p>
        )}
        <Leaderboard view={view} />
      </div>
      <div className="display-footer">
        <span>{r.holdEndsAt ? `Next in ${seconds(r.holdEndsAt - now)}` : ''}</span>
        <span>{r.holdEndsAt ? 'Press space to play again' : ''}</span>
      </div>
    </>
  )
}

export default function DisplayPage() {
  const hub = useHub<DisplayView>('display')
  const { view, status, send } = hub
  const now = useServerClock(hub.serverNow)

  // Operator chord: Ctrl+Alt+Shift+R hard-resets the session (not Ctrl+Shift+R, that is browser reload).
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

  const body = useMemo(() => {
    if (!view) return null
    switch (view.phase) {
      case 'ATTRACT':
        return <Attract view={view} />
      case 'LOBBY':
      case 'COUNTDOWN':
        return <Lobby view={view} now={now} />
      case 'PLAYING':
        return <Playing view={view} serverNow={hub.serverNow} now={now} />
      case 'RESULTS':
        return <Results view={view} now={now} />
    }
  }, [view, now, hub.serverNow])

  return (
    <main className="display">
      {body ?? (
        <div style={{ display: 'grid', placeContent: 'center' }}>
          <h1 className="display-body">Connecting to the hub.</h1>
        </div>
      )}
      {status !== 'connected' && view && <div className="display-banner">Projector lost the host. Reconnecting.</div>}
      {view?.pause && status === 'connected' && (
        <div className="display-banner">
          {view.pause.resumeAt ? 'Resuming.' : `${view.pause.seat} reconnecting. Hold on.`}
        </div>
      )}
    </main>
  )
}
