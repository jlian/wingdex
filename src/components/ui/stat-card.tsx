import { Card } from '@/components/ui/card'

interface StatCardProps {
  value: number | string
  label: string
  /** Tailwind text color class for the value, e.g. "text-primary" */
  accent?: string
  /** Optional click handler — makes the card interactive */
  onClick?: () => void
}

export function StatCard({ value, label, accent = 'text-foreground', onClick }: StatCardProps) {
  return (
    <Card
      className={`p-3 sm:p-4 space-y-0.5 text-center${onClick ? ' cursor-pointer hover:shadow-md active:scale-[0.98] transition-all' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      <div className={`text-xl sm:text-2xl font-bold font-serif ${accent}`}>
        {value}
      </div>
      <div className="text-[11px] sm:text-xs text-muted-foreground">{label}</div>
    </Card>
  )
}
