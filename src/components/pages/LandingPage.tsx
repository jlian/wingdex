import { BirdLogo } from '../ui/bird-logo'
import { MapPin } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { UploadIdentifyButton } from '../ui/upload-identify-button'
import { AppHeader, AppFooter } from '../AppChrome'
import { BatchIllustration, IdentificationIllustration, HistoryIllustration } from './LandingIllustrations'
import './landing.css'

interface LandingPageProps {
  onUpload?: () => void
  onUploadIntent?: () => void
  embedded?: boolean
}

export default function LandingPage({ onUpload, onUploadIntent, embedded = false }: LandingPageProps) {
  const heroImage = useRef<HTMLImageElement>(null)
  const [imageReady, setImageReady] = useState(false)
  useEffect(() => {
    if (heroImage.current?.complete && heroImage.current.naturalWidth > 0) setImageReady(true)
  }, [])
  const Content = embedded ? 'div' : 'main'
  const uploadAction = <UploadIdentifyButton onClick={onUpload} onIntent={onUploadIntent} />
  return (
    <div className="landing">
      {!embedded && <AppHeader>
        <nav aria-label="Main navigation" className="flex gap-1 text-sm font-medium text-muted-foreground">
          <a href="/#wingdex" className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2"><BirdLogo size={18} />WingDex</a>
          <a href="/#outings" className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2"><MapPin size={18} />Outings</a>
        </nav>
        <div className="h-8 w-8" />
      </AppHeader>}
      <Content>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <h1>Bird photos in.<br /><em>Life list out.</em></h1>
            <p className="landing-lede">Start with a day's photos or a backlog of birding trips. WingDex helps you identify the birds, group them into outings, and keep a record of what you saw.</p>
            {uploadAction}
            <noscript><p>Enable JavaScript to identify photos on your device.</p></noscript>
          </div>
          <div className="landing-hero-art" data-reveal={imageReady && embedded ? 'ready' : undefined}>
            <img src="/landing/jay.webp" ref={heroImage} onLoad={() => setImageReady(true)} className="landing-bird-photo" width="1000" height="1100" alt="A Steller's Jay perched among green leaves" fetchPriority="high" />
            <div className="landing-photo-label"><span>Example identification</span><strong>Steller's Jay</strong><em>Cyanocitta stelleri</em></div>
            <div className="landing-field-note"><BirdLogo size={24} duotone /><span>Free. No account needed.</span></div>
          </div>
        </section>
        <section id="how-it-works" className="landing-section">
          <h2>A batch of photos.<br /><em>A record of the outing.</em></h2>
          <BatchIllustration />
          <div className="landing-steps">
            {[
              ['01', 'Select a batch.', 'Add photos together instead of identifying them one at a time. Capture dates and locations help WingDex organize outings and suggest place names.'],
              ['02', 'Review each bird.', 'Choose from suggested species, compare reference photos and alternative matches, and correct the identification before saving. You make the final call.'],
              ['03', 'Keep the details.', 'Save the species with its outing, date, count, and notes. Each sighting becomes part of your searchable birding history.'],
            ].map(([number, title, copy]) => (
              <article key={number}><span className="landing-step-number">{number}</span><h3>{title}</h3><p>{copy}</p></article>
            ))}
          </div>
        </section>
        <section className="landing-section landing-identification">
          <div>
            <h2>Bird identification<br /><em>you can review.</em></h2>
            <p>WingDex's on-device model recognizes more than 10,000 bird species. Confidence scores, reference photos, and range and season indicators help you assess each suggestion.</p>
          </div>
          <IdentificationIllustration />
        </section>
        <section className="landing-showcase landing-section">
          <div>
            <h2>A life list with<br /><em>the sightings behind it.</em></h2>
            <p>Open an outing to see the birds you found, or choose a species to revisit when and where you saw it. Your life list and outing history stay connected.</p>
          </div>
          <HistoryIllustration />
        </section>
        <section className="landing-privacy">
          <h2>Your photos.<br /><em>On your device. Always.</em></h2>
          <p>Your photos are never uploaded to WingDex for identification. Bird ID runs entirely on your device.</p>
          <p>Reference images, place lookup, and account syncing may still need an internet connection.</p>
          <a href="/privacy.html" className="landing-text-link">Privacy policy <span aria-hidden="true">↗</span></a>
        </section>
        <section className="landing-section landing-records">
          <h2>Keep your eBird records<br /><em>in the picture.</em></h2>
          <p>Import an eBird CSV to bring existing sightings into WingDex, or export your records in an eBird-compatible format.</p>
        </section>
        <section className="landing-section landing-ios">
          <div><h2>Your bird photos,<br /><em>on your iPhone.</em></h2><p>Choose a batch from your library or send it to WingDex from Photos. Review identifications, save outings, and build your life list in the free app.</p></div>
          <div className="landing-final-actions"><a className="landing-app-store" href="https://apps.apple.com/app/id6760330119"><img src="/landing/download-on-the-app-store.svg" width="144" height="48" alt="Download on the App Store" /></a></div>
        </section>
      </Content>
      {!embedded && <AppFooter />}
    </div>
  )
}
