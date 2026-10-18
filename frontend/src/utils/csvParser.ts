import {
  invalidCountryCodeMessage,
  isValidCountryCode,
  normalizeCountryCode,
  OptionalFieldResult,
  parseOptionalLinkedinUrl,
  parseOptionalPhoneNumber,
  parseOptionalYearsAtCompany,
} from '@tinyenginy/shared'
import Papa from 'papaparse'

export type CsvLeadField =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'jobTitle'
  | 'countryCode'
  | 'companyName'
  | 'phoneNumber'
  | 'yearsAtCompany'
  | 'linkedinUrl'

// Order in which a row's errors are listed: required fields first.
const ERROR_ORDER: CsvLeadField[] = [
  'firstName',
  'lastName',
  'email',
  'countryCode',
  'phoneNumber',
  'yearsAtCompany',
  'linkedinUrl',
]

export interface CsvLead {
  firstName: string
  lastName: string
  email: string
  jobTitle?: string
  countryCode?: string
  companyName?: string
  phoneNumber?: string
  /** Whole number as text; converted to a number when importing. */
  yearsAtCompany?: string
  linkedinUrl?: string
  isValid: boolean
  errors: string[]
  /** The same errors keyed by the field they belong to, so the preview can show each next to its value. */
  fieldErrors: Partial<Record<CsvLeadField, string>>
  rowIndex: number
}

export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

// Normalized header (lowercase letters only) -> CsvLead field. yearsInRole is deliberately not an alias:
// years in the current role are not years at the company.
const OPTIONAL_FIELD_HEADERS: Record<string, 'phoneNumber' | 'yearsAtCompany' | 'linkedinUrl'> = {
  phonenumber: 'phoneNumber',
  phone: 'phoneNumber',
  yearsatcompany: 'yearsAtCompany',
  yearsatcurrentcompany: 'yearsAtCompany',
  yearsincompany: 'yearsAtCompany',
  linkedinurl: 'linkedinUrl',
  linkedin: 'linkedinUrl',
  linkedinprofile: 'linkedinUrl',
  linkedinprofileurl: 'linkedinUrl',
}

const OPTIONAL_FIELD_PARSERS: Record<
  'phoneNumber' | 'yearsAtCompany' | 'linkedinUrl',
  (value: string) => OptionalFieldResult<string | number>
> = {
  phoneNumber: parseOptionalPhoneNumber,
  yearsAtCompany: parseOptionalYearsAtCompany,
  linkedinUrl: parseOptionalLinkedinUrl,
}

export const parseCsv = (content: string): CsvLead[] => {
  if (!content?.trim()) {
    throw new Error('CSV content cannot be empty')
  }

  const parseResult = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transform: (value) => value.trim(),
    transformHeader: (header) => header.trim().toLowerCase(),
    quoteChar: '"',
  })

  if (parseResult.errors.length > 0) {
    const criticalErrors = parseResult.errors.filter(
      (error) => error.type === 'Delimiter' || error.type === 'Quotes' || error.type === 'FieldMismatch'
    )
    if (criticalErrors.length > 0) {
      throw new Error(`CSV parsing failed: ${criticalErrors[0].message}`)
    }
  }

  if (!parseResult.data || parseResult.data.length === 0) {
    throw new Error('CSV file appears to be empty or contains no valid data')
  }

  const data: CsvLead[] = []

  parseResult.data.forEach((row, index) => {
    if (Object.values(row).every((value) => !value)) return

    const lead: Partial<CsvLead> = { rowIndex: index + 2 }
    const fieldErrors: Partial<Record<CsvLeadField, string>> = {}

    Object.entries(row).forEach(([header, value]) => {
      const normalizedHeader = header.toLowerCase().replace(/[^a-z]/g, '')
      const trimmedValue = value?.trim() || ''

      switch (normalizedHeader) {
        case 'firstname':
          lead.firstName = trimmedValue
          break
        case 'lastname':
          lead.lastName = trimmedValue
          break
        case 'email':
          lead.email = trimmedValue
          break
        case 'jobtitle':
          lead.jobTitle = trimmedValue || undefined
          break
        case 'countrycode':
          lead.countryCode = normalizeCountryCode(trimmedValue) || undefined
          break
        case 'companyname':
          lead.companyName = trimmedValue || undefined
          break
        default: {
          const field = OPTIONAL_FIELD_HEADERS[normalizedHeader]
          if (!field) break
          const result = OPTIONAL_FIELD_PARSERS[field](trimmedValue)
          // Keep the original text when invalid so the preview can show what the user wrote.
          lead[field] = result.ok ? (result.value?.toString() ?? undefined) : trimmedValue
          if (!result.ok) fieldErrors[field] = result.error
        }
      }
    })

    if (!lead.firstName?.trim()) {
      fieldErrors.firstName = 'First name is required'
    }
    if (!lead.lastName?.trim()) {
      fieldErrors.lastName = 'Last name is required'
    }
    if (!lead.email?.trim()) {
      fieldErrors.email = 'Email is required'
    } else if (!isValidEmail(lead.email)) {
      fieldErrors.email = 'Invalid email format'
    }
    if (lead.countryCode && !isValidCountryCode(lead.countryCode)) {
      fieldErrors.countryCode = invalidCountryCodeMessage(lead.countryCode)
    }
    const errors = ERROR_ORDER.flatMap((field) => fieldErrors[field] ?? [])

    data.push({
      ...lead,
      firstName: lead.firstName || '',
      lastName: lead.lastName || '',
      email: lead.email || '',
      isValid: errors.length === 0,
      errors,
      fieldErrors,
    } as CsvLead)
  })

  return data
}
