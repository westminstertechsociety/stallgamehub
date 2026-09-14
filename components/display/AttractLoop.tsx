'use client'
// Museum-style attract loop: portrait, one pixel-type sentence, the narrator reading the longer story.
// Each pioneer card stays up for as long as its narration runs (plus a beat). Content comes from
// /api/attract (the last manifest that parsed) and refetches when the operator reloads content.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DisplayView } from '@/lib/shared/protocol'
import { Logo } from '@/components/shared/Logo'
import * as voice from '@/lib/client/voice'
import { Ranking } from './Ranking'

interface Card {
  id: string
  name: string
  year: string
  headline: string
  speak?: string
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
    fetch(`/api/attract?v=${version}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ cards?: Card[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((m) => {
        if (cancelled) return
        setCards(Array.isArray(m.cards) ? m.cards.filter((c) => c && c.name && c.headline) : [])
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
  const [state, setState] = useState<{ src: string; ok: boolean } | null>(null)
  useEffect(() => {
    if (!src) return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setState({ src, ok: true })
    }
    img.onerror = () => {
      if (!cancelled) setState({ src, ok: false })
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [src])
  if (!src) return false
  return state && state.src === src ? state.ok : null
}

function Words({ text }: { text: string }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          <span className="w" style={{ ['--i' as string]: i }}>
            {w}
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  )
}

export function AttractLoop({ view }: { view: DisplayView }) {
  const cards = useManifest(view.contentVersion)
  const slides = useMemo(() => sequence(cards), [cards])
  const [index, setIndex] = useState(0)
  const slide = slides[index % slides.length] ?? { kind: 'wake' as const }
  const spoke = useRef<string | null>(null)

  // A pioneer card stays for its narration plus a beat; other cards use the configured time.
  const narrationKey = slide.kind === 'pioneer' ? `pioneer.${slide.card.id}` : slide.kind === 'wake' ? 'attract.welcome' : null
  const narrated = narrationKey ? voice.durationOf(narrationKey) : null
  const holdMs = Math.max(view.attractCardMs, narrated != null ? narrated * 1000 + 2500 : 0)

  useEffect(() => {
    const id = setTimeout(() => setIndex((i) => i + 1), holdMs)
    return () => clearTimeout(id)
  }, [index, holdMs, slides.length])

  useEffect(() => {
    const token = `${index}:${narrationKey ?? ''}`
    if (spoke.current === token) return
    spoke.current = token
    if (narrationKey) voice.say(narrationKey, { priority: 1 })
  }, [index, narrationKey])

  const next = slides[(index + 1) % slides.length]
  const nextSrc = next?.kind === 'pioneer' ? next.card.image : null
  const src = slide.kind === 'pioneer' ? slide.card.image : null
  const imageOk = useImageOk(src)
  const nextOk = useImageOk(nextSrc)
  void nextOk

  if (slide.kind === 'wake') {
    return (
      <div className="attract attract-wake" key={`wake-${index}`}>
        <h1 className="word rise">Press space</h1>
        <p className="lead">Sit at either laptop and press the space bar to play. Two players race, one player learns.</p>
      </div>
    )
  }
  if (slide.kind === 'leaderboard') {
    return (
      <div className="attract attract-board" key={`board-${index}`}>
        <h1 className="title rise">Fastest today</h1>
        <Ranking view={view} large limit={5} />
      </div>
    )
  }
  const { card } = slide
  return (
    <div
      className={`attract attract-pioneer${imageOk ? '' : ' attract-noimage'}`}
      key={`${card.id}-${index}`}
      style={{ ['--drift' as string]: `${Math.round(holdMs / 1000)}s` }}
    >
      {imageOk && (
        <div className="attract-portrait">
          {/* eslint-disable-next-line @next/next/no-img-element -- local file served by the hub, no optimizer offline */}
          <img src={card.image} alt={`Portrait of ${card.name}`} />
        </div>
      )}
      <div className="attract-text">
        <Logo />
        <h1 className="attract-headline">
          <Words text={card.headline} />
        </h1>
        <div className="attract-meta">
          <span>{card.year}</span>
          {card.credit && <span className="attract-credit">{card.credit}</span>}
        </div>
      </div>
    </div>
  )
}
