import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Extract common name from "Northern Cardinal (Cardinalis cardinalis)" */
export function getDisplayName(speciesName: string): string {
  return speciesName.split('(')[0].trim()
}

/** Extract scientific name from "Northern Cardinal (Cardinalis cardinalis)" */
export function getScientificName(speciesName: string): string | undefined {
  return speciesName.match(/\(([^)]+)\)/)?.[1]
}
