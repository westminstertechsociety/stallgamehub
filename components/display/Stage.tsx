import type { ReactNode } from 'react'
import { Logo } from '@/components/shared/Logo'

/** Projector shell: the wordmark on top, the stage, a quiet bottom line. */
export function Stage({
  headline,
  bottom,
  logo = true,
  children,
}: {
  headline?: ReactNode
  bottom?: ReactNode
  logo?: boolean
  children: ReactNode
}) {
  return (
    <main className="stage">
      <div className="stage-top">
        {logo && <Logo />}
        {headline && <p className="headline">{headline}</p>}
      </div>
      <div className="stage-main">{children}</div>
      <div className="stage-bottom">{bottom}</div>
    </main>
  )
}

export function Banner({ children, right, quiet = false }: { children: ReactNode; right?: ReactNode; quiet?: boolean }) {
  return (
    <div className={`banner${quiet ? ' banner-quiet' : ''}`} role="status">
      <span>{children}</span>
      {right && <span className="tnum">{right}</span>}
    </div>
  )
}
