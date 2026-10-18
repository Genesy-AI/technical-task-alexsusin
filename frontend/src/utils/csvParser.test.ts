import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect } from 'vitest'
import { parseCsv, isValidEmail } from './csvParser'

describe('isValidEmail', () => {
  it('should return true for valid email addresses', () => {
    expect(isValidEmail('test@example.com')).toBe(true)
    expect(isValidEmail('user.name@domain.co.uk')).toBe(true)
    expect(isValidEmail('first.last+tag@example.org')).toBe(true)
    expect(isValidEmail('123@456.com')).toBe(true)
  })

  it('should return false for invalid email addresses', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('invalid')).toBe(false)
    expect(isValidEmail('test@')).toBe(false)
    expect(isValidEmail('@example.com')).toBe(false)
    expect(isValidEmail('test.example.com')).toBe(false)
    expect(isValidEmail('test@.com')).toBe(false)
    expect(isValidEmail('test@example')).toBe(false)
  })
})

describe('parseCsv', () => {
  it('should throw error for empty content', () => {
    expect(() => parseCsv('')).toThrow('CSV content cannot be empty')
    expect(() => parseCsv('   ')).toThrow('CSV content cannot be empty')
  })

  it('should throw error for CSV with only headers', () => {
    const csv = 'firstName,lastName,email'
    expect(() => parseCsv(csv)).toThrow('CSV file appears to be empty or contains no valid data')
  })

  it('should throw error for malformed CSV content', () => {
    const malformedCsv = `firstName,lastName,email
"John,Doe,john@example.com,extra"field`
    expect(() => parseCsv(malformedCsv)).toThrow('CSV parsing failed')
  })

  it('should throw error for CSV with mismatched field count', () => {
    const mismatchedCsv = `firstName,lastName,email
John,Doe,john@example.com,ExtraField,AnotherExtra
Jane,Smith`
    expect(() => parseCsv(mismatchedCsv)).toThrow('CSV parsing failed')
  })

  it('should throw error for CSV with critical delimiter issues', () => {
    const noDelimiterCsv = `firstName lastName email
John Doe john@example.com`
    expect(() => parseCsv(noDelimiterCsv)).toThrow()
  })

  it('should parse valid CSV with all required fields', () => {
    const csv = `firstName,lastName,email,jobTitle,countryCode,companyName
John,Doe,john.doe@example.com,Developer,US,Tech Corp`

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      jobTitle: 'Developer',
      countryCode: 'US',
      companyName: 'Tech Corp',
      isValid: true,
      errors: [],
      fieldErrors: {},
      rowIndex: 2,
    })
  })

  it('should handle missing required fields and mark as invalid', () => {
    const csv = `firstName,lastName,email
,Smith,john@example.com
John,,john@example.com
John,Smith,`

    const result = parseCsv(csv)

    expect(result).toHaveLength(3)

    expect(result[0].isValid).toBe(false)
    expect(result[0].errors).toContain('First name is required')

    expect(result[1].isValid).toBe(false)
    expect(result[1].errors).toContain('Last name is required')

    expect(result[2].isValid).toBe(false)
    expect(result[2].errors).toContain('Email is required')
  })

  it('should validate email format', () => {
    const csv = `firstName,lastName,email
John,Doe,invalid-email
Jane,Smith,jane@example.com`

    const result = parseCsv(csv)

    expect(result).toHaveLength(2)
    expect(result[0].isValid).toBe(false)
    expect(result[0].errors).toContain('Invalid email format')
    expect(result[1].isValid).toBe(true)
  })

  it('should handle CSV with quoted values', () => {
    const csv = `firstName,lastName,email,jobTitle
"John","Doe","john.doe@example.com","Software Engineer"`

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
    expect(result[0].email).toBe('john.doe@example.com')
    expect(result[0].jobTitle).toBe('Software Engineer')
  })

  it('should skip empty rows', () => {
    const csv = `firstName,lastName,email
John,Doe,john@example.com
,,
Jane,Smith,jane@example.com`

    const result = parseCsv(csv)

    expect(result).toHaveLength(2)
    expect(result[0].firstName).toBe('John')
    expect(result[1].firstName).toBe('Jane')
  })

  it('should handle case-insensitive headers', () => {
    const csv = `FIRSTNAME,LASTNAME,EMAIL,JOBTITLE,COUNTRYCODE,COMPANYNAME
John,Doe,john@example.com,Developer,US,Tech Corp`

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
    expect(result[0].email).toBe('john@example.com')
    expect(result[0].jobTitle).toBe('Developer')
  })

  it('should handle missing optional fields', () => {
    const csv = `firstName,lastName,email,jobTitle,countryCode
John,Doe,john@example.com,,`

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0].jobTitle).toBeUndefined()
    expect(result[0].countryCode).toBeUndefined()
    expect(result[0].isValid).toBe(true)
  })

  it('should preserve row index correctly', () => {
    const csv = `firstName,lastName,email
John,Doe,john@example.com
Jane,Smith,jane@example.com
Bob,Johnson,bob@example.com`

    const result = parseCsv(csv)

    expect(result).toHaveLength(3)
    expect(result[0].rowIndex).toBe(2)
    expect(result[1].rowIndex).toBe(3)
    expect(result[2].rowIndex).toBe(4)
  })

  it('should handle multiple validation errors per lead', () => {
    const csv = `firstName,lastName,email
 , ,invalid-email`

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0].isValid).toBe(false)
    expect(result[0].errors).toHaveLength(3)
    expect(result[0].errors).toContain('First name is required')
    expect(result[0].errors).toContain('Last name is required')
    expect(result[0].errors).toContain('Invalid email format')
  })

  it('should handle extra columns not in header mapping', () => {
    const csv = `firstName,lastName,email,unknownColumn
John,Doe,john@example.com,someValue`

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
    expect(result[0].email).toBe('john@example.com')
    expect(result[0].isValid).toBe(true)
  })

  it('should handle mixed valid and invalid leads', () => {
    const csv = `firstName,lastName,email
John,Doe,john@example.com
,Smith,invalid-email
Jane,Johnson,jane@example.com`

    const result = parseCsv(csv)

    expect(result).toHaveLength(3)
    expect(result[0].isValid).toBe(true)
    expect(result[1].isValid).toBe(false)
    expect(result[1].errors).toContain('First name is required')
    expect(result[1].errors).toContain('Invalid email format')
    expect(result[2].isValid).toBe(true)
  })

  it('should handle whitespace in fields', () => {
    const csv = `firstName,lastName,email
 John , Doe , john@example.com `

    const result = parseCsv(csv)

    expect(result).toHaveLength(1)
    expect(result[0].firstName).toBe('John')
    expect(result[0].lastName).toBe('Doe')
    expect(result[0].email).toBe('john@example.com')
    expect(result[0].isValid).toBe(true)
  })

  describe('countryCode', () => {
    const parseWithCountry = (countryCode: string) =>
      parseCsv(`firstName,lastName,email,countryCode
John,Doe,john@example.com,${countryCode}`)[0]

    it('accepts valid ISO 3166-1 alpha-2 codes', () => {
      const lead = parseWithCountry('ES')
      expect(lead.countryCode).toBe('ES')
      expect(lead.isValid).toBe(true)
    })

    it('normalizes lowercase codes to uppercase', () => {
      const lead = parseWithCountry(' es ')
      expect(lead.countryCode).toBe('ES')
      expect(lead.isValid).toBe(true)
    })

    it('keeps the field optional', () => {
      const lead = parseWithCountry('')
      expect(lead.countryCode).toBeUndefined()
      expect(lead.isValid).toBe(true)
    })

    it.each(['XXX', '12', 'UK', 'ZZ', 'Spain'])('marks the row invalid for "%s"', (code) => {
      const lead = parseWithCountry(code)
      expect(lead.isValid).toBe(false)
      expect(lead.errors).toContain(
        `Invalid country code "${code.toUpperCase()}" (expected ISO 3166-1 alpha-2, e.g. ES)`
      )
    })

    it('flags every invalid country code in the sample error file', () => {
      const csv = readFileSync(resolve(__dirname, '../../../docs/leads-with-errors.csv'), 'utf-8')
      const invalidCountryRows = parseCsv(csv).filter((lead) =>
        lead.errors.some((error) => error.startsWith('Invalid country code'))
      )
      expect(invalidCountryRows.map((lead) => lead.countryCode).sort()).toEqual([
        '12',
        'XXX',
        'XXX',
        'XXX',
        'XXX',
      ])
    })
  })

  describe('phoneNumber, yearsAtCompany and linkedinUrl', () => {
    const parseRow = (headers: string, values: string) =>
      parseCsv(`firstName,lastName,email,${headers}
John,Doe,john@example.com,${values}`)[0]

    it('parses and normalizes valid values', () => {
      const lead = parseRow(
        'phoneNumber,yearsAtCompany,linkedinUrl',
        '+34 612 345 678,4,linkedin.com/in/john-doe/'
      )
      expect(lead.isValid).toBe(true)
      expect(lead.phoneNumber).toBe('+34 612 345 678')
      expect(lead.yearsAtCompany).toBe('4')
      expect(lead.linkedinUrl).toBe('https://www.linkedin.com/in/john-doe')
    })

    it('keeps the fields optional', () => {
      const lead = parseRow('phoneNumber,yearsAtCompany,linkedinUrl', ',,')
      expect(lead.isValid).toBe(true)
      expect(lead.phoneNumber).toBeUndefined()
      expect(lead.yearsAtCompany).toBeUndefined()
      expect(lead.linkedinUrl).toBeUndefined()
    })

    it('accepts header aliases', () => {
      const lead = parseRow(
        'Phone,Years At Current Company,LinkedIn',
        '(731)123-9702,2,https://www.linkedin.com/in/john-doe'
      )
      expect(lead.phoneNumber).toBe('(731)123-9702')
      expect(lead.yearsAtCompany).toBe('2')
      expect(lead.linkedinUrl).toBe('https://www.linkedin.com/in/john-doe')
    })

    it('does not read yearsInRole as years at company', () => {
      const lead = parseRow('yearsInRole', '2')
      expect(lead.yearsAtCompany).toBeUndefined()
      expect(lead.isValid).toBe(true)
    })

    it('marks the row invalid and keeps the original text for invalid values', () => {
      const lead = parseRow('phoneNumber,yearsAtCompany,linkedinUrl', 'call me,two,https://twitter.com/jd')
      expect(lead.isValid).toBe(false)
      expect(lead.phoneNumber).toBe('call me')
      expect(lead.yearsAtCompany).toBe('two')
      expect(lead.linkedinUrl).toBe('https://twitter.com/jd')
      expect(lead.errors).toEqual([
        'Invalid phone number "call me"',
        'Invalid years at company "two" (expected a whole number between 0 and 80)',
        'Invalid LinkedIn profile URL "https://twitter.com/jd" (expected https://www.linkedin.com/in/<profile>)',
      ])
    })

    it('keys each error by the field it belongs to', () => {
      const lead = parseCsv(`firstName,lastName,email,countryCode,phoneNumber
,Doe,not-an-email,XXX,abc`)[0]
      expect(lead.fieldErrors).toEqual({
        firstName: 'First name is required',
        email: 'Invalid email format',
        countryCode: 'Invalid country code "XXX" (expected ISO 3166-1 alpha-2, e.g. ES)',
        phoneNumber: 'Invalid phone number "abc"',
      })
    })

    it('lists required-field errors before optional-field errors', () => {
      const lead = parseCsv(`firstName,lastName,email,phoneNumber
,Doe,john@example.com,abc`)[0]
      expect(lead.errors).toEqual(['First name is required', 'Invalid phone number "abc"'])
    })

    it('parses the new-fields sample file', () => {
      const csv = readFileSync(resolve(__dirname, '../../../docs/leads-new-fields.csv'), 'utf-8')
      const result = parseCsv(csv)
      expect(result).toHaveLength(11)
      expect(result.filter((lead) => lead.isValid).map((lead) => lead.lastName)).toEqual([
        'Lovelace',
        'Hopper',
        'Turing',
        'Hamilton',
        'Johnson',
        'Lamarr',
        'Campoamor',
      ])
      expect(result.filter((lead) => !lead.isValid).map((lead) => lead.lastName)).toEqual([
        'Torvalds',
        'Liskov',
        'Ritchie',
        'Allen',
      ])
    })

    it('parses every row of the original sample files', () => {
      for (const file of ['leads-ok-1.csv', 'leads-ok-2.csv', 'leads-ok-3.csv']) {
        const csv = readFileSync(resolve(__dirname, '../../../docs', file), 'utf-8')
        const invalid = parseCsv(csv).filter((lead) => !lead.isValid)
        expect(invalid.map((lead) => lead.errors)).toEqual([])
      }
    })
  })
})
