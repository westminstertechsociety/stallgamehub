import type { Metadata, Viewport } from 'next'
import { jersey, momo } from './fonts'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'Tech Society game hub',
  description: 'Offline game hub for the Tech Society stall.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jersey.variable} ${momo.variable}`}>
      <body>{children}</body>
    </html>
  )
}
