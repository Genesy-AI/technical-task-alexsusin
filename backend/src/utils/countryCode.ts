import {
  CountryCode,
  invalidCountryCodeMessage,
  isValidCountryCode,
  normalizeCountryCode,
} from '@tinyenginy/shared'

export type CountryCodeParseResult = { ok: true; value: CountryCode | null } | { ok: false; error: string }

/** Optional field: empty values are valid and map to null; anything else must be an assigned ISO 3166-1 alpha-2 code. */
export function parseOptionalCountryCode(value: unknown): CountryCodeParseResult {
  if (value === undefined || value === null) {
    return { ok: true, value: null }
  }

  if (typeof value !== 'string') {
    return { ok: false, error: 'countryCode must be a string' }
  }

  const normalized = normalizeCountryCode(value)
  if (!normalized) {
    return { ok: true, value: null }
  }

  if (!isValidCountryCode(normalized)) {
    return { ok: false, error: invalidCountryCodeMessage(value.trim()) }
  }

  return { ok: true, value: normalized }
}
