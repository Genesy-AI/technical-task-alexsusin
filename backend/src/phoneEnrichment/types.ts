// Types shared by the workflow (deterministic sandbox) and the rest of the backend. Keep this file free of
// runtime imports so the workflow bundle does not pull in Node modules.

export interface ProviderRetryPolicy {
  maximumAttempts: number
  initialIntervalMs: number
  backoffCoefficient: number
  maximumIntervalMs?: number
}

export interface PhoneEnrichmentStep {
  providerId: string
  displayName: string
  taskQueue: string
  startToCloseTimeoutMs: number
  retry: ProviderRetryPolicy
}

/** Resolved from settings when the workflow starts, so a running workflow is not affected by config edits. */
export interface PhoneEnrichmentPlan {
  steps: PhoneEnrichmentStep[]
}

export interface EnrichPhoneWorkflowInput {
  leadId: number
  plan: PhoneEnrichmentPlan
}

export type ProviderAttemptOutcome = 'found' | 'not_found' | 'skipped' | 'failed'

export interface ProviderAttempt {
  provider: string
  outcome: ProviderAttemptOutcome
  detail?: string
}

export type PhoneEnrichmentFinalStatus = 'found' | 'not_found' | 'failed'

export interface EnrichPhoneWorkflowResult {
  status: PhoneEnrichmentFinalStatus
  phone?: string
  provider?: string
  attempts: ProviderAttempt[]
}
