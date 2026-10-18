import type { ProviderInputField } from '../config/appSettings'

export type ProviderInput = Partial<Record<ProviderInputField, string>>

export interface LeadForEnrichment {
  firstName: string
  lastName: string
  email: string
  jobTitle: string | null
  companyName: string | null
}

// Consumer mailbox domains: their domain says nothing about the lead's company.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.es',
  'hotmail.com',
  'hotmail.es',
  'outlook.com',
  'outlook.es',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'zoho.com',
])

/** The company website is the domain of a corporate email; free mailbox domains give no website. */
export function companyWebsiteFromEmail(email: string): string | undefined {
  const domain = email.trim().toLowerCase().split('@')[1]
  if (!domain || !domain.includes('.') || FREE_EMAIL_DOMAINS.has(domain)) return undefined
  return domain
}

const present = (value: string | null | undefined): string | undefined => value?.trim() || undefined

export function buildProviderInput(lead: LeadForEnrichment): ProviderInput {
  return {
    firstName: present(lead.firstName),
    lastName: present(lead.lastName),
    fullName: present(`${lead.firstName} ${lead.lastName}`),
    email: present(lead.email),
    jobTitle: present(lead.jobTitle),
    companyName: present(lead.companyName),
    companyWebsite: companyWebsiteFromEmail(lead.email),
  }
}
