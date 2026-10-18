import { describe, expect, it } from 'vitest'
import {
  parseOptionalLinkedinUrl,
  parseOptionalPhoneNumber,
  parseOptionalYearsAtCompany,
} from './leadFields.js'

const EMPTY_VALUES = [undefined, null, '', '   ']

describe('parseOptionalPhoneNumber', () => {
  it('maps empty values to null', () => {
    for (const value of EMPTY_VALUES) {
      expect(parseOptionalPhoneNumber(value)).toEqual({ ok: true, value: null })
    }
  })

  it.each([
    '+1-280-754-0462x2154',
    '001-464-312-8555',
    '(731)123-9702',
    '063.430.8860x4762',
    '7549075690',
    '+34 612 345 678',
    '+44 20 7946 0958 ext. 12',
  ])('accepts "%s"', (phone) => {
    expect(parseOptionalPhoneNumber(phone)).toEqual({ ok: true, value: phone })
  })

  it('trims and collapses whitespace', () => {
    expect(parseOptionalPhoneNumber('  +34  612 345   678 ')).toEqual({ ok: true, value: '+34 612 345 678' })
  })

  it.each(['abc', '12345', '+1 (555) CALL-NOW', '1234567890123456', 'x123', '++34 612 345 678'])(
    'rejects "%s"',
    (phone) => {
      expect(parseOptionalPhoneNumber(phone).ok).toBe(false)
    }
  )

  it('rejects non-string values', () => {
    expect(parseOptionalPhoneNumber(612345678)).toEqual({ ok: false, error: 'phoneNumber must be a string' })
  })
})

describe('parseOptionalYearsAtCompany', () => {
  it('maps empty values to null', () => {
    for (const value of EMPTY_VALUES) {
      expect(parseOptionalYearsAtCompany(value)).toEqual({ ok: true, value: null })
    }
  })

  it('accepts whole numbers as strings or numbers', () => {
    expect(parseOptionalYearsAtCompany('0')).toEqual({ ok: true, value: 0 })
    expect(parseOptionalYearsAtCompany(' 15 ')).toEqual({ ok: true, value: 15 })
    expect(parseOptionalYearsAtCompany(3)).toEqual({ ok: true, value: 3 })
    expect(parseOptionalYearsAtCompany('80')).toEqual({ ok: true, value: 80 })
  })

  it.each(['-1', '2.5', 'five', '81', '1e2'])('rejects "%s"', (years) => {
    expect(parseOptionalYearsAtCompany(years)).toEqual({
      ok: false,
      error: `Invalid years at company "${years}" (expected a whole number between 0 and 80)`,
    })
  })

  it('rejects non-integer numbers and other types', () => {
    expect(parseOptionalYearsAtCompany(2.5).ok).toBe(false)
    expect(parseOptionalYearsAtCompany(-3).ok).toBe(false)
    expect(parseOptionalYearsAtCompany(true).ok).toBe(false)
  })
})

describe('parseOptionalLinkedinUrl', () => {
  it('maps empty values to null', () => {
    for (const value of EMPTY_VALUES) {
      expect(parseOptionalLinkedinUrl(value)).toEqual({ ok: true, value: null })
    }
  })

  it.each([
    'https://www.linkedin.com/in/ada-lovelace',
    'http://linkedin.com/in/ada-lovelace/',
    'linkedin.com/in/ada-lovelace',
    'www.linkedin.com/in/ada-lovelace?trk=public_profile',
    'https://es.linkedin.com/in/ada-lovelace',
  ])('accepts and normalizes "%s"', (url) => {
    expect(parseOptionalLinkedinUrl(url)).toEqual({
      ok: true,
      value: 'https://www.linkedin.com/in/ada-lovelace',
    })
  })

  it.each([
    'https://www.linkedin.com/company/enginy',
    'https://linkedin.evil.com/in/ada-lovelace',
    'https://www.linkedin.com/in/',
    'ada-lovelace',
    'https://twitter.com/in/ada-lovelace',
  ])('rejects "%s"', (url) => {
    expect(parseOptionalLinkedinUrl(url).ok).toBe(false)
  })
})
