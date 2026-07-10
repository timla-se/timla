import type {
  AvailabilityDocument, ConflictItem, ConflictResult, ExceptionInterval, Org,
  Publication, Rules, Shift, ShiftWriteResult, Staff,
} from './types'

// Registered once by main.tsx's ClerkBridge; every request awaits this for
// the current session token (Clerk auto-refreshes the short-lived JWT).
let getToken: () => Promise<string | null> = async () => null

export function setTokenGetter(fn: () => Promise<string | null>): void {
  getToken = fn
}

export class ApiError extends Error {
  status: number
  code: string
  /** A 409 from /data/shifts carries the conflict list here (issue #5);
   * empty for errors that don't ({conflicts: [], warnings: []}). */
  conflicts: ConflictItem[]
  warnings: ConflictItem[]

  constructor(
    status: number, code: string, message: string,
    conflicts: ConflictItem[] = [], warnings: ConflictItem[] = [],
  ) {
    super(message)
    this.status = status
    this.code = code
    this.conflicts = conflicts
    this.warnings = warnings
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = await getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const resp = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (resp.status === 204) return undefined as T
  const data: unknown = await resp.json().catch(() => null)
  if (!resp.ok) {
    const err = (data ?? {}) as {
      error?: string; message?: string
      conflicts?: ConflictItem[]; warnings?: ConflictItem[]
    }
    throw new ApiError(
      resp.status, err.error ?? 'unknown', err.message ?? `HTTP ${resp.status}`,
      err.conflicts ?? [], err.warnings ?? [],
    )
  }
  return data as T
}

export interface StaffPayload {
  name?: string
  phone?: string | null
  email?: string | null
  role?: string | null
  max_hours_per_week?: number | null
  archived?: boolean
  desired_shifts_per_week?: number | null
  availability_note?: string | null
}

export const listStaff = (includeArchived = false) =>
  request<Staff[]>('GET', `/data/staff${includeArchived ? '?include_archived=1' : ''}`)

export const createStaff = (payload: StaffPayload) =>
  request<Staff>('POST', '/data/staff', payload)

export const updateStaff = (id: string, payload: StaffPayload) =>
  request<Staff>('PATCH', `/data/staff/${id}`, payload)

export const archiveStaff = (id: string) =>
  request<void>('DELETE', `/data/staff/${id}`)

export const regenerateLink = (id: string) =>
  request<Staff>('POST', `/action/staff/${id}/regenerate-link`)

export const getAvailability = (staffId: string) =>
  request<AvailabilityDocument>('GET', `/data/availability/${staffId}`)

export const putAvailability = (
  staffId: string,
  doc: { wishes: { weekday: number; start_minute: number; end_minute: number }[]
         blocks: { weekday: number; start_minute: number; end_minute: number }[] },
) => request<AvailabilityDocument>('PUT', `/data/availability/${staffId}`, doc)

export const addException = (
  staffId: string,
  exception: {
    on_date: string
    start_minute?: number
    end_minute?: number
    kind?: 'wish' | 'block'
    note?: string
  },
) => request<ExceptionInterval>('POST', `/data/availability/${staffId}/exceptions`, exception)

export const deleteException = (staffId: string, exceptionId: string) =>
  request<void>('DELETE', `/data/availability/${staffId}/exceptions/${exceptionId}`)

export const getRules = () => request<Rules>('GET', '/data/rules')

export const getOrg = () => request<Org>('GET', '/data/org')

export const createOrg = (payload: { name: string; timezone?: string }) =>
  request<Org>('POST', '/data/org', payload)

/** period: ISO week like '2026-W28' */
export const listShifts = (period: string) =>
  request<Shift[]>('GET', `/data/shifts?period=${encodeURIComponent(period)}`)

export interface ShiftPayload {
  staff_id?: string | null
  starts_at?: string
  ends_at?: string
  note?: string | null
}

/** A hard-conflict 409 keeps its conflict list on the thrown ApiError; pass
 * force to override once the manager has seen and accepted it (issue #5). */
export const createShift = (payload: ShiftPayload, force = false) =>
  request<ShiftWriteResult>('POST', `/data/shifts${force ? '?force=true' : ''}`, payload)

export const updateShift = (id: string, payload: ShiftPayload, force = false) =>
  request<ShiftWriteResult>('PATCH', `/data/shifts/${id}${force ? '?force=true' : ''}`, payload)

export const deleteShift = (id: string) =>
  request<void>('DELETE', `/data/shifts/${id}`)

/** Pure live check. Pass the edited shift's own `id` so the engine excludes
 * its saved copy from double-booking/hours math. */
export const computeConflicts = (
  shifts: { id?: string; staff_id?: string | null; starts_at: string; ends_at: string }[],
) => request<ConflictResult>('POST', '/compute/conflicts', { shifts })

/** null when the week is unpublished. */
export const getPublication = (period: string) =>
  request<Publication | null>('GET', `/data/publications?period=${encodeURIComponent(period)}`)
