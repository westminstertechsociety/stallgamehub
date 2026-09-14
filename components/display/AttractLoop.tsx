'use client'
// Museum-style attract loop: full-bleed portrait, one fact, a name and a year. Cycles in the leaderboard
// and a "press space" card. Content comes from /attract/manifest.json, refetched when the operator reloads.
import { useEffect, useMemo, useState } from 'react'
import type { DisplayView } from '@/lib/shared/protocol'
import { Ranking } from './Ranking'

interface Card {
  name: string
  year: string
  fact: string
  image: string
  credit?: string
}

type Slide = { kind: 'pioneer'; card: Card } | { kind: 'wake' } | { kind: 'leaderboard' }

function sequence(cards: Card[]): Slide[] {
  const out: Slide[] = []
  if (cards.length === 0) return [{ kind: 'wake' }, { kind: 'leaderboard' }]
  cards.forEach((card, i) => {
    out.push({ kind: 'pioneer', card })
    if (i % 2 === 1) out.push({ kind: 'wake' })
    if (i % 3 === 2) out.push({ kind: 'leaderboard' })
  })
  if (cards.length % 2 === 1) out.push({ kind: 'wake' })
  if (cards.length % 3 !== 0) out.push({ kind: 'leaderboard' })
  return out
}

function useManifest(version: number): Card[] {
  const [cards, setCards] = useState<Card[]>([])
  useEffect(() => {
    let cancelled = false
    fetch(`/attract/manifest.json?v=${version}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ cards?: Card[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((m) => {
        if (cancelled) return
        const list = Array.isArray(m.cards) ? m.cards.filter((c) => c && c.name && c.fact) : []
        setCards(list)
      })
      .catch(() => {
        if (!cancelled) setCards([])
      })
    return () => {
      cancelled = true
    }
  }, [version])
  return cards
}

/** Loads an image and reports whether it is usable, so a missing portrait degrades to a typographic card. */
function useImageOk(src: string | null): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    if (!src) return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setOk(true)
    }
    img.onerror = () => {
      if (!cancelled) setOk(false)
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [src])
  return src ? ok : false
}

export function AttractLoop({ view }: { view: DisplayView }) {
  const cards = useManifest(view.contentVersion)
  const slides = useMemo(() => sequence(cards), [cards])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => i + 1), view.attractCardMs)
    return () => clearInterval(id)
  }, [view.attractCardMs, slides.length])

  const slide = slides[index % slides.length] ?? { kind: 'wake' as const }
  const next = slides[(index + 1) % slides.length]
  const nextSrc = next?.kind === 'pioneer' ? next.card.image : null
  const src = slide.kind === 'pioneer' ? slide.card.image : null
  const imageOk = useImageOk(src)
  const nextOk = useImageOk(nextSrc)
  void nextOk

  if (slide.kind === 'wake') {
    return (
      <div className="attract attract-wake" key={`wake-${index}`}>
        <h1 className="hero rise">Press space to play</h1>
        <p className="lead">Sit at either laptop and press the space bar. One key is all it takes.</p>
      </div>
    )
  }
  if (slide.kind === 'leaderboard') {
    return (
      <div className="attract attract-board" key={`board-${index}`}>
        <h1 className="hero rise">Fastest today</h1>
        <Ranking view={view} large limit={5} />
      </div>
    )
  }
  const { card } = slide
  return (
    <div className={`attract attract-pioneer${imageOk ? '' : ' attract-noimage'}`} key={`${card.name}-${index}`}>
      {imageOk && (
        <div className="attract-portrait">
          {/* eslint-disable-next-line @next/next/no-img-element -- local file served by the hub, no optimizer offline */}
          <img src={card.image} alt={`Portrait of ${card.name}`} />
        </div>
      )}
      <div className="attract-text">
        <p className="attract-fact rise">{card.fact}</p>
        <div className="attract-who">
          <span className="attract-name">{card.name}</span>
          <span className="attract-year tnum">{card.year}</span>
        </div>
        {card.credit && <span className="attract-credit">{card.credit}</span>}
      </div>
    </div>
  )
}
