'use client'
import { useEffect, useState } from 'react'

interface Info {
  port: number
  ips: string[]
  games: string[]
}

export default function Landing() {
  const [info, setInfo] = useState<Info | null>(null)
  useEffect(() => {
    fetch('/api/info')
      .then((r) => r.json() as Promise<Info>)
      .then(setInfo)
      .catch(() => setInfo(null))
  }, [])
  const host = info?.ips[0] ? `http://${info.ips[0]}:${info.port}` : ''
  return (
    <main className="landing">
      <h1>Tech Society game hub</h1>
      <p>Three screens, one host. Open each on the right machine.</p>
      <ul>
        <li>
          <strong>Projector</strong> on this laptop: <a href="/display">/display</a>
        </li>
        <li>
          <strong>Player 1 laptop</strong>: <code>{host}/play?seat=P1</code>
        </li>
        <li>
          <strong>Player 2 laptop</strong>: <code>{host}/play?seat=P2</code>
        </li>
        <li>
          <strong>Your phone</strong>: <code>{host}/control</code>
        </li>
      </ul>
      {info && info.ips.length > 1 && (
        <p className="play-hint">This machine has several addresses: {info.ips.join(', ')}. Use the one on the stall Wi-Fi.</p>
      )}
      {!info && <p className="play-hint">Waiting for the host server.</p>}
    </main>
  )
}
