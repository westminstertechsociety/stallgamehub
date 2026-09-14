import type { Seat } from '@/games/types'

export function SeatChip({ seat, off = false, className = '' }: { seat: Seat; off?: boolean; className?: string }) {
  return <span className={`chip ${off ? 'chip-off' : `chip-${seat}`} ${className}`.trim()}>{seat}</span>
}

export function seatLabel(seat: Seat, name: string): string {
  return name || (seat === 'P1' ? 'Player 1' : 'Player 2')
}
