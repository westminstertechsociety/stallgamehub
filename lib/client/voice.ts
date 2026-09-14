'use client'
// The narrator. Plays clips pre-rendered by scripts/render-voice.mjs (Kokoro, offline). One voice at a time,
// priorities decide who interrupts whom, and every key is rate-limited so the museum guide never nags.
// If a clip is missing, the browser's own speech synthesis fills in with the best British female voice it has.

export interface VoiceClip {
  file: string
  seconds: number
  text: string
}

export interface VoiceManifest {
  voice: string
  clips: Record<string, VoiceClip[]>
}

export interface SayOptions {
  /** 0 background trivia, 1 feedback, 2 phase cues, 3 must be heard. Higher interrupts lower; 3 also interrupts 3. */
  priority?: number
  /** Do not repeat this key within this many ms. */
  cooldownMs?: number
  /** Pick this variant rather than a rotating one. */
  index?: number
  onEnd?: () => void
}

type Listener = (state: VoiceState) => void
export interface VoiceState {
  ready: boolean
  blocked: boolean
  speaking: string | null
  muted: boolean
}

const listeners = new Set<Listener>()
let manifest: VoiceManifest | null = null
let audio: HTMLAudioElement | null = null
let current: { key: string; priority: number; onEnd?: () => void } | null = null
let muted = false
let blocked = false
const lastSaid = new Map<string, number>()
const rotation = new Map<string, number>()

function emit() {
  const s: VoiceState = { ready: manifest !== null, blocked, speaking: current?.key ?? null, muted }
  for (const l of listeners) l(s)
}

export function subscribe(l: Listener): () => void {
  listeners.add(l)
  l({ ready: manifest !== null, blocked, speaking: current?.key ?? null, muted })
  return () => {
    listeners.delete(l)
  }
}

export async function loadVoice(): Promise<VoiceManifest | null> {
  if (manifest) return manifest
  try {
    const res = await fetch('/voice/manifest.json', { cache: 'no-store' })
    if (!res.ok) throw new Error(String(res.status))
    manifest = (await res.json()) as VoiceManifest
  } catch {
    manifest = { voice: 'browser', clips: {} }
  }
  emit()
  return manifest
}

/** Seconds of the clip that would play for a key, so screens can pace themselves to the narration. */
export function durationOf(key: string, index?: number): number | null {
  const list = manifest?.clips[key]
  if (!list || list.length === 0) return null
  const i = index ?? rotation.get(key) ?? 0
  return list[i % list.length]?.seconds ?? null
}

export function hasClip(key: string): boolean {
  return Boolean(manifest?.clips[key]?.length)
}

export function setMuted(m: boolean) {
  if (muted === m) return
  muted = m
  if (m) stop()
  emit()
}

export function stop() {
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  const ended = current
  current = null
  ended?.onEnd?.()
  emit()
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null
  const voices = speechSynthesis.getVoices()
  const female = /female|hazel|libby|sonia|susan|kate|serena|fiona|moira|emma|olivia|maisie|google uk english female/i
  return (
    voices.find((v) => /en-GB/i.test(v.lang) && female.test(v.name)) ??
    voices.find((v) => /en-GB/i.test(v.lang)) ??
    voices.find((v) => /^en/i.test(v.lang) && female.test(v.name)) ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    null
  )
}

/**
 * Speak the clip for a key. Returns true if it started (or was queued to start). Lower-priority speech is
 * interrupted by higher; equal or lower priority waits its turn by simply not playing.
 */
export function say(key: string, opts: SayOptions = {}): boolean {
  if (typeof window === 'undefined') return false
  const priority = opts.priority ?? 1
  const now = Date.now()
  const last = lastSaid.get(key) ?? -Infinity
  if (opts.cooldownMs != null && now - last < opts.cooldownMs) return false
  if (current && (current.priority > priority || (current.priority === priority && priority < 3))) return false
  if (muted) return false
  const list = manifest?.clips[key] ?? []
  let text: string | null = null
  let file: string | null = null
  if (list.length) {
    const i = opts.index ?? rotation.get(key) ?? 0
    const clip = list[i % list.length]!
    rotation.set(key, (i + 1) % list.length)
    file = `/voice/${clip.file}`
    text = clip.text
  }
  stop()
  current = { key, priority, onEnd: opts.onEnd }
  lastSaid.set(key, now)
  const finish = () => {
    if (current?.key === key) {
      const ended = current
      current = null
      ended.onEnd?.()
      emit()
    }
  }
  if (file) {
    if (!audio) {
      audio = new Audio()
      audio.preload = 'auto'
    }
    audio.src = file
    audio.onended = finish
    audio.onerror = () => {
      // Missing or damaged clip: fall back to the browser voice for this line.
      if (text) speakFallback(text, finish)
      else finish()
    }
    const p = audio.play()
    if (p && typeof p.catch === 'function') {
      p.then(() => {
        if (blocked) {
          blocked = false
          emit()
        }
      }).catch((err: DOMException) => {
        if (err && err.name === 'NotAllowedError') {
          blocked = true
          current = null
          emit()
        } else if (text) speakFallback(text, finish)
        else finish()
      })
    }
    emit()
    return true
  }
  if (!text) {
    current = null
    return false
  }
  speakFallback(text, finish)
  emit()
  return true
}

function speakFallback(text: string, onEnd: () => void) {
  if (typeof speechSynthesis === 'undefined') {
    onEnd()
    return
  }
  const u = new SpeechSynthesisUtterance(text)
  const v = pickVoice()
  if (v) u.voice = v
  u.lang = 'en-GB'
  u.rate = 1
  u.onend = onEnd
  u.onerror = onEnd
  speechSynthesis.speak(u)
}

/** Call from any user gesture on the display to unlock autoplay after a NotAllowedError. */
export function unlockVoice() {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'auto'
  }
  blocked = false
  emit()
}

export function isSpeaking(): boolean {
  return current !== null
}
