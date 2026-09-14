'use client'
// Turns hub view changes into narration on the projector: phase cues, word wins, wrong letters, hot-join
// offers, and a slow drip of Morse trivia while people play. Everything is keyed into config/narration.json.
import { useEffect, useRef, useState } from 'react'
import type { DisplayView } from '@/lib/shared/protocol'
import type { MorseDisplayView } from '@/games/morse/shared'
import * as voice from './voice'

const TRIVIA_DEFAULT_MS = 28000

export function useNarrator(view: DisplayView | null, triviaEveryMs = TRIVIA_DEFAULT_MS) {
  const [state, setState] = useState<voice.VoiceState>({ ready: false, blocked: false, speaking: null, muted: false })
  const prev = useRef<DisplayView | null>(null)
  const lastTrivia = useRef(0)
  const lastWrong = useRef<Record<string, number>>({})

  useEffect(() => {
    void voice.loadVoice()
    return voice.subscribe(setState)
  }, [])

  useEffect(() => {
    if (!view) return
    voice.setMuted(view.muted)
    const before = prev.current
    prev.current = view
    if (!before) return

    // Phase cues.
    if (before.phase !== view.phase) {
      switch (view.phase) {
        case 'LOBBY':
          if (before.phase === 'ATTRACT') voice.say('lobby.wake', { priority: 2, cooldownMs: 20000 })
          break
        case 'COUNTDOWN':
          voice.say(view.countdown?.mode === 'versus' ? 'countdown.versus' : 'countdown.solo', { priority: 2 })
          break
        case 'PLAYING': {
          const morse = view.game as MorseDisplayView | null
          const key = morse?.learn ? 'learn.start' : 'versus.start'
          voice.say(key, { priority: 2 })
          lastTrivia.current = Date.now()
          break
        }
        case 'RESULTS': {
          const r = view.results
          const key = r?.variantId === 'learn' ? 'results.learn' : r?.mode === 'versus' ? 'results.versus' : 'results.solo'
          voice.say(key, { priority: 2 })
          break
        }
        case 'ATTRACT':
          voice.stop()
          break
      }
      return
    }

    if (view.phase === 'COUNTDOWN' && before.countdown && view.countdown && before.countdown.mode !== view.countdown.mode) {
      voice.say(view.countdown.mode === 'versus' ? 'countdown.versus' : 'countdown.solo', { priority: 2 })
    }

    if (view.phase === 'RESULTS' && !before.results?.offer && view.results?.offer) {
      voice.say('hotjoin', { priority: 2 })
    }

    if (view.phase === 'PLAYING') {
      const morse = view.game as MorseDisplayView | null
      const was = before.game as MorseDisplayView | null
      if (morse && was) {
        if (morse.phase === 'between' && was.phase !== 'between' && !morse.learn) {
          const who = morse.lastWordWinner
          if (who) voice.say(`won.${who}`, { priority: 1 })
        }
        if (morse.wordIndex > was.wordIndex && !morse.learn) voice.say('word.next', { priority: 1, cooldownMs: 4000 })
        for (const lane of morse.lanes) {
          const at = lane.wrong?.at
          if (at != null && lastWrong.current[lane.slot] !== at) {
            lastWrong.current[lane.slot] = at
            voice.say('wrong', { priority: 1, cooldownMs: 12000 })
          }
        }
      }
      const now = Date.now()
      if (now - lastTrivia.current > triviaEveryMs && !voice.isSpeaking()) {
        if (voice.say('trivia', { priority: 0 })) lastTrivia.current = now
      }
    }

    if (view.phase === 'LOBBY' && view.idleDeadline != null) {
      const left = view.idleDeadline - view.serverNow
      if (left < 12000 && left > 8000) voice.say('idle', { priority: 1, cooldownMs: 60000 })
    }
  }, [view, triviaEveryMs])

  return state
}
