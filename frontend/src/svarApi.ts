import { ApiError } from './api'
import type { SvarContext, SvarPutBody } from './types'

/** Anonymous, token-scoped calls for the login-free /svar surface (issue #13).
 * Plain fetch — no Clerk bearer, no auth header. The token in the path is the
 * whole credential. Reuses api.ts's ApiError shape. */
async function svarRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const resp = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data: unknown = await resp.json().catch(() => null)
  if (!resp.ok) {
    const err = (data ?? {}) as { error?: string; message?: string }
    throw new ApiError(resp.status, err.error ?? 'unknown', err.message ?? `HTTP ${resp.status}`)
  }
  return data as T
}

export const getSvarContext = (token: string) =>
  svarRequest<SvarContext>('GET', `/svar/${encodeURIComponent(token)}/data`)

export const putSvarAvailability = (token: string, body: SvarPutBody) =>
  svarRequest<SvarContext>('PUT', `/svar/${encodeURIComponent(token)}/availability`, body)
