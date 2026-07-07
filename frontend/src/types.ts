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
