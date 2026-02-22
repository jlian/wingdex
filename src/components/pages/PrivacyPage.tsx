import { Card } from '@/components/ui/card'

export default function PrivacyPage() {
  return (
    <div className="px-4 sm:px-6 py-6 space-y-6 max-w-3xl mx-auto animate-fade-in">
      <div className="space-y-2">
        <h2 className="font-serif text-2xl font-semibold text-foreground">Privacy Policy</h2>
        <p className="text-sm text-muted-foreground">Last updated: February 2026</p>
      </div>

      <Card className="p-4 space-y-4 text-sm text-muted-foreground leading-relaxed">
        <section className="space-y-1">
          <h3 className="font-semibold text-foreground">1. Data we process</h3>
          <p>WingDex stores the birding records you create, including outings and observations, to power app functionality.</p>
        </section>

        <section className="space-y-1">
          <h3 className="font-semibold text-foreground">2. Photo handling</h3>
          <p>Photos sent for identification are processed by server-side AI endpoints and are not retained beyond active processing needs.</p>
        </section>

        <section className="space-y-1">
          <h3 className="font-semibold text-foreground">3. Authentication data</h3>
          <p>Authentication data is used to keep your account secure and allow account access via passkeys or social providers.</p>
        </section>

        <section className="space-y-1">
          <h3 className="font-semibold text-foreground">4. Third-party services</h3>
          <p>WingDex may call third-party services for media, geocoding, and infrastructure. Those services may process limited request metadata.</p>
        </section>

        <section className="space-y-1">
          <h3 className="font-semibold text-foreground">5. Contact</h3>
          <p>Privacy questions can be submitted through the project issue tracker on GitHub.</p>
        </section>
      </Card>
    </div>
  )
}
