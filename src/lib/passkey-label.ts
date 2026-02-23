const KNOWN_DEVICES = ['iPhone', 'iPad', 'Mac', 'Windows', 'Android', 'Linux', 'ChromeOS', 'Device'] as const

function findDeviceFromUserAgent(ua: string): string {
  if (/iPad/.test(ua)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Android/.test(ua)) return 'Android'
  if (/Linux/.test(ua)) return 'Linux'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  return 'Device'
}

function inferDeviceFromLegacyName(name: string | undefined): string | null {
  const value = (name || '').trim()
  if (!value) return null

  const fromParens = value.match(/^([^()]+)\s*\(/)
  if (fromParens?.[1]) {
    const candidate = fromParens[1].trim()
    if (KNOWN_DEVICES.includes(candidate as (typeof KNOWN_DEVICES)[number])) return candidate
  }

  if (KNOWN_DEVICES.includes(value as (typeof KNOWN_DEVICES)[number])) return value
  return null
}

export function getDeviceLabelFromNavigator(): string {
  if (typeof navigator === 'undefined') return 'Device'
  return findDeviceFromUserAgent(navigator.userAgent)
}

export function buildPasskeyName(deviceLabel: string, displayName: string): string {
  const safeDisplayName = displayName.trim() || 'User'
  return `${deviceLabel} (${safeDisplayName})`
}

export function toStandardPasskeyLabel(name: string | undefined, fallbackDisplayName: string): string {
  const trimmed = (name || '').trim()

  const alreadyParenFormat = trimmed.match(/^([^()]+)\s*\((.+)\)$/)
  if (alreadyParenFormat) {
    const [, device, label] = alreadyParenFormat
    return `${device.trim()} (${label.trim()})`
  }

  const standardized = trimmed.match(/^([^,]+),\s*([^,]+),\s*(.+)$/)
  if (standardized) {
    const [, device, _date, displayName] = standardized
    return buildPasskeyName(device.trim(), displayName.trim())
  }

  if (!trimmed) {
    return buildPasskeyName('Device', fallbackDisplayName || 'User')
  }

  const legacyDeviceOnly = inferDeviceFromLegacyName(trimmed)
  if (legacyDeviceOnly) {
    return buildPasskeyName(legacyDeviceOnly, fallbackDisplayName || 'User')
  }

  return trimmed
}

export function isPasskeyCancellationLike(err: { code?: string; message?: string }): boolean {
  const code = 'code' in err ? err.code : undefined
  if (code === 'AUTH_CANCELLED' || code === 'ERROR_CEREMONY_ABORTED') return true

  const msg = (err.message || '').toLowerCase()
  return msg.includes('not allowed by the user agent')
    || msg.includes('notallowederror')
    || msg.includes('request is not allowed')
    || msg.includes('user denied permission')
    || msg.includes('the operation either timed out or was not allowed')
}