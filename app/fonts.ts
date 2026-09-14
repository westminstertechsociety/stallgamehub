import localFont from 'next/font/local'

// One family, one file: Archivo variable with weight 100–900 and width 62–125%.
// font-stretch must be declared or browsers clamp the width axis to 100%.
export const archivo = localFont({
  src: '../public/fonts/archivo-latin-wdth-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'block',
  preload: true,
  variable: '--font-archivo',
  declarations: [{ prop: 'font-stretch', value: '62% 125%' }],
  adjustFontFallback: 'Arial',
})
