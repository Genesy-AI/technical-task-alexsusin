// Lifecycle of a lead's phone enrichment, persisted on the lead and shown in the UI.
// null on the lead means it was never enriched.
export const PHONE_ENRICHMENT_STATUSES = ['pending', 'running', 'found', 'not_found', 'failed'] as const

export type PhoneEnrichmentStatus = (typeof PHONE_ENRICHMENT_STATUSES)[number]

export const isPhoneEnrichmentInProgress = (status: string | null | undefined): boolean =>
  status === 'pending' || status === 'running'
