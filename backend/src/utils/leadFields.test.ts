import { describe, it, expect } from 'vitest'
import { parseOptionalLeadFields } from './leadFields'

describe('parseOptionalLeadFields', () => {
  it('maps missing optional fields to null', () => {
    expect(parseOptionalLeadFields({})).toEqual({
      ok: true,
      value: { countryCode: null, phoneNumber: null, yearsAtCompany: null, linkedinUrl: null },
    })
  })

  it('normalizes valid values', () => {
    expect(
      parseOptionalLeadFields({
        countryCode: 'es',
        phoneNumber: ' +34 612 345 678 ',
        yearsAtCompany: '4',
        linkedinUrl: 'linkedin.com/in/ada-lovelace/',
      })
    ).toEqual({
      ok: true,
      value: {
        countryCode: 'ES',
        phoneNumber: '+34 612 345 678',
        yearsAtCompany: 4,
        linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace',
      },
    })
  })

  it('collects every invalid field', () => {
    const result = parseOptionalLeadFields({
      countryCode: 'XXX',
      phoneNumber: 'call me',
      yearsAtCompany: '-2',
      linkedinUrl: 'https://twitter.com/ada',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toHaveLength(4)
    expect(result.errors[0]).toContain('Invalid country code')
    expect(result.errors[1]).toContain('Invalid phone number')
    expect(result.errors[2]).toContain('Invalid years at company')
    expect(result.errors[3]).toContain('Invalid LinkedIn profile URL')
  })
})
