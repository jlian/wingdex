import type { ReactNode } from 'react'

export default function LegalPageLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="px-4 sm:px-6 py-6 space-y-6 max-w-3xl mx-auto">
      <div className="space-y-2">
        <h2 className="font-serif text-2xl font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">Last updated: {updated}</p>
      </div>
      <article className="space-y-6 text-sm text-muted-foreground leading-relaxed">
        {children}
      </article>
    </div>
  )
}
