'use client'
import type { GameDisplayProps, GamePlayerProps, GameViews } from '@/games/types'
import { SEATS } from '@/games/types'
import { Player, Players } from '@/components/display/Players'
import { Centre } from '@/components/play/PlayFrame'
import type { PressSpaceDisplayView, PressSpacePlayerView } from './shared'

function Display({ view, names, present }: GameDisplayProps<PressSpaceDisplayView>) {
  return (
    <div className="centre">
      <div className="word">{view.target}</div>
      <p className="small">presses</p>
      <Players>
        {SEATS.map((seat) => {
          const playing = view.participants.includes(seat)
          if (!playing) {
            return (
              <Player
                key={seat}
                seat={seat}
                icon="user"
                label={present[seat] ? names[seat] : 'Seat open'}
                off
                sub={present[seat] ? 'Press space to join the next round.' : 'Sit here and press space to join.'}
              />
            )
          }
          const ms = view.finishedMs[seat]
          return (
            <Player key={seat} seat={seat} icon={ms != null ? 'check' : 'pencil'} label={names[seat]} sub={ms != null ? `${(ms / 1000).toFixed(2)}s` : undefined}>
              <div className="player-letters tnum land" key={view.counts[seat]}>
                {view.counts[seat]}
              </div>
            </Player>
          )
        })}
      </Players>
    </div>
  )
}

function Player_({ view }: GamePlayerProps<PressSpacePlayerView>) {
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

export const pressSpaceViews: GameViews<PressSpaceDisplayView, PressSpacePlayerView> = { Display, Player: Player_ }
