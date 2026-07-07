/** Initials avatar per the Personal design: warm palette rotated
 * deterministically per person so a given medarbetare always keeps their
 * color. Ink gets honey text, ochre gets ink — the design's pairings. */

const PALETTE: { bg: string; fg: string }[] = [
  { bg: '#e69a2e', fg: '#231d16' },
  { bg: '#4f7358', fg: '#ffffff' },
  { bg: '#c05a3a', fg: '#ffffff' },
  { bg: '#7a6a52', fg: '#ffffff' },
  { bg: '#231d16', fg: '#f2c14e' },
  { bg: '#b98a2e', fg: '#ffffff' },
]

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '')
  return (first + last).toUpperCase()
}

function hash(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

export function Avatar({ id, name, size = 38, muted = false }: {
  id: string
  name: string
  size?: number
  muted?: boolean
}) {
  const { bg, fg } = muted
    ? { bg: '#c2b291', fg: '#ffffff' }
    : PALETTE[hash(id) % PALETTE.length] ?? { bg: '#e69a2e', fg: '#231d16' }
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-extrabold"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.34, letterSpacing: '.02em' }}
    >
      {initials(name)}
    </div>
  )
}
