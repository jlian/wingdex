export function getDefaultPortalContainer(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined
  return document.getElementById('app') ?? undefined
}