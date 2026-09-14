import type { ReactNode } from 'react'
import type { Seat } from '@/games/types'
import { SeatChip, seatLabel } from '@/components/shared/SeatChip'

/**
 * A race lane. Fixed position per seat (P1 above P2), seat tint as the surface, chip and name at the left.
 * Games put whatever they race with in the middle and a result at the right.
 */
export function Lane({
  seat,
  name,
  open = false,
  end,
  children,
}: {
  seat: Seat
  name: string
  open?: boolean
  end?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className={`lane ${open ? 'lane-open' : `lane-${seat}`}`} aria-label={`${seat} lane`}>
      <div className="lane-who">
        <SeatChip seat={seat} off={open} />
        <span className="lane-name">{open ? 'Seat open' : seatLabel(seat, name)}</span>
      </div>
      <div className="lane-body">{children}</div>
      <div className="lane-end">{end}</div>
    </section>
  )
}

export function Lanes({ solo = false, children }: { solo?: boolean; children: ReactNode }) {
  return <div className={`lanes${solo ? ' lanes-solo' : ''}`}>{children}</div>
}
