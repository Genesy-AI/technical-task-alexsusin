import {
  CountryCode,
  parseOptionalLinkedinUrl,
  parseOptionalPhoneNumber,
  parseOptionalYearsAtCompany,
} from '@tinyenginy/shared'
import { parseOptionalCountryCode } from './countryCode'

export interface OptionalLeadFields {
  countryCode: CountryCode | null
  phoneNumber: string | null
  yearsAtCompany: number | null
  linkedinUrl: string | null
}

export type OptionalLeadFieldsResult =
  | { ok: true; value: OptionalLeadFields }
  | { ok: false; errors: string[] }

/** Validates and normalizes every optional lead field, collecting all errors instead of stopping at the first. */
export function parseOptionalLeadFields(input: Record<string, unknown>): OptionalLeadFieldsResult {
  const countryCode = parseOptionalCountryCode(input.countryCode)
  const phoneNumber = parseOptionalPhoneNumber(input.phoneNumber)
  const yearsAtCompany = parseOptionalYearsAtCompany(input.yearsAtCompany)
  const linkedinUrl = parseOptionalLinkedinUrl(input.linkedinUrl)

  if (countryCode.ok && phoneNumber.ok && yearsAtCompany.ok && linkedinUrl.ok) {
    return {
      ok: true,
      value: {
        countryCode: countryCode.value,
        phoneNumber: phoneNumber.value,
        yearsAtCompany: yearsAtCompany.value,
        linkedinUrl: linkedinUrl.value,
      },
    }
  }

  const errors = [countryCode, phoneNumber, yearsAtCompany, linkedinUrl].flatMap((result) =>
    result.ok ? [] : [result.error]
  )
  return { ok: false, errors }
}
