// Single source of truth for the lead fields that can be used as {placeholders} in message templates.
// The backend generator resolves exactly these keys and the frontend builds its field picker from them,
// so a new field only needs to be added here (and exist on the lead).
export const LEAD_TEMPLATE_FIELDS = [
  { key: 'firstName', label: 'First name', group: 'Person' },
  { key: 'lastName', label: 'Last name', group: 'Person' },
  { key: 'jobTitle', label: 'Job title', group: 'Person' },
  { key: 'email', label: 'Email', group: 'Contact' },
  { key: 'phoneNumber', label: 'Phone number', group: 'Contact' },
  { key: 'linkedinUrl', label: 'LinkedIn URL', group: 'Contact' },
  { key: 'companyName', label: 'Company', group: 'Company' },
  { key: 'yearsAtCompany', label: 'Years at company', group: 'Company' },
  { key: 'countryCode', label: 'Country code', group: 'Location' },
] as const

export type LeadTemplateField = (typeof LEAD_TEMPLATE_FIELDS)[number]
export type LeadTemplateFieldKey = LeadTemplateField['key']

const TEMPLATE_FIELD_KEYS: ReadonlySet<string> = new Set(LEAD_TEMPLATE_FIELDS.map(({ key }) => key))

export const isLeadTemplateFieldKey = (key: string): key is LeadTemplateFieldKey =>
  TEMPLATE_FIELD_KEYS.has(key)
