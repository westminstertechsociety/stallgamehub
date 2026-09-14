import { SEATS } from '@/games/types'
import type { DisplayView } from '@/lib/shared/protocol'
import { seatLabel } from '@/components/shared/SeatChip'
import { secondsLeft } from '@/lib/client/useServerClock'
import { Player, Players } from './Players'

export function LobbyBoard({ view, now }: { view: DisplayView; now: number }) {
  const lobby = view.lobby
  const cd = view.countdown
  return (
    <div className="stack">
      {cd ? (
        <div className="centre rise" key={`cd-${cd.mode}-${cd.endsAt}`}>
          <div className="hero-number land" key={secondsLeft(cd.endsAt, now)}>
            {secondsLeft(cd.endsAt, now)}
          </div>
          <p className="lead">
            {cd.mode === 'versus'
              ? 'Head-to-head. Same word, first to key it wins.'
              : cd.joinable
                ? `Starting solo: ${cd.variantLabel.toLowerCase()}. A second player can still join.`
                : `Starting solo: ${cd.variantLabel.toLowerCase()}.`}
          </p>
        </div>
      ) : (
        <div className="centre rise">
          <h1 className="word">Press space</h1>
          <p className="lead">
            {lobby?.quick
              ? 'Two players race head-to-head. One player learns the code.'
              : 'Hold space to cycle. Tap space to pick.'}
          </p>
        </div>
      )}
      {lobby && (
        <Players>
          {SEATS.map((seat) => {
            const s = view.seats[seat]
            const ready = Boolean(lobby.ready[seat])
            const inCountdown = cd?.participants.includes(seat) ?? false
            const icon = !s.connected ? 'user' : ready || inCountdown ? 'check' : 'user'
            return (
              <Player
                key={seat}
                seat={seat}
                icon={icon}
                label={s.connected ? seatLabel(seat, s.name) : 'Seat open'}
                off={!s.connected}
                sub={
                  !s.connected
                    ? `Sit at the ${seat === 'P1' ? 'left' : 'right'} laptop and press space.`
                    : ready || inCountdown
                      ? 'Ready'
                      : 'Press space to confirm'
                }
              >
                {s.connected && !lobby.quick && !ready && (
                  <div className="option-list">
                    {lobby.options.map((o, i) => (
                      <div key={o.id} className={`option${lobby.cursors[seat] === i ? ' option-current' : ''}`}>
                        {o.label}
                        {o.sub ? ` · ${o.sub}` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </Player>
            )
          })}
        </Players>
      )}
    </div>
  )
}
