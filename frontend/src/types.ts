export interface Staff {
  id: string
  name: string
  phone: string | null
  email: string | null
  role: string | null
  max_hours_per_week: number | null
  share_token: string | null
  archived: boolean
  desired_shifts_per_week: number | null
  availability_note: string | null
}

export interface RecurringInterval {
  // Additive metadata the server emits (issue #40); the PUT only needs the
  // three load-bearing fields, so toRows keeps stripping to them.
  id?: string
  kind?: 'wish' | 'block'
  source?: 'staff' | 'manager' | null
  note?: string | null
  weekday: number
  start_minute: number
  end_minute: number
}

export interface ExceptionInterval {
  id: string
  on_date: string
  start_minute: number
  end_minute: number
  kind: 'wish' | 'block'
  note: string | null
  source: 'staff' | 'manager' | null
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

/** One publication overlapping the requested range (issue #10). `from`/`to`
 * are inclusive local dates; `diverged` means the live shifts no longer match
 * what staff see for this publication. */
export interface Publication {
  from: string
  to: string
  published_at: string
  diverged: boolean
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
  // Additive metadata the server emits (issue #40); the PUT only needs the
  // three load-bearing fields, so mergedRecurring keeps sending clean
  // {weekday, start_minute, end_minute} objects.
  id?: string
  kind?: 'wish' | 'block'
  source?: 'staff' | 'manager' | null
  note?: string | null
  weekday: number
  start_minute: number
  end_minute: number
}

export interface SvarException {
  id: string
  on_date: string
  start_minute: number
  end_minute: number
  kind: 'wish' | 'block'
  note: string | null
  source: 'staff' | 'manager' | null
}

export interface SvarShift {
  date: string
  starts_at: string
  ends_at: string
}

export interface SvarContext {
  staff: {
    first_name: string
    name: string
    desired_shifts_per_week: number | null
    availability_note: string | null
  }
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

/** PUT /svar/:token/availability — every key is per-key optional: an omitted
 * key leaves that layer/field untouched (issue #40). The v2 phone never sends
 * `blocks`, which is what keeps manager-set recurring blocks intact. */
export interface SvarPutBody {
  wishes?: SvarRecurring[]
  blocks?: SvarRecurring[] // v2 never sends this — omitting preserves manager blocks
  add_exceptions?: {
    on_date: string
    start_minute?: number
    end_minute?: number
    kind?: 'wish' | 'block'
    note?: string
  }[]
  remove_exception_ids?: string[]
  desired_shifts_per_week?: number | null
  availability_note?: string | null
}
