// Parsers for optional lead fields, shared by the CSV import (frontend) and the API (backend).
// Empty values (undefined, null, blank strings) are valid and map to null.

export type OptionalFieldResult<T> = { ok: true; value: T | null } | { ok: false; error: string }

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

// Accepts the usual human formats ("+1-280-754-0462", "(731)123-9702", "063.430.8860x4762") and an optional
// extension. Without a country we cannot normalize to E.164, so the value is stored as written (trimmed).
const PHONE_PATTERN = /^\+?[0-9()\-.\s]+?(?:\s*(?:x|ext\.?)\s*\d{1,6})?$/i
const PHONE_EXTENSION = /\s*(?:x|ext\.?)\s*\d{1,6}$/i
const MIN_PHONE_DIGITS = 7
const MAX_PHONE_DIGITS = 15

export function parseOptionalPhoneNumber(value: unknown): OptionalFieldResult<string> {
  if (isEmpty(value)) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: 'phoneNumber must be a string' }

  const phoneNumber = value.trim().replace(/\s+/g, ' ')
  const digits = phoneNumber.replace(PHONE_EXTENSION, '').replace(/\D/g, '')
  if (
    !PHONE_PATTERN.test(phoneNumber) ||
    digits.length < MIN_PHONE_DIGITS ||
    digits.length > MAX_PHONE_DIGITS
  ) {
    return { ok: false, error: `Invalid phone number "${phoneNumber}"` }
  }

  return { ok: true, value: phoneNumber }
}

export const MAX_YEARS_AT_COMPANY = 80

export function parseOptionalYearsAtCompany(value: unknown): OptionalFieldResult<number> {
  if (isEmpty(value)) return { ok: true, value: null }

  const raw = typeof value === 'string' ? value.trim() : value
  const years = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw
  if (typeof years !== 'number' || !Number.isInteger(years) || years < 0 || years > MAX_YEARS_AT_COMPANY) {
    return {
      ok: false,
      error: `Invalid years at company "${String(raw)}" (expected a whole number between 0 and ${MAX_YEARS_AT_COMPANY})`,
    }
  }

  return { ok: true, value: years }
}

// Personal profiles only (/in/<handle>), with or without protocol, www or a country subdomain (es.linkedin.com).
const LINKEDIN_PROFILE_PATTERN =
  /^(?:https?:\/\/)?(?:(?:www|[a-z]{2})\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%]{3,100})\/?(?:[?#].*)?$/i

/** Valid URLs are normalized to https://www.linkedin.com/in/<handle>. */
export function parseOptionalLinkedinUrl(value: unknown): OptionalFieldResult<string> {
  if (isEmpty(value)) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: 'linkedinUrl must be a string' }

  const url = value.trim()
  const match = LINKEDIN_PROFILE_PATTERN.exec(url)
  if (!match) {
    return {
      ok: false,
      error: `Invalid LinkedIn profile URL "${url}" (expected https://www.linkedin.com/in/<profile>)`,
    }
  }

  return { ok: true, value: `https://www.linkedin.com/in/${match[1]}` }
}
