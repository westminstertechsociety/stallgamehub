// crypto.randomUUID is unavailable on a plain-http LAN origin; getRandomValues is fine everywhere.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function randomId(length = 16): string {
  const bytes = new Uint8Array(length)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

function stored(storage: Storage | null, key: string): string {
  try {
    const existing = storage?.getItem(key)
    if (existing && /^[A-Za-z0-9_-]{4,64}$/.test(existing)) return existing
    const fresh = randomId()
    storage?.setItem(key, fresh)
    return fresh
  } catch {
    return randomId()
  }
}

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server'
  return stored(window.localStorage, 'hub.deviceId')
}

export function getTabId(): string {
  if (typeof window === 'undefined') return 'server'
  return stored(window.sessionStorage, 'hub.tabId')
}
