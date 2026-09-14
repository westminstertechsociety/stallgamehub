'use client'
// One socket per page. Reconnects on its own, resyncs the clock, and exposes the latest view.
import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { Seat } from '@/games/types'
import { EVENTS, type HandshakeAuth, type Role } from '@/lib/shared/protocol'
import { getDeviceId, getTabId } from '@/lib/shared/ids'
import * as clock from './clock'

export type HubStatus = 'connecting' | 'connected' | 'reconnecting' | 'superseded'

export interface Superseded {
  seat: Seat
  reason: 'another-tab' | 'another-laptop'
}

export interface Hub<V> {
  view: V | null
  status: HubStatus
  /** True when the view on screen predates the last disconnect. */
  stale: boolean
  superseded: Superseded | null
  send: (event: string, payload: unknown, volatile?: boolean) => void
  reconnect: () => void
  serverNow: () => number
  rtt: () => number | null
}

export function useHub<V extends { seq: number }>(role: Role, seat: Seat | null = null): Hub<V> {
  const [view, setView] = useState<V | null>(null)
  const [status, setStatus] = useState<HubStatus>('connecting')
  const [stale, setStale] = useState(false)
  const [superseded, setSuperseded] = useState<Superseded | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const seqRef = useRef(-1)

  useEffect(() => {
    const auth: HandshakeAuth = { role, seat: seat ?? undefined, deviceId: getDeviceId(), tabId: getTabId() }
    const socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      tryAllTransports: true,
      reconnectionDelay: 250,
      reconnectionDelayMax: 2000,
      timeout: 5000,
      auth,
    })
    socketRef.current = socket
    const viewEvent =
      role === 'display' ? EVENTS.displayView : role === 'play' ? EVENTS.playerView : EVENTS.controlView

    clock.attach(socket)
    socket.on('connect', () => {
      seqRef.current = -1
      setStatus('connected')
      setSuperseded(null)
      clock.burst()
    })
    socket.on('disconnect', (reason) => {
      // Drop anything queued while offline: stale key events must never replay after a reconnect.
      socket.sendBuffer.length = 0
      setStale(true)
      if (reason !== 'io server disconnect') setStatus('reconnecting')
    })
    socket.on('connect_error', () => setStatus('reconnecting'))
    socket.on(viewEvent, (v: V) => {
      if (typeof v?.seq !== 'number') return
      if (v.seq < seqRef.current) return
      seqRef.current = v.seq
      setView(v)
      setStale(false)
    })
    socket.on(EVENTS.superseded, (info: Superseded) => {
      setSuperseded(info)
      setStatus('superseded')
    })
    const pingTimer = setInterval(clock.ping, 2000)

    return () => {
      clearInterval(pingTimer)
      socket.removeAllListeners()
      socket.disconnect()
      if (socketRef.current === socket) socketRef.current = null
    }
  }, [role, seat])

  const send = useCallback((event: string, payload: unknown, volatile = false) => {
    const s = socketRef.current
    if (!s || !s.connected) return
    if (volatile) s.volatile.emit(event, payload)
    else s.emit(event, payload)
  }, [])

  const reconnect = useCallback(() => {
    const s = socketRef.current
    if (!s) return
    setStatus('connecting')
    setSuperseded(null)
    s.connect()
  }, [])

  return { view, status, stale, superseded, send, reconnect, serverNow: clock.serverNow, rtt: clock.rtt }
}
