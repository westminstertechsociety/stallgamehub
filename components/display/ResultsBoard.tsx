import { SEATS } from '@/games/types'
import type { DisplayView } from '@/lib/shared/protocol'
import { seatLabel } from '@/components/shared/SeatChip'
import { Player, Players } from './Players'
import { Ranking } from './Ranking'

export function ResultsBoard({ view }: { view: DisplayView }) {
  const r = view.results
  if (!r) return null
  const winnerName = r.winner ? seatLabel(r.winner, view.seats[r.winner].name) : null
  const headline =
    r.mode === 'versus' ? (winnerName ? `${winnerName} wins` : r.headline || 'Draw') : r.headline || 'Done'
  const note =
    r.naming.length > 0
      ? `${r.naming.map((s) => seatLabel(s, '')).join(' and ')}: enter your name on your laptop.`
      : r.offer
        ? `${seatLabel(r.offer.to, '')}: hold space to play head-to-head.`
        : null
  return (
    <div className="results">
      <h1 className="title rise">{headline}</h1>
      <Players>
        {SEATS.filter((s) => r.seats[s]).map((seat) => {
          const so = r.seats[seat]
          const won = r.winner === seat
          return (
            <Player
              key={seat}
              seat={seat}
              icon={won ? 'trophy' : r.naming.includes(seat) ? 'pencil' : 'check'}
              label={so?.name || seatLabel(seat, view.seats[seat].name)}
            >
              <div className="results-score tnum">{so?.scoreText}</div>
            </Player>
          )
        })}
      </Players>
      <div className="centre">
        {note && <p className="lead">{note}</p>}
        <Ranking view={view} limit={5} />
      </div>
    </div>
  )
}
