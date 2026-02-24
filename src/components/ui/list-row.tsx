import { cn } from '@/lib/utils'

interface ListRowProps {
  /** Left-side content (icon or thumbnail) */
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
  /** Optional right-side actions rendered inside the bordered content area */
  actions?: React.ReactNode
  /** Extra classes on the outer row (e.g. highlight ring) */
  className?: string
}

export function ListRow({ icon, onClick, children, actions, className }: ListRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'flex items-stretch gap-3 -mx-4 px-4 sm:-mx-6 sm:px-6 -mt-px press-feel-subtle cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      onClick={(event) => {
        // Ignore clicks on nested interactive elements (e.g. action buttons)
        if ((event.target as HTMLElement).closest('button, a, [role="button"]') !== event.currentTarget) return
        onClick()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          if ((event.target as HTMLElement).closest('button, a, [role="button"]') !== event.currentTarget) return
          event.preventDefault()
          onClick()
        }
      }}
    >
      <div className="flex-shrink-0 flex items-center">
        {icon}
      </div>
      <div className="flex items-center flex-1 min-w-0 gap-2 border-b border-[var(--pressed-highlight-hover)] py-3">
        <div className="flex-1 min-w-0 text-left">
          {children}
        </div>
        {actions}
      </div>
    </div>
  )
}
