import type { LobbyOption } from '@/lib/shared/protocol'

export function OptionPicker({ options, cursor, ready }: { options: LobbyOption[]; cursor: number; ready: string | null }) {
  return (
    <div className="picker" role="listbox" aria-label="How to play">
      {options.map((o, i) => {
        const isReady = ready === o.id
        const current = !ready && cursor === i
        return (
          <div
            key={o.id}
            role="option"
            aria-selected={current || isReady}
            className={`picker-option${current ? ' picker-option-current' : ''}${isReady ? ' picker-option-ready' : ''}`}
          >
            {o.label}
            {o.sub ? ` · ${o.sub}` : ''}
            {o.blurb && (current || isReady) && <span className="picker-blurb">{o.blurb}</span>}
          </div>
        )
      })}
    </div>
  )
}
