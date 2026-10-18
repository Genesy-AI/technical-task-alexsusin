import type { PhoneEnrichmentSettings } from '../config/appSettings'
import type { PhoneEnrichmentPlan } from './types'

export const providerTaskQueue = (providerId: string): string => `phone-enrichment.${providerId}`

// The activity timeout leaves room for the provider's own HTTP timeout to fire first, so a slow provider
// surfaces as a clean "timed out" error instead of an opaque activity timeout.
const ACTIVITY_TIMEOUT_MARGIN_MS = 1000

/** Enabled providers in the configured order, each with its own task queue, timeout and retry policy. */
export function buildPhoneEnrichmentPlan(settings: PhoneEnrichmentSettings): PhoneEnrichmentPlan {
  return {
    steps: settings.providerOrder
      .map((providerId) => ({ providerId, provider: settings.providers[providerId] }))
      .filter(({ provider }) => provider.enabled)
      .map(({ providerId, provider }) => ({
        providerId,
        displayName: provider.displayName,
        taskQueue: providerTaskQueue(providerId),
        startToCloseTimeoutMs: provider.timeoutMs + ACTIVITY_TIMEOUT_MARGIN_MS,
        retry: { ...settings.defaultRetry, ...provider.retry },
      })),
  }
}
