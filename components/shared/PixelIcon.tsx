import { PIXEL_ICONS, type PixelIconName } from './pixelIcons'

/** An inline icon from the HackerNoon pixel icon library, coloured with currentColor. */
export function PixelIcon({ name, className = '', title }: { name: PixelIconName; className?: string; title?: string }) {
  const icon = PIXEL_ICONS[name]
  return (
    <svg
      className={`picon ${className}`.trim()}
      viewBox={icon.viewBox}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      dangerouslySetInnerHTML={{ __html: icon.inner }}
    />
  )
}
