import { ActivityFailure, proxyActivities } from '@temporalio/workflow'
import type * as activities from './activities'
import type {
  EnrichPhoneWorkflowInput,
  EnrichPhoneWorkflowResult,
  PhoneEnrichmentStep,
  ProviderAttempt,
} from '../phoneEnrichment/types'

// Bounded retries so a slow or failing provider ends in a workflow failure instead of retrying forever.
// Worst case: 3 attempts x 3s + 0.5s + 1s of backoff ≈ 10.5s.
const { verifyEmail } = proxyActivities<typeof activities>({
  startToCloseTimeout: '3 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '500 milliseconds',
    backoffCoefficient: 2,
  },
})

export async function verifyEmailWorkflow(email: string): Promise<boolean> {
  return await verifyEmail(email)
}

// Lead bookkeeping (load input, persist status) runs on the main task queue and is quick.
const leadActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 5, initialInterval: '500 milliseconds', backoffCoefficient: 2 },
})

const providerActivities = (step: PhoneEnrichmentStep) =>
  proxyActivities<typeof activities>({
    taskQueue: step.taskQueue,
    startToCloseTimeout: step.startToCloseTimeoutMs,
    retry: {
      maximumAttempts: step.retry.maximumAttempts,
      initialInterval: step.retry.initialIntervalMs,
      backoffCoefficient: step.retry.backoffCoefficient,
      maximumInterval: step.retry.maximumIntervalMs,
    },
  })

// ActivityFailure wraps the activity's own error (e.g. "Orion Connect responded 500") in its cause.
const errorMessage = (error: unknown): string => {
  if (error instanceof ActivityFailure && error.cause) return error.cause.message
  return error instanceof Error ? error.message : String(error)
}

/**
 * Queries the providers of the plan in order and stops at the first phone found. A provider that keeps failing
 * after its retries is recorded and the next one is tried; the final status is "failed" only when no phone was
 * found and at least one provider failed (otherwise "not_found").
 */
export async function enrichPhoneWorkflow({
  leadId,
  plan,
}: EnrichPhoneWorkflowInput): Promise<EnrichPhoneWorkflowResult> {
  const input = await leadActivities.loadPhoneEnrichmentInput(leadId)
  const attempts: ProviderAttempt[] = []

  for (const step of plan.steps) {
    await leadActivities.markPhoneEnrichmentRunning(leadId, step.displayName)
    try {
      const result = await providerActivities(step).callPhoneProvider(step.providerId, input)
      if (result.outcome === 'found') {
        attempts.push({ provider: step.displayName, outcome: 'found' })
        await leadActivities.completePhoneEnrichment(leadId, {
          status: 'found',
          phone: result.phone,
          provider: step.displayName,
        })
        return { status: 'found', phone: result.phone, provider: step.displayName, attempts }
      }
      attempts.push(
        result.outcome === 'skipped'
          ? {
              provider: step.displayName,
              outcome: 'skipped',
              detail: `Missing ${result.missingFields.join(', ')}`,
            }
          : { provider: step.displayName, outcome: 'not_found' }
      )
    } catch (error) {
      attempts.push({ provider: step.displayName, outcome: 'failed', detail: errorMessage(error) })
    }
  }

  const status = attempts.some((attempt) => attempt.outcome === 'failed') ? 'failed' : 'not_found'
  await leadActivities.completePhoneEnrichment(leadId, { status })
  return { status, attempts }
}
