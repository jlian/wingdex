import { useState, useRef, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { searchSpecies, type TaxonEntry } from '@/lib/taxonomy'
import { cn } from '@/lib/utils'

interface SpeciesAutocompleteProps {
  value: string
  onChange: (value: string) => void
  /** Called when user selects a species from the dropdown */
  onSelect?: (entry: TaxonEntry) => void
  /** Called on Enter key when there are no results or user wants to submit */
  onSubmit?: () => void
  placeholder?: string
  id?: string
  className?: string
  autoFocus?: boolean
}

export function SpeciesAutocomplete({
  value,
  onChange,
  onSelect,
  onSubmit,
  placeholder = 'e.g. Northern Cardinal',
  id,
  className,
  autoFocus,
}: SpeciesAutocompleteProps) {
  const [results, setResults] = useState<TaxonEntry[]>([])
  const [open, setOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Debounced search
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const doSearch = useCallback((q: string) => {
    clearTimeout(searchTimeoutRef.current)
    if (!q.trim()) {
      setResults([])
      setOpen(false)
      return
    }
    searchTimeoutRef.current = setTimeout(() => {
      const hits = searchSpecies(q, 8)
      setResults(hits)
      setOpen(hits.length > 0)
      setHighlightIndex(-1)
    }, 80)
  }, [])

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightIndex] as HTMLElement
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex])

  const selectEntry = (entry: TaxonEntry) => {
    onChange(entry.common)
    onSelect?.(entry)
    setOpen(false)
    setResults([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) {
      if (e.key === 'Enter') onSubmit?.()
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightIndex(i => (i + 1) % results.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightIndex(i => (i <= 0 ? results.length - 1 : i - 1))
        break
      case 'Enter':
        e.preventDefault()
        if (highlightIndex >= 0 && highlightIndex < results.length) {
          selectEntry(results[highlightIndex])
        } else if (results.length === 1) {
          selectEntry(results[0])
        } else {
          onSubmit?.()
        }
        break
      case 'Escape':
        setOpen(false)
        break
    }
  }

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        onChange={e => {
          onChange(e.target.value)
          doSearch(e.target.value)
        }}
        onFocus={() => {
          if (value.trim() && results.length > 0) setOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />
      {open && results.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 top-full left-0 right-0 mt-1 max-h-60 overflow-auto rounded-md border bg-popover shadow-md"
          role="listbox"
        >
          {results.map((entry, i) => (
            <li
              key={entry.scientific}
              role="option"
              aria-selected={i === highlightIndex}
              className={cn(
                'px-3 py-2 cursor-pointer text-sm transition-colors',
                i === highlightIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              )}
              onMouseDown={e => {
                e.preventDefault() // keep focus on input
                selectEntry(entry)
              }}
            >
              <div className="font-medium">{entry.common}</div>
              <div className="text-xs text-muted-foreground italic">
                {entry.scientific}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
