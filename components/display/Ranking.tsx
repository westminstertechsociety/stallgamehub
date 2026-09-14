import type { DisplayView } from '@/lib/shared/protocol'

/** Leaderboard grouped by variant. Solo and versus are never ranked against each other. */
export function Ranking({ view, large = false, limit }: { view: DisplayView; large?: boolean; limit?: number }) {
  const groups = view.variants
    .filter((v) => v.scored)
    .map((v) => ({ v, rows: view.leaderboard.filter((e) => e.variantId === v.id).slice(0, limit ?? 99) }))
    .filter((g) => g.rows.length > 0)
  if (groups.length === 0) return <p className="ranking-empty">No scores yet today. Be the first.</p>
  return (
    <div className="ranking">
      {groups.map(({ v, rows }) => (
        <div key={v.id} className="ranking-group">
          <div className="ranking-title">
            {view.gameName} · {v.label}
          </div>
          {rows.map((e, i) => (
            <div key={e.id} className={`ranking-row${large ? ' ranking-row-large' : ''}`}>
              <span className="ranking-rank">{i + 1}</span>
              <span>{e.name}</span>
              <span className="ranking-score">{e.scoreText}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
