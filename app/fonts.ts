import localFont from 'next/font/local'

// Two families, both self-hosted from public/fonts (OFL):
// Jersey 10 for the big pixel type (words, headlines, names), Momo Trust Sans for everything else.
export const jersey = localFont({
  src: '../public/fonts/jersey-10-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  display: 'block',
  preload: true,
  variable: '--font-jersey',
  adjustFontFallback: false,
})

export const momo = localFont({
  src: '../public/fonts/momo-trust-sans-latin-wght-normal.woff2',
  weight: '200 800',
  style: 'normal',
  display: 'block',
  preload: true,
  variable: '--font-momo',
  adjustFontFallback: 'Arial',
})
