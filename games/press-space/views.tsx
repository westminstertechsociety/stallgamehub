'use client'
import type { GameDisplayProps, GamePlayerProps, GameViews } from '@/games/types'
import { SEATS } from '@/games/types'
import { Lane, Lanes } from '@/components/display/Lane'
import { Centre } from '@/components/play/PlayFrame'
import type { PressSpaceDisplayView, PressSpacePlayerView } from './shared'

function Display({ view, names }: GameDisplayProps<PressSpaceDisplayView>) {
  const solo = view.mode === 'solo'
  return (
    <Lanes solo={solo}>
      {SEATS.map((seat) => {
        const playing = view.participants.includes(seat)
        if (!playing) {
          return (
            <Lane key={seat} seat={seat} name={names[seat]} open>
              <p className="lead">Press space on the other laptop to join the next round.</p>
            </Lane>
          )
        }
        const ms = view.finishedMs[seat]
        return (
          <Lane key={seat} seat={seat} name={names[seat]} end={ms != null ? `${(ms / 1000).toFixed(2)}s` : ''}>
            <div className="lane-number land" key={view.counts[seat]}>
              {view.counts[seat]}
              <small>/{view.target}</small>
            </div>
          </Lane>
        )
      })}
    </Lanes>
  )
}

function Player({ view }: GamePlayerProps<PressSpacePlayerView>) {
  return (
    <Centre>
      <p className="play-lead">{view.over ? 'Done' : 'Press space'}</p>
      <div className="play-number land" key={view.count}>
        {view.count}
      </div>
      <p className="play-sub">
        {view.finishedMs != null ? `${(view.finishedMs / 1000).toFixed(2)}s` : `${view.remaining} to go`}
      </p>
    </Centre>
  )
}

export const pressSpaceViews: GameViews<PressSpaceDisplayView, PressSpacePlayerView> = { Display, Player }
