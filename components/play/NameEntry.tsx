export function NameEntry({ letters, cursor }: { letters: string[]; cursor: number }) {
  return (
    <div className="name-entry" aria-label="Name entry">
      {letters.map((ch, i) => (
        <div
          key={i}
          className={`name-slot${i === cursor ? ' name-slot-current' : ''}${i < cursor ? ' name-slot-done' : ''}`}
        >
          {ch}
        </div>
      ))}
    </div>
  )
}
