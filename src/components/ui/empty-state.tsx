import type { Icon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: Icon
  title: string
  description?: string
  children?: ReactNode
}

export function EmptyState({ icon: IconComponent, title, description, children }: EmptyStateProps) {
  return (
    <div className="px-4 sm:px-6 py-16 text-center space-y-3 max-w-3xl mx-auto">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <IconComponent size={32} className="text-primary" weight="duotone" />
        </div>
      </div>
      <p className="text-lg text-muted-foreground">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {children}
    </div>
  )
}
