import type { ReactNode } from 'react'
import type { Seat } from '@/games/types'
import { SeatChip, seatLabel } from '@/components/shared/SeatChip'

export function PlayFrame({
  seat,
  name,
  gameName,
  linkOk,
  children,
}: {
  seat: Seat
  name: string
  gameName: string
  linkOk: boolean
  children: ReactNode
}) {
  return (
    <div className="play">
      <header className="play-top">
        <div className="play-top-seat">
          <SeatChip seat={seat} />
          <span>{seatLabel(seat, name)}</span>
        </div>
        <span>{gameName}</span>
        <span className="play-top-link" data-ok={String(linkOk)}>
          {linkOk ? 'Connected' : 'Reconnecting'}
        </span>
      </header>
      <main className="play-main">{children}</main>
    </div>
  )
}

export function Centre({ children }: { children: ReactNode }) {
  return <div className="play-centre">{children}</div>
}

export function Overlay({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return <div className={`overlay${quiet ? ' overlay-quiet' : ''}`}>{children}</div>
}
