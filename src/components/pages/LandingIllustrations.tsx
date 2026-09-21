import { useEffect, useRef, useState } from 'react'
import { CalendarBlank, CheckCircle, MapPin, ArrowLeft, CaretRight } from '@phosphor-icons/react'

const examples = [
  { place: 'Union Bay', date: 'May 4', photos: [
    ['mallard', 'Mallard'],
    ['scaup', 'Lesser Scaup'],
    ['goldfinch', 'American Goldfinch'],
  ] },
  { place: 'Carkeek Park', date: 'Jul 12', photos: [
    ['heron', 'Great Blue Heron'],
    ['woodpecker', 'Hairy Woodpecker'],
  ] },
]

function useDemoReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  return ready
}

function ExamplePhoto({ name, alt, className }: { name: string; alt: string; className?: string }) {
  return <img className={className} src={`/landing/${name}.webp`} width="480" height="480" alt={alt} loading="lazy" />
}

export function BatchIllustration() {
  const [selected, setSelected] = useState(0)
  const ready = useDemoReady()
  return (
    <figure className="landing-diagram landing-batch" aria-label="Example photos grouped by outing">
      <div className="landing-batch-photos">
        {examples.flatMap((outing, index) => outing.photos.map(([photo, bird]) => (
          <div key={photo} data-selected={selected === index}>
            <ExamplePhoto name={photo} alt={bird} />
          </div>
        )))}
      </div>
      <div className="landing-outing-groups" role="group" aria-label="Explore example outings">
        {examples.map((outing, index) => (
          <button type="button" key={outing.place} disabled={!ready} aria-pressed={selected === index} onClick={() => setSelected(index)}>
            <MapPin size={20} aria-hidden="true" />
            <span><strong>{outing.place}</strong><small>{outing.date} · {outing.photos.length} photos</small></span>
          </button>
        ))}
      </div>
    </figure>
  )
}

export function IdentificationIllustration() {
  const [confirmed, setConfirmed] = useState(false)
  const ready = useDemoReady()
  return (
    <figure className="landing-diagram landing-identification-note" aria-label="Interactive example identification, not a live result">
      <div className="landing-comparison">
        <div><ExamplePhoto name="heron-reference" alt="Great Blue Heron photographed at Drayton Harbor" /><span>Your photo</span></div>
        <div><ExamplePhoto name="heron" alt="Great Blue Heron photographed at Carkeek Park for comparison" /><span>Reference</span></div>
      </div>
      <div className="landing-id-result">
        <div className="landing-id-heading"><div><strong>Great Blue Heron</strong><em>Ardea herodias</em></div><span className="text-green-700 dark:text-green-400">98%</span></div>
        <div className="landing-confidence" role="meter" aria-label="Example identification confidence" aria-valuenow={98} aria-valuemin={0} aria-valuemax={100}><span className="bg-green-500" /></div>
        <p className="landing-demo-status" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />{confirmed ? 'Confirmed in this example' : 'Suggested match, ready for review'}</p>
        <button type="button" className="landing-demo-action" disabled={!ready} onClick={() => setConfirmed(!confirmed)}>{confirmed ? 'Reset example' : 'Confirm example ID'}</button>
      </div>
    </figure>
  )
}

export function HistoryIllustration() {
  const [view, setView] = useState<'outing' | 'species'>('outing')
  const content = useRef<HTMLDivElement>(null)
  const ready = useDemoReady()
  const navigate = (next: 'outing' | 'species') => {
    setView(next)
    content.current?.focus()
  }
  return (
    <figure className="landing-diagram landing-history" aria-label="Explore an example outing and its species history">
      <div ref={content} className="landing-history-content" tabIndex={-1} role="group" aria-label="Example outing and species history" aria-live="polite">
        {view === 'outing' ? <>
          <div className="landing-history-title"><MapPin size={20} aria-hidden="true" /><strong>Carkeek Park</strong></div>
          <p className="landing-demo-meta">Jul 12 · 2 species · 3 birds</p>
          <button type="button" className="landing-bird-record" disabled={!ready} onClick={() => navigate('species')}>
            <ExamplePhoto name="heron" alt="" /><span><strong>Great Blue Heron</strong><em>Ardea herodias</em><small>2 seen · View sighting history</small></span><CaretRight size={16} aria-hidden="true" />
          </button>
          <div className="landing-bird-record"><ExamplePhoto name="woodpecker" alt="" /><span><strong>Hairy Woodpecker</strong><em>Dryobates villosus</em><small>1 seen</small></span></div>
        </> : <>
          <button type="button" className="landing-demo-back" onClick={() => navigate('outing')}><ArrowLeft size={16} aria-hidden="true" />Back to outing</button>
          <div className="landing-history-title"><ExamplePhoto name="heron-reference" alt="" /><div><strong>Great Blue Heron</strong><em>Ardea herodias</em></div></div>
          <p className="landing-demo-meta">3 seen · 2 outings · First May 4</p>
          <div className="landing-sighting-record"><CalendarBlank size={18} aria-hidden="true" /><span><strong>Drayton Harbor</strong><small>May 4 · 1 seen · Confirmed</small></span></div>
          <button type="button" className="landing-sighting-record" onClick={() => navigate('outing')}><CalendarBlank size={18} aria-hidden="true" /><span><strong>Carkeek Park</strong><small>Jul 12 · 2 seen · Confirmed</small></span><CaretRight size={16} aria-hidden="true" /></button>
        </>}
      </div>
    </figure>
  )
}
