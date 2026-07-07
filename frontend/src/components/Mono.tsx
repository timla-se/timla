import type { ComponentProps } from 'react'

import { cn } from '@swedev/ui'

/** All exact data — time, dates, ids, prices — renders in IBM Plex Mono so
 * numbers never jump ("siffror hoppar aldrig", design system section 03). */
export function Mono({ className, ...rest }: ComponentProps<'span'>) {
  return <span className={cn('font-mono', className)} {...rest} />
}
