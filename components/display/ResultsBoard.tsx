import { SEATS } from '@/games/types'
import type { DisplayView } from '@/lib/shared/protocol'
import { SeatChip, seatLabel } from '@/components/shared/SeatChip'
import { Ranking } from './Ranking'

export function ResultsBoard({ view }: { view: DisplayView }) {
  const r = view.results
  if (!r) return null
  const winnerName = r.winner ? seatLabel(r.winner, view.seats[r.winner].name) : null
  const headline =
    r.mode === 'versus' ? (winnerName ? `${winnerName} wins` : r.headline || 'Draw') : r.headline || 'Done'
  return (
    <div className="results">
      <div className="results-main">
        <h1 className="title rise">{headline}</h1>
        {r.naming.length > 0 && (
          <p className="lead">{r.naming.map((s) => seatLabel(s, '')).join(' and ')}: enter your name on your laptop.</p>
        )}
        {r.offer && <p className="lead">{r.offer.to}: hold space to play head-to-head.</p>}
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          {SEATS.filter((s) => r.seats[s]).map((seat) => {
            const so = r.seats[seat]
            return (
              <div
                key={seat}
                className={`results-row results-row-${seat}${r.winner === seat ? ' results-row-winner' : ''}`}
              >
                <SeatChip seat={seat} />
                <span className="lane-name">{so?.name || seatLabel(seat, view.seats[seat].name)}</span>
                <span className="tnum">{so?.scoreText}</span>
              </div>
            )
          })}
        </div>
      </div>
      <Ranking view={view} limit={5} />
    </div>
  )
}
