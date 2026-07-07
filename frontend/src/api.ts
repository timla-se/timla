import type { AvailabilityDocument, ExceptionInterval, Org, Rules, Shift, Staff } from './types'

const ORG_KEY = 'timla.org'

export function getOrgId(): string | null {
  return localStorage.getItem(ORG_KEY)
}

export function setOrgId(id: string): void {
  localStorage.setItem(ORG_KEY, id)
}

export function clearOrgId(): void {
  localStorage.removeItem(ORG_KEY)
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  // Interim until auth (#3): the org id lives in localStorage and rides
  // along as X-Timla-Org, mirroring the backend's interim in api_utils.
  const org = getOrgId()
  if (org) headers['X-Timla-Org'] = org
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const resp = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (resp.status === 204) return undefined as T
  const data: unknown = await resp.json().catch(() => null)
  if (!resp.ok) {
    const err = (data ?? {}) as { error?: string; message?: string }
    throw new ApiError(resp.status, err.error ?? 'unknown', err.message ?? `HTTP ${resp.status}`)
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
  exception: { on_date: string; start_minute?: number; end_minute?: number },
) => request<ExceptionInterval>('POST', `/data/availability/${staffId}/exceptions`, exception)

export const deleteException = (staffId: string, exceptionId: string) =>
  request<void>('DELETE', `/data/availability/${staffId}/exceptions/${exceptionId}`)

export const getRules = () => request<Rules>('GET', '/data/rules')

export const getOrg = () => request<Org>('GET', '/data/org')

/** period: ISO week like '2026-W28' */
export const listShifts = (period: string) =>
  request<Shift[]>('GET', `/data/shifts?period=${encodeURIComponent(period)}`)
