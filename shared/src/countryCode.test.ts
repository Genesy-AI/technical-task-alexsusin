import { describe, expect, it } from 'vitest'
import { COUNTRIES } from './countries.js'
import { getCountryName, isValidCountryCode, normalizeCountryCode } from './countryCode.js'

describe('COUNTRIES', () => {
  it('contains the 249 officially assigned ISO 3166-1 alpha-2 codes', () => {
    expect(COUNTRIES).toHaveLength(249)
  })

  it('has well-formed, unique codes', () => {
    const codes = COUNTRIES.map(({ code }) => code)
    expect(codes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('normalizeCountryCode', () => {
  it('trims and uppercases', () => {
    expect(normalizeCountryCode('  es ')).toBe('ES')
  })
})

describe('isValidCountryCode', () => {
  it('accepts assigned codes', () => {
    expect(isValidCountryCode('ES')).toBe(true)
    expect(isValidCountryCode('US')).toBe(true)
    expect(isValidCountryCode('GB')).toBe(true)
  })

  it('rejects malformed values', () => {
    for (const value of ['', 'E', 'ESP', 'XXX', '12', 'es', 'É S']) {
      expect(isValidCountryCode(value)).toBe(false)
    }
  })

  it('rejects reserved and user-assigned codes', () => {
    for (const value of ['UK', 'EU', 'XK', 'AA', 'XX', 'ZZ']) {
      expect(isValidCountryCode(value)).toBe(false)
    }
  })
})

describe('getCountryName', () => {
  it('returns the name for a known code and undefined otherwise', () => {
    expect(getCountryName('ES')).toBe('Spain')
    expect(getCountryName('XX')).toBeUndefined()
  })
})
