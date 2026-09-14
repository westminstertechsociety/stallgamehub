'use client'
import type { GameDisplayProps, GamePlayerProps, GameViews } from '@/games/types'
import type { PressSpaceDisplayView, PressSpacePlayerView } from './shared'

function Display({ view, names }: GameDisplayProps<PressSpaceDisplayView>) {
  return (
    <div className="lanes">
      {view.participants.map((seat) => (
        <section key={seat} className={`lane lane-${seat}`} aria-label={`${seat} lane`}>
          <header className="lane-head">
            <span className="seat-chip">{seat}</span>
            <span className="lane-name">{names[seat] || (seat === 'P1' ? 'Player 1' : 'Player 2')}</span>
          </header>
          <div className="display-number">
            {view.counts[seat]}
            <span className="display-number-of">/{view.target}</span>
          </div>
          {view.finishedMs[seat] != null && (
            <p className="display-body">{(view.finishedMs[seat] / 1000).toFixed(2)}s</p>
          )}
        </section>
      ))}
    </div>
  )
}

function Player({ view }: GamePlayerProps<PressSpacePlayerView>) {
  return (
    <div className="play-game">
      <p className="play-lead">{view.over ? 'Done' : 'Press space'}</p>
      <div className="play-number">{view.count}</div>
      <p className="play-sub">
        {view.finishedMs != null ? `${(view.finishedMs / 1000).toFixed(2)}s` : `${view.remaining} to go`}
      </p>
    </div>
  )
}

export const pressSpaceViews: GameViews<PressSpaceDisplayView, PressSpacePlayerView> = { Display, Player }
