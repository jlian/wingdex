import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  MapPin, CalendarBlank, Camera, ArrowLeft, Download,
  Trash, PencilSimple, Check, Plus, X, Bird
} from '@phosphor-icons/react'
import { useBirdImage } from '@/hooks/use-bird-image'
import { exportOutingToEBirdCSV } from '@/lib/ebird'
import { toast } from 'sonner'
import type { useBirdDexData } from '@/hooks/use-birddex-data'
import type { Outing, Observation } from '@/lib/types'

interface OutingsPageProps {
  data: ReturnType<typeof useBirdDexData>
  selectedOutingId: string | null
  onSelectOuting: (id: string | null) => void
}

export default function OutingsPage({ data, selectedOutingId, onSelectOuting }: OutingsPageProps) {
  const { outings } = data

  if (outings.length === 0) {
    return (
      <div className="px-4 sm:px-6 py-16 text-center space-y-3">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Bird size={32} className="text-primary" weight="duotone" />
          </div>
        </div>
        <p className="text-lg text-muted-foreground">No outings yet</p>
        <p className="text-sm text-muted-foreground">
          Upload photos to create your first outing
        </p>
      </div>
    )
  }

  if (selectedOutingId) {
    const outing = outings.find(o => o.id === selectedOutingId)
    if (!outing) {
      onSelectOuting(null)
      return null
    }
    return (
      <OutingDetail
        outing={outing}
        data={data}
        onBack={() => onSelectOuting(null)}
      />
    )
  }

  return (
    <div className="px-4 sm:px-6 py-6 space-y-5">
      <div className="space-y-1">
        <h2 className="font-serif text-2xl font-semibold text-foreground">
          Your Outings
        </h2>
        <p className="text-sm text-muted-foreground">
          {outings.length} {outings.length === 1 ? 'outing' : 'outings'} recorded
        </p>
      </div>
      
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {outings.map(outing => {
          const observations = data.getOutingObservations(outing.id)
          const photos = data.getOutingPhotos(outing.id)
          const confirmed = observations.filter(obs => obs.certainty === 'confirmed')

          return (
            <OutingCard
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

// ─── Outing Card (list view) ──────────────────────────────

function OutingCard({
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
    <Card
      className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer active:scale-[0.99]"
      onClick={onClick}
    >
      {heroSrc && (
        <div className="h-32 bg-muted overflow-hidden">
          <img
            src={heroSrc}
            alt={firstSpecies || 'Outing'}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      )}

      <div className="p-4 space-y-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarBlank size={16} />
            {new Date(outing.startTime).toLocaleDateString()} at{' '}
            {new Date(outing.startTime).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
          {outing.locationName && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin size={16} weight="fill" className="text-primary" />
              {outing.locationName}
            </div>
          )}
          {photos.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Camera size={16} />
              {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {confirmed.map((obs) => (
            <Badge key={obs.id} variant="secondary">
              {obs.speciesName.split('(')[0].trim()}
              {obs.count > 1 && ` (×${obs.count})`}
            </Badge>
          ))}
        </div>

        {outing.notes && (
          <p className="text-sm text-muted-foreground italic line-clamp-2">
            {outing.notes}
          </p>
        )}
      </div>
    </Card>
  )
}

// ─── Outing Detail View ───────────────────────────────────

function OutingDetail({
  outing,
  data,
  onBack,
}: {
  outing: Outing
  data: ReturnType<typeof useBirdDexData>
  onBack: () => void
}) {
  const observations = data.getOutingObservations(outing.id)
  const confirmed = observations.filter(obs => obs.certainty === 'confirmed')
  const possible = observations.filter(obs => obs.certainty === 'possible')
  const [editingNotes, setEditingNotes] = useState(false)
  const [notes, setNotes] = useState(outing.notes || '')
  const [addingSpecies, setAddingSpecies] = useState(false)
  const [newSpeciesName, setNewSpeciesName] = useState('')
  const [newSpeciesCount, setNewSpeciesCount] = useState(1)

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
    if (confirm('Delete this outing and all its observations?')) {
      data.deleteOuting(outing.id)
      toast.success('Outing deleted')
      onBack()
    }
  }

  const handleSaveNotes = () => {
    data.updateOuting(outing.id, { notes })
    setEditingNotes(false)
    toast.success('Notes saved')
  }

  const handleDeleteObservation = (obsId: string, speciesName: string) => {
    if (confirm(`Remove ${speciesName.split('(')[0].trim()} from this outing?`)) {
      data.updateObservation(obsId, { certainty: 'rejected' })
      toast.success('Observation removed')
    }
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
    data.updateLifeList(outing.id, [obs])
    setNewSpeciesName('')
    setNewSpeciesCount(1)
    setAddingSpecies(false)
    toast.success(`${newSpeciesName.split('(')[0].trim()} added`)
  }

  return (
    <div className="px-4 sm:px-6 py-6 space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={20} />
        </Button>
        <div className="flex-1">
          <h2 className="font-serif text-xl font-semibold text-foreground">
            {outing.locationName || 'Outing'}
          </h2>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarBlank size={14} />
            {new Date(outing.startTime).toLocaleDateString()} at{' '}
            {new Date(outing.startTime).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        </div>
      </div>

      {/* Location */}
      {outing.lat && outing.lon && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin size={16} weight="fill" className="text-primary" />
          {outing.locationName}
          <span className="text-xs">
            ({outing.lat.toFixed(4)}°, {outing.lon.toFixed(4)}°)
          </span>
        </div>
      )}

      {/* Species list */}
      <div className="space-y-2">
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
              <Input
                id="species-name"
                placeholder="e.g. Northern Cardinal"
                value={newSpeciesName}
                onChange={e => setNewSpeciesName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddSpecies()}
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
          <div className="space-y-2">
            {confirmed.map(obs => (
              <ObservationRow
                key={obs.id}
                obs={obs}
                onDelete={() => handleDeleteObservation(obs.id, obs.speciesName)}
              />
            ))}
          </div>
        )}

        {/* Possible species */}
        {possible.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider pt-2">
              Possible
            </p>
            {possible.map(obs => (
              <ObservationRow
                key={obs.id}
                obs={obs}
                onDelete={() => handleDeleteObservation(obs.id, obs.speciesName)}
              />
            ))}
          </>
        )}

        {confirmed.length === 0 && possible.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No species recorded yet
          </p>
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
      <div className="flex gap-2 pt-2">
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
    </div>
  )
}

// ─── Observation Row with Wikimedia image ─────────────────

function ObservationRow({
  obs,
  onDelete,
}: {
  obs: Observation
  onDelete: () => void
}) {
  const displayName = obs.speciesName.split('(')[0].trim()
  const scientificName = obs.speciesName.match(/\(([^)]+)\)/)?.[1]
  const wikiImage = useBirdImage(obs.speciesName)

  return (
    <Card className="flex items-center gap-3 p-3">
      {wikiImage ? (
        <img
          src={wikiImage}
          alt={displayName}
          className="w-12 h-12 rounded object-cover bg-muted flex-shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-12 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
          <Bird size={20} className="text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-serif font-semibold text-sm text-foreground truncate">
          {displayName}
        </p>
        {scientificName && (
          <p className="text-xs text-muted-foreground italic truncate">{scientificName}</p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {obs.count > 1 && <span>×{obs.count}</span>}
          {obs.certainty === 'possible' && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">possible</Badge>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive flex-shrink-0"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
      >
        <Trash size={14} />
      </Button>
    </Card>
  )
}
