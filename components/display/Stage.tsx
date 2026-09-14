import type { ReactNode } from 'react'

/** Projector shell: a quiet top line, the stage, a quiet bottom line. */
export function Stage({ top, bottom, children }: { top?: ReactNode; bottom?: ReactNode; children: ReactNode }) {
  return (
    <main className="stage">
      <div className="stage-top">{top}</div>
      <div className="stage-main">{children}</div>
      <div className="stage-bottom">{bottom}</div>
    </main>
  )
}

export function Banner({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="banner" role="status">
      <span>{children}</span>
      {right && <span className="tnum">{right}</span>}
    </div>
  )
}
