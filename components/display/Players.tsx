import type { ReactNode } from 'react'
import type { Seat } from '@/games/types'
import { PixelIcon } from '@/components/shared/PixelIcon'
import type { PixelIconName } from '@/components/shared/pixelIcons'

/** One column per seat in fixed order, icon above the label, as in the mock. Games fill the body. */
export function Players({ children }: { children: ReactNode }) {
  return <div className="players">{children}</div>
}

export function Player({
  seat,
  icon,
  label,
  off = false,
  ghost = false,
  sub,
  children,
}: {
  seat: Seat
  icon: PixelIconName
  label: string
  off?: boolean
  ghost?: boolean
  sub?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className={`player player-${seat}${off ? ' player-off' : ''}`} aria-label={label}>
      <div className={`player-icon${ghost ? ' player-icon-ghost' : ''}`}>
        <PixelIcon name={icon} />
      </div>
      <div className="player-label">{label}</div>
      {sub && <div className="player-sub">{sub}</div>}
      {children}
    </section>
  )
}
