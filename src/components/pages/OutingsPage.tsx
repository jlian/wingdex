import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { SpeciesAutocomplete } from '@/components/ui/species-autocomplete'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  MapPin, CalendarBlank, ArrowLeft, Download,
  Trash, PencilSimple, Check, Plus, X, Bird, Clock
} from '@phosphor-icons/react'
import { EmptyState } from '@/components/ui/empty-state'
import { BirdRow } from '@/components/ui/bird-row'
import { StatCard } from '@/components/ui/stat-card'
import { useBirdImage } from '@/hooks/use-bird-image'
import { exportOutingToEBirdCSV } from '@/lib/ebird'
import { getDisplayName } from '@/lib/utils'
import { toast } from 'sonner'
import type { BirdDexDataStore } from '@/hooks/use-birddex-data'
import type { Outing, Observation } from '@/lib/types'

interface OutingsPageProps {
  data: BirdDexDataStore
  selectedOutingId: string | null
  onSelectOuting: (id: string | null) => void
  onSelectSpecies: (name: string) => void
}

export default function OutingsPage({ data, selectedOutingId, onSelectOuting, onSelectSpecies }: OutingsPageProps) {
  const { outings } = data

  if (outings.length === 0) {
    return (
      <EmptyState
        icon={Bird}
        title="No outings yet"
        description="Upload photos to create your first outing"
      />
    )
  }

  if (selectedOutingId) {
    const outing = outings.find(o => o.id === selectedOutingId)
    if (!outing) {
      // Don't call onSelectOuting during render — use effect or return null gracefully
      return null
    }
    return (
      <OutingDetail
        outing={outing}
        data={data}
        onBack={() => onSelectOuting(null)}
        onSelectSpecies={onSelectSpecies}
      />
    )
  }

  return (
    <div className="px-4 sm:px-6 py-6 space-y-4 max-w-3xl mx-auto">
      <div className="space-y-1">
        <h2 className="font-serif text-2xl font-semibold text-foreground">
          Your Outings
        </h2>
        <p className="text-sm text-muted-foreground">
          {outings.length} {outings.length === 1 ? 'outing' : 'outings'} recorded
        </p>
      </div>
      
      <div className="divide-y divide-border">
        {outings.map((outing, i) => {
          const observations = data.getOutingObservations(outing.id)
          const photos = data.getOutingPhotos(outing.id)
          const confirmed = observations.filter(obs => obs.certainty === 'confirmed')

          return (
            <OutingRow
              key={outing.id}
              outing={outing}
              photos={photos}
              confirmed={confirmed}
              onClick={() => onSelectOuting(outing.id)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ─── Outing Row (compact list item) ───────────────────────

function OutingRow({
  outing,
  photos,
  confirmed,
  onClick,
}: {
  outing: Outing
  photos: any[]
  confirmed: Observation[]
  onClick: () => void
}) {
  const firstSpecies = confirmed[0]?.speciesName
  const wikiImage = useBirdImage(firstSpecies)
  const heroSrc = (photos[0]?.thumbnail || wikiImage) as string | undefined

  return (
    <button
      className="flex items-center gap-3 md:gap-4 py-3 w-full text-left rounded-md hover:bg-muted/50 transition-colors cursor-pointer active:bg-muted"
      onClick={onClick}
    >
      {heroSrc ? (
        <img
          src={heroSrc}
          alt={firstSpecies || 'Outing'}
          className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-lg object-cover bg-muted flex-shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Bird size={20} className="text-muted-foreground/40" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="md:flex md:items-baseline md:gap-2">
          <p className="font-serif font-semibold text-sm text-foreground truncate">
            {outing.locationName || 'Outing'}
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(outing.startTime).toLocaleDateString()} · {confirmed.length} species
            {photos.length > 0 && ` · ${photos.length} photo${photos.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {confirmed.length > 0 && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {confirmed.slice(0, 4).map(obs => getDisplayName(obs.speciesName)).join(', ')}
            {confirmed.length > 4 && ` +${confirmed.length - 4} more`}
          </p>
        )}
      </div>
    </button>
  )
}

// ─── Outing Detail View ───────────────────────────────────

function OutingDetail({
  outing,
  data,
  onBack,
  onSelectSpecies,
}: {
  outing: Outing
  data: BirdDexDataStore
  onBack: () => void
  onSelectSpecies: (name: string) => void
}) {
  const observations = data.getOutingObservations(outing.id)
  const confirmed = observations.filter(obs => obs.certainty === 'confirmed')
  const possible = observations.filter(obs => obs.certainty === 'possible')
  const [editingNotes, setEditingNotes] = useState(false)
  const [notes, setNotes] = useState(outing.notes || '')
  const [addingSpecies, setAddingSpecies] = useState(false)
  const [newSpeciesName, setNewSpeciesName] = useState('')
  const [newSpeciesCount, setNewSpeciesCount] = useState(1)
  const [deleteOutingOpen, setDeleteOutingOpen] = useState(false)
  const [pendingDeleteObservation, setPendingDeleteObservation] = useState<{
    id: string
    speciesName: string
  } | null>(null)

  const handleExport = () => {
    const csv = exportOutingToEBirdCSV(outing, observations)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `birddex-outing-${new Date(outing.startTime).toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Outing exported as eBird CSV')
  }

  const handleDeleteOuting = () => {
    setDeleteOutingOpen(true)
  }

  const handleSaveNotes = () => {
    data.updateOuting(outing.id, { notes })
    setEditingNotes(false)
    toast.success('Notes saved')
  }

  const handleDeleteObservation = (obsId: string, speciesName: string) => {
    setPendingDeleteObservation({ id: obsId, speciesName })
  }

  const handleAddSpecies = () => {
    if (!newSpeciesName.trim()) return
    const obs: Observation = {
      id: `obs_${Date.now()}_manual`,
      outingId: outing.id,
      speciesName: newSpeciesName.trim(),
      count: newSpeciesCount,
      certainty: 'confirmed',
      notes: 'Manually added',
    }
    data.addObservations([obs])
    data.updateDex(outing.id, [obs])
    setNewSpeciesName('')
    setNewSpeciesCount(1)
    setAddingSpecies(false)
    toast.success(`${getDisplayName(newSpeciesName)} added`)
  }

  const outingDate = new Date(outing.startTime)
  const endDate = outing.endTime ? new Date(outing.endTime) : null
  const durationMs = endDate && !isNaN(endDate.getTime()) ? endDate.getTime() - outingDate.getTime() : null
  const durationStr = durationMs && durationMs > 0
    ? durationMs >= 3600000
      ? `${Math.floor(durationMs / 3600000)}h ${Math.round((durationMs % 3600000) / 60000)}m`
      : `${Math.round(durationMs / 60000)}m`
    : null

  return (
    <div className="px-4 sm:px-6 py-6 space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mt-0.5">
          <ArrowLeft size={20} />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-2xl font-semibold text-foreground">
            {outing.locationName || 'Outing'}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CalendarBlank size={14} />
              {outingDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock size={14} />
              {outingDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {durationStr && <span className="text-muted-foreground/60">({durationStr})</span>}
            </span>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard value={confirmed.length + possible.length} label="Species" accent="text-primary" />
        <StatCard value={confirmed.length} label="Confirmed" accent="text-secondary" />
        <StatCard
          value={observations.reduce((sum, o) => sum + o.count, 0)}
          label="Total Count"
          accent="text-accent"
        />
      </div>

      {/* Location */}
      {outing.lat && outing.lon && (
        <a
          href={`https://www.google.com/maps?q=${outing.lat},${outing.lon}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <MapPin size={16} weight="fill" className="text-primary flex-shrink-0" />
          <span className="truncate">{outing.locationName}</span>
          <span className="text-xs flex-shrink-0">
            ({outing.lat.toFixed(4)}°, {outing.lon.toFixed(4)}°)
          </span>
        </a>
      )}

      {/* Species list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">
            Species ({confirmed.length + possible.length})
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingSpecies(!addingSpecies)}
          >
            {addingSpecies ? <X size={14} className="mr-1" /> : <Plus size={14} className="mr-1" />}
            {addingSpecies ? 'Cancel' : 'Add Species'}
          </Button>
        </div>

        {/* Manual species entry */}
        {addingSpecies && (
          <Card className="p-3 space-y-3 border-primary/30">
            <div className="space-y-2">
              <Label htmlFor="species-name">Species Name</Label>
              <SpeciesAutocomplete
                id="species-name"
                value={newSpeciesName}
                onChange={setNewSpeciesName}
                onSubmit={handleAddSpecies}
                autoFocus
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="species-count">Count:</Label>
                <Input
                  id="species-count"
                  type="number"
                  min="1"
                  value={newSpeciesCount}
                  onChange={e => setNewSpeciesCount(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-20"
                />
              </div>
              <Button size="sm" onClick={handleAddSpecies} disabled={!newSpeciesName.trim()}>
                <Check size={14} className="mr-1" />
                Add
              </Button>
            </div>
          </Card>
        )}

        {/* Confirmed species */}
        {confirmed.length > 0 && (
          <div className="divide-y divide-border">
            {confirmed.map(obs => (
              <BirdRow
                key={obs.id}
                speciesName={obs.speciesName}
                subtitle={obs.count > 1 ? `x${obs.count}` : undefined}
                onClick={() => onSelectSpecies(obs.speciesName)}
                actions={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive flex-shrink-0 h-8 w-8 p-0"
                    onClick={(e) => { e.stopPropagation(); handleDeleteObservation(obs.id, obs.speciesName) }}
                  >
                    <Trash size={14} />
                  </Button>
                }
              />
            ))}
          </div>
        )}

        {/* Possible species */}
        {possible.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider pt-1">
              Possible
            </p>
            <div className="divide-y divide-border">
              {possible.map(obs => (
                <BirdRow
                  key={obs.id}
                  speciesName={obs.speciesName}
                  subtitle={obs.count > 1 ? `x${obs.count}` : undefined}
                  onClick={() => onSelectSpecies(obs.speciesName)}
                  actions={
                    <>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">possible</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive flex-shrink-0 h-8 w-8 p-0"
                        onClick={(e) => { e.stopPropagation(); handleDeleteObservation(obs.id, obs.speciesName) }}
                      >
                        <Trash size={14} />
                      </Button>
                    </>
                  }
                />
              ))}
            </div>
          </>
        )}

        {confirmed.length === 0 && possible.length === 0 && (
          <div className="py-8 text-center">
            <Bird size={32} className="text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No species recorded yet
            </p>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Notes</h3>
          {!editingNotes && (
            <Button variant="ghost" size="sm" onClick={() => setEditingNotes(true)}>
              <PencilSimple size={14} className="mr-1" />
              Edit
            </Button>
          )}
        </div>
        {editingNotes ? (
          <div className="space-y-2">
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add notes about this outing..."
              rows={3}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveNotes}>
                <Check size={14} className="mr-1" />
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setNotes(outing.notes || ''); setEditingNotes(false) }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            {outing.notes || 'No notes yet'}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-border">
        <Button
          variant="outline"
          className="flex-1"
          onClick={handleExport}
          disabled={confirmed.length === 0}
        >
          <Download size={16} className="mr-1" />
          Export eBird CSV
        </Button>
        <Button
          variant="outline"
          className="text-destructive hover:bg-destructive/10"
          onClick={handleDeleteOuting}
        >
          <Trash size={16} />
        </Button>
      </div>

      <AlertDialog open={deleteOutingOpen} onOpenChange={setDeleteOutingOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this outing?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this outing and all of its observations.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                data.deleteOuting(outing.id)
                toast.success('Outing deleted')
                onBack()
              }}
            >
              Delete Outing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingDeleteObservation}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteObservation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove species from outing?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteObservation
                ? `Remove ${getDisplayName(pendingDeleteObservation.speciesName)} from this outing?`
                : 'Remove this species from the outing?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!pendingDeleteObservation) return
                data.updateObservation(pendingDeleteObservation.id, { certainty: 'rejected' })
                toast.success('Observation removed')
                setPendingDeleteObservation(null)
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
