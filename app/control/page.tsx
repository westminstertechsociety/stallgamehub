'use client'
// Operator panel for a phone. Big buttons, hold-to-confirm on anything destructive.
import { useEffect, useRef, useState } from 'react'
import { useHub } from '@/lib/client/useHub'
import { EVENTS, type ControlCommand, type ControlView } from '@/lib/shared/protocol'
import { SEATS } from '@/games/types'
import { Logo } from '@/components/shared/Logo'

function HoldButton({ label, onConfirm, ms = 900 }: { label: string; onConfirm: () => void; ms?: number }) {
  const [progress, setProgress] = useState(0)
  const timer = useRef<number | null>(null)
  const start = useRef(0)
  const stop = () => {
    if (timer.current) cancelAnimationFrame(timer.current)
    timer.current = null
    setProgress(0)
  }
  useEffect(() => stop, [])
  const begin = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = performance.now()
    const loop = () => {
      const p = Math.min(1, (performance.now() - start.current) / ms)
      setProgress(p)
      if (p >= 1) {
        stop()
        onConfirm()
        return
      }
      timer.current = requestAnimationFrame(loop)
    }
    timer.current = requestAnimationFrame(loop)
  }
  return (
    <button
      type="button"
      className="control-btn control-btn-hold"
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="hold-fill" style={{ width: `${progress * 100}%` }} />
      {label} (hold)
    </button>
  )
}

const PHASE_LABEL: Record<ControlView['phase'], string> = {
  ATTRACT: 'Attract loop',
  LOBBY: 'Lobby',
  COUNTDOWN: 'Countdown',
  PLAYING: 'Playing',
  RESULTS: 'Results',
}

export default function ControlPage() {
  const hub = useHub<ControlView>('control')
  const { view, status, send } = hub
  const cmd = (c: ControlCommand) => send(EVENTS.control, c)

  useEffect(() => {
    document.body.dataset.scroll = 'true'
    return () => {
      delete document.body.dataset.scroll
    }
  }, [])

  if (!view) {
    return (
      <main className="control">
        <h1>Control</h1>
        <p>{status === 'reconnecting' ? 'Lost the host. Reconnecting.' : 'Connecting.'}</p>
      </main>
    )
  }

  return (
    <main className="control">
      <h1>
        <span>Control</span>
        <Logo />
      </h1>
      <section className="control-card">
        <dl className="control-status">
          <dt>Phase</dt>
          <dd>{PHASE_LABEL[view.phase]}</dd>
          <dt>Game</dt>
          <dd>{view.gameName}</dd>
          {SEATS.map((seat) => (
            <div key={seat} style={{ display: 'contents' }}>
              <dt>{seat}</dt>
              <dd>
                <span className={`control-pill ${view.seatsDetail[seat].connected ? 'control-pill-on' : 'control-pill-off'}`}>
                  {view.seatsDetail[seat].connected ? 'connected' : 'offline'}
                </span>{' '}
                {view.seatsDetail[seat].presence}
                {view.seatsDetail[seat].name ? ` · ${view.seatsDetail[seat].name}` : ''}
                {view.seatsDetail[seat].rtt != null ? ` · ${view.seatsDetail[seat].rtt}ms` : ''}
                {view.seatsDetail[seat].stuck ? ' · key stuck' : ''}
              </dd>
            </div>
          ))}
          <dt>Screens</dt>
          <dd>
            {view.sockets.display} display · {view.sockets.play} play · {view.sockets.control} control
          </dd>
          <dt>Link</dt>
          <dd>{status === 'connected' ? `ok${hub.rtt() != null ? ` · ${Math.round(hub.rtt() ?? 0)}ms` : ''}` : status}</dd>
          <dt>Content</dt>
          <dd>{view.content.ok ? 'ok' : view.content.error}</dd>
          <dt>Errors</dt>
          <dd>{view.errors}</dd>
          <dt>Host</dt>
          <dd>
            {view.ips.map((ip) => `${ip}:${view.port}`).join(', ') || 'no LAN address'} · up {Math.floor(view.uptimeMs / 60000)} min
          </dd>
        </dl>
        {view.notice && <p>{view.notice}</p>}
      </section>

      <section className="control-card">
        <label>
          Game{' '}
          <select value={view.gameId} onChange={(e) => cmd({ cmd: 'selectGame', gameId: e.target.value })}>
            {view.games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <div className="control-row">
          <button type="button" className="control-btn control-btn-primary" onClick={() => cmd({ cmd: 'start' })}>
            Start
          </button>
          <button type="button" className="control-btn" onClick={() => cmd({ cmd: 'skip' })}>
            Skip
          </button>
          <button type="button" className="control-btn" onClick={() => cmd({ cmd: 'endRound' })}>
            End round
          </button>
          <button type="button" className="control-btn" onClick={() => cmd({ cmd: 'forceAttract' })}>
            Attract mode
          </button>
        </div>
      </section>

      <section className="control-card">
        <div className="control-row">
          {SEATS.map((seat) => (
            <button key={seat} type="button" className="control-btn" onClick={() => cmd({ cmd: 'kick', seat })}>
              Reset {seat}
            </button>
          ))}
          <button
            type="button"
            className={`control-btn${view.muted ? ' control-btn-active' : ''}`}
            onClick={() => cmd({ cmd: 'mute', muted: !view.muted })}
          >
            {view.muted ? 'Unmute narrator and beeps' : 'Mute narrator and beeps'}
          </button>
          <button
            type="button"
            className={`control-btn${view.highWash ? ' control-btn-active' : ''}`}
            onClick={() => cmd({ cmd: 'highWash', on: !view.highWash })}
          >
            High contrast {view.highWash ? 'on' : 'off'}
          </button>
          <button type="button" className="control-btn" onClick={() => cmd({ cmd: 'reloadContent' })}>
            Reload content
          </button>
        </div>
      </section>

      <section className="control-card">
        <div className="control-row">
          <HoldButton label="Clear leaderboard" onConfirm={() => cmd({ cmd: 'resetScores' })} />
          <HoldButton label="Clear ghosts" onConfirm={() => cmd({ cmd: 'resetGhosts' })} />
          <HoldButton label="Hard reset session" onConfirm={() => cmd({ cmd: 'hardReset' })} />
        </div>
      </section>

      <section className="control-card">
        <h2>Leaderboard</h2>
        {view.leaderboard.length === 0 && <span className="play-hint">Empty.</span>}
        <div className="control-lb">
          {view.leaderboard.map((e) => (
            <span key={e.id} style={{ display: 'contents' }}>
              <span>{e.name}</span>
              <span>{view.variants.find((v) => v.id === e.variantId)?.label ?? e.variantId}</span>
              <span>{e.scoreText}</span>
            </span>
          ))}
        </div>
      </section>
    </main>
  )
}
