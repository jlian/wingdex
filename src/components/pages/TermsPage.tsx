import { Card } from '@/components/ui/card'

export default function TermsPage() {
  return (
    <div className="px-4 sm:px-6 py-6 space-y-6 max-w-3xl mx-auto animate-fade-in">
      <div className="space-y-2">
        <h2 className="font-serif text-2xl font-semibold text-foreground">Terms of Use</h2>
        <p className="text-sm text-muted-foreground">Last updated: February 2026</p>
      </div>

      <Card className="p-4 space-y-4 text-sm text-muted-foreground leading-relaxed">
        <section className="space-y-1">
          <h3 className="font-semibold text-foreground">1. Using WingDex</h3>
          <p>WingDex is for personal birding and educational use. You agree to use it lawfully and not attempt unauthorized access, abuse, or disruption of the service.</p>
        </section>

        <section className="space-y-1">
          <h3 className="font-semibold text-foreground">2. Accounts</h3>
          <p>You are responsible for activity on devices and credentials you control. Keep your authentication methods secure.</p>
        </section>

        <section className="space-y-1">
          <h3 className="font-semibold text-foreground">3. Content</h3>
          <p>You keep ownership of the data you provide. You permit WingDex to process it only to operate app features.</p>
        </section>

        <section className="space-y-1">
          <h3 className="font-semibold text-foreground">4. Availability</h3>
          <p>WingDex may change or discontinue features over time. The service is provided as-is without guarantees.</p>
        </section>

        <section className="space-y-1">
          <h3 className="font-semibold text-foreground">5. Contact</h3>
          <p>Questions can be submitted through the project issue tracker on GitHub.</p>
        </section>
      </Card>
    </div>
  )
}
