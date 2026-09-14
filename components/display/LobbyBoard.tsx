import { SEATS } from '@/games/types'
import type { DisplayView } from '@/lib/shared/protocol'
import { SeatChip, seatLabel } from '@/components/shared/SeatChip'
import { secondsLeft } from '@/lib/client/useServerClock'

export function LobbyBoard({ view, now }: { view: DisplayView; now: number }) {
  const lobby = view.lobby
  const cd = view.countdown
  const bothOff = !view.seats.P1.connected && !view.seats.P2.connected
  return (
    <div className="stack">
      {cd ? (
        <div className="rise" key={`cd-${cd.mode}-${cd.endsAt}`}>
          <div className="hero-number land" key={secondsLeft(cd.endsAt, now)}>
            {secondsLeft(cd.endsAt, now)}
          </div>
          <p className="lead">
            {cd.mode === 'versus'
              ? `Head-to-head. ${cd.participants.map((s) => seatLabel(s, view.seats[s].name)).join(' and ')}.`
              : cd.joinable
                ? 'Starting solo. A second player can still join.'
                : 'Starting solo.'}
          </p>
        </div>
      ) : (
        <div className="rise">
          <h1 className="title">{bothOff ? 'Press space to play' : 'Choose how to play'}</h1>
          <p className="lead">Hold space to cycle. Tap space to pick.</p>
        </div>
      )}
      {lobby && (
        <div className="board">
          {SEATS.map((seat) => {
            const s = view.seats[seat]
            const inCountdown = cd?.participants.includes(seat) ?? false
            return (
              <div key={seat} className="board-seat" aria-label={`${seat}`}>
                <div className="board-head">
                  <SeatChip seat={seat} off={!s.connected} />
                  <span>{s.connected ? seatLabel(seat, s.name) : 'Seat open'}</span>
                </div>
                {s.connected ? (
                  inCountdown ? (
                    <div className="option option-ready">{cd?.mode === 'versus' ? 'Ready' : 'Ready. Playing solo.'}</div>
                  ) : (
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
                    })
                  )
                ) : (
                  <div className="board-open">
                    <span>Sit at the {seat === 'P1' ? 'left' : 'right'} laptop.</span>
                    <span>Press space to join.</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
