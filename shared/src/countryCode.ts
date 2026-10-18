import { COUNTRIES } from './countries.js'

export type CountryCode = (typeof COUNTRIES)[number]['code']

const COUNTRY_NAME_BY_CODE: ReadonlyMap<string, string> = new Map(
  COUNTRIES.map(({ code, name }) => [code, name])
)

export const normalizeCountryCode = (value: string): string => value.trim().toUpperCase()

/** Expects an already normalized value; use `normalizeCountryCode` first for raw user input. */
export const isValidCountryCode = (value: string): value is CountryCode => COUNTRY_NAME_BY_CODE.has(value)

export const getCountryName = (code: string): string | undefined => COUNTRY_NAME_BY_CODE.get(code)

export const invalidCountryCodeMessage = (value: string): string =>
  `Invalid country code "${value}" (expected ISO 3166-1 alpha-2, e.g. ES)`
