import { ApplicationFailure, Context } from '@temporalio/activity'
import { getAppSettings } from '../../config/appSettings'
import { prisma } from '../../db'
import { callProvider, ProviderCallResult, ProviderRequestError } from '../../phoneEnrichment/providerClient'
import { buildProviderInput, ProviderInput } from '../../phoneEnrichment/providerInput'
import type { PhoneEnrichmentFinalStatus } from '../../phoneEnrichment/types'

export async function loadPhoneEnrichmentInput(leadId: number): Promise<ProviderInput> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) throw ApplicationFailure.nonRetryable(`Lead ${leadId} not found`, 'LeadNotFound')
  return buildProviderInput(lead)
}

export async function markPhoneEnrichmentRunning(leadId: number, providerName: string): Promise<void> {
  await prisma.lead.update({
    where: { id: leadId },
    data: { phoneEnrichmentStatus: 'running', phoneEnrichmentProvider: providerName },
  })
}

export async function completePhoneEnrichment(
  leadId: number,
  outcome: { status: PhoneEnrichmentFinalStatus; phone?: string; provider?: string }
): Promise<void> {
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      phoneEnrichmentStatus: outcome.status,
      phoneEnrichmentProvider: outcome.provider ?? null,
      // Only a found phone overwrites the current one; "no data" keeps whatever the lead already had.
      ...(outcome.status === 'found' && outcome.phone ? { phoneNumber: outcome.phone } : {}),
    },
  })
}

/** Runs on the provider's own task queue, so its worker can enforce that provider's rate limit. */
export async function callPhoneProvider(
  providerId: string,
  input: ProviderInput
): Promise<ProviderCallResult> {
  const provider = getAppSettings().phoneEnrichment.providers[providerId]
  if (!provider)
    throw ApplicationFailure.nonRetryable(`Unknown phone provider "${providerId}"`, 'UnknownProvider')

  const context = Context.current()
  try {
    const result = await callProvider(provider, input, { signal: context.cancellationSignal })
    context.log.info('Phone provider call finished', { providerId, outcome: result.outcome })
    return result
  } catch (error) {
    if (!(error instanceof ProviderRequestError)) throw error
    context.log.warn('Phone provider call failed', {
      providerId,
      error: error.message,
      retryable: error.retryable,
    })
    throw ApplicationFailure.create({
      message: error.message,
      type: 'ProviderRequestError',
      nonRetryable: !error.retryable,
      nextRetryDelay: error.retryAfterMs,
    })
  }
}
