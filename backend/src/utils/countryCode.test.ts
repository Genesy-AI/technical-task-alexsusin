import { describe, it, expect } from 'vitest'
import { parseOptionalCountryCode } from './countryCode'

describe('parseOptionalCountryCode', () => {
  it('maps empty values to null', () => {
    for (const value of [undefined, null, '', '   ']) {
      expect(parseOptionalCountryCode(value)).toEqual({ ok: true, value: null })
    }
  })

  it('accepts valid codes and normalizes them', () => {
    expect(parseOptionalCountryCode('ES')).toEqual({ ok: true, value: 'ES' })
    expect(parseOptionalCountryCode(' us ')).toEqual({ ok: true, value: 'US' })
  })

  it('rejects unknown or malformed codes', () => {
    for (const value of ['XXX', '12', 'UK', 'ZZ', 'Spain']) {
      const result = parseOptionalCountryCode(value)
      expect(result.ok).toBe(false)
    }
    expect(parseOptionalCountryCode(' xxx ')).toEqual({
      ok: false,
      error: 'Invalid country code "xxx" (expected ISO 3166-1 alpha-2, e.g. ES)',
    })
  })

  it('rejects non-string values', () => {
    expect(parseOptionalCountryCode(34)).toEqual({ ok: false, error: 'countryCode must be a string' })
  })
})
