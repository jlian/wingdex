/** Dev-only debug logger. Tree-shaken to zero in production builds. */
export function debug(tag: string, ...args: unknown[]): void {
  if (import.meta.env.DEV) {
    console.debug(`[${tag}]`, ...args)
  }
}
