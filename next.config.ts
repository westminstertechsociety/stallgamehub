import type { NextConfig } from 'next'

// Everything here is safe offline: no image optimisation service, no telemetry, no remote patterns.
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Dev only: lets the player laptops load the dev bundle and HMR socket from the host's LAN IP.
  // Production ignores this.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*', '*.local'],
  images: { unoptimized: true },
}

export default config
