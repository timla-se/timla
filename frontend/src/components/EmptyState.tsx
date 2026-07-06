import type { ReactNode } from 'react'
import { Flex, Text } from '@radix-ui/themes'

export function EmptyState({ title, description, action }: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <Flex direction="column" align="center" gap="2" className="rounded border border-dashed border-[var(--gray-6)] py-12">
      <Text weight="medium">{title}</Text>
      {description && <Text size="2" color="gray">{description}</Text>}
      {action}
    </Flex>
  )
}
