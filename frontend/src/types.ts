export interface Staff {
  id: string
  name: string
  phone: string | null
  email: string | null
  role: string | null
  max_hours_per_week: number | null
  share_token: string | null
  archived: boolean
}

export interface RecurringInterval {
  id?: string
  weekday: number
  start_minute: number
  end_minute: number
}

export interface ExceptionInterval {
  id: string
  on_date: string
  start_minute: number
  end_minute: number
}

export interface AvailabilityDocument {
  wishes: RecurringInterval[]
  blocks: RecurringInterval[]
  exceptions: ExceptionInterval[]
}

export interface Rules {
  max_hours_per_week: number | null
  min_rest_hours: number | null
}

export interface Org {
  id: string
  name: string
  timezone: string
}

export interface Shift {
  id: string
  staff_id: string | null
  starts_at: string
  ends_at: string
  note: string | null
}

export interface Publication {
  week: string
  published_at: string
}

/** One entry from the conflict engine (issue #5). `type` drives the Swedish
 * copy in the editor; `message` is the server's English fallback. Detail
 * fields are only present on some types (max_hours, insufficient_rest). */
export interface ConflictItem {
  type:
    | 'archived_staff'
    | 'double_booking'
    | 'blocked'
    | 'max_hours'
    | 'insufficient_rest'
    | 'outside_wishes'
  shift_index: number
  shift_id: string | null
  staff_id: string | null
  message: string
  week?: string
  total_hours?: number
  effective_max?: number
  rest_hours?: number
  min_rest_hours?: number
}

export interface ConflictResult {
  conflicts: ConflictItem[]
  warnings: ConflictItem[]
}

/** POST /data/shifts and PATCH /data/shifts/:id echo the saved shift plus the
 * conflict/warning result the engine produced for it. */
export type ShiftWriteResult = { shift: Shift } & ConflictResult

// --- staff share-link (/svar) surface (issue #13) ---

export interface SvarRecurring {
  weekday: number
  start_minute: number
  end_minute: number
}

export interface SvarException {
  id: string
  on_date: string
  start_minute: number
  end_minute: number
}

export interface SvarShift {
  date: string
  starts_at: string
  ends_at: string
}

export interface SvarContext {
  staff: { first_name: string; name: string }
  org: { name: string; initials: string; timezone: string }
  availability: {
    wishes: SvarRecurring[]
    blocks: SvarRecurring[]
    exceptions: SvarException[]
  }
  schedule: {
    from: string
    to: string
    shifts: SvarShift[]
    shift_count: number
    hours: number
  }
}

export interface SvarPutBody {
  wishes: SvarRecurring[]
  blocks: SvarRecurring[]
  add_exceptions: { on_date: string; start_minute: number; end_minute: number }[]
  remove_exception_ids: string[]
}
