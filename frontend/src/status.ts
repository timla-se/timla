/** Fixed status color roles (design system section 02/05). A color means
 * the same thing everywhere — badges today, time slots/booking blocks in
 * the schedule views (#8/#9). Tegel and skog are status-only, never
 * decorative.
 *
 * The @swedev/ui semantics resolve to the Timla scales via the token
 * overrides in index.css: success→skog, warning→ockra, error→tegel,
 * neutral→lera-grå. */

export type StatusRole = 'ok' | 'wait' | 'stop' | 'inactive'

export const STATUS = {
  /** Bekräftad, ledig — skog */
  ok: { semantic: 'success', token: 'var(--ok)' },
  /** Väntar, obekräftad — ockra */
  wait: { semantic: 'warning', token: 'var(--wait)' },
  /** Avbokad, konflikt — tegel */
  stop: { semantic: 'error', token: 'var(--stop)' },
  /** Fullbokad, inaktiv, arkiverad — lera-grå */
  inactive: { semantic: 'neutral', token: 'var(--muted)' },
} as const satisfies Record<StatusRole, { semantic: string; token: string }>

/** Props for a @swedev/ui Badge carrying a status role. */
export function statusBadgeProps(role: StatusRole): { semantic: (typeof STATUS)[StatusRole]['semantic'] } {
  return { semantic: STATUS[role].semantic }
}
