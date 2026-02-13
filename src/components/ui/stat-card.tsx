import { Card } from '@/components/ui/card'

interface StatCardProps {
  value: number | string
  label: string
  /** Tailwind text color class for the value, e.g. "text-primary" */
  accent?: string
}

export function StatCard({ value, label, accent = 'text-foreground' }: StatCardProps) {
  return (
    <Card className="p-3 sm:p-4 space-y-0.5 text-center">
      <div className={`text-xl sm:text-2xl font-bold font-serif ${accent}`}>
        {value}
      </div>
      <div className="text-[11px] sm:text-xs text-muted-foreground">{label}</div>
    </Card>
  )
}
