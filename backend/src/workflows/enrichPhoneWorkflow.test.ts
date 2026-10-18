import path from 'path'
import { ApplicationFailure } from '@temporalio/activity'
import { TestWorkflowEnvironment } from '@temporalio/testing'
import { Worker } from '@temporalio/worker'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ProviderCallResult } from '../phoneEnrichment/providerClient'
import type { ProviderInput } from '../phoneEnrichment/providerInput'
import type { EnrichPhoneWorkflowResult, PhoneEnrichmentPlan } from '../phoneEnrichment/types'
import { enrichPhoneWorkflow } from './workflows'

const MAIN_QUEUE = 'test-main'

const plan: PhoneEnrichmentPlan = {
  steps: ['one', 'two', 'three'].map((id) => ({
    providerId: id,
    displayName: `Provider ${id}`,
    taskQueue: `test-provider-${id}`,
    startToCloseTimeoutMs: 5000,
    retry: { maximumAttempts: 3, initialIntervalMs: 100, backoffCoefficient: 2 },
  })),
}

type ProviderBehaviour = (attempt: number) => ProviderCallResult
const found =
  (phone: string): ProviderBehaviour =>
  () => ({ outcome: 'found', phone })
const notFound: ProviderBehaviour = () => ({ outcome: 'not_found' })
const skipped: ProviderBehaviour = () => ({ outcome: 'skipped', missingFields: ['companyWebsite'] })
const failsWith =
  (error: () => Error, untilAttempt = Infinity, then: ProviderBehaviour = notFound): ProviderBehaviour =>
  (attempt) => {
    if (attempt <= untilAttempt) throw error()
    return then(attempt)
  }

describe('enrichPhoneWorkflow', () => {
  let env: TestWorkflowEnvironment
  let behaviours: Record<string, ProviderBehaviour>
  let calls: Record<string, number>
  const lead = {
    running: vi.fn(async (_leadId: number, _provider: string) => {}),
    complete: vi.fn(async (_leadId: number, _outcome: unknown) => {}),
  }

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping()
  }, 120_000)

  afterAll(async () => {
    await env?.teardown()
  })

  const run = async (scenario: Record<string, ProviderBehaviour>): Promise<EnrichPhoneWorkflowResult> => {
    behaviours = scenario
    calls = {}
    lead.running.mockClear()
    lead.complete.mockClear()

    const callPhoneProvider = async (providerId: string, _input: ProviderInput) => {
      calls[providerId] = (calls[providerId] ?? 0) + 1
      return behaviours[providerId](calls[providerId])
    }
    const mainWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: MAIN_QUEUE,
      workflowsPath: path.join(__dirname, 'workflows.ts'),
      activities: {
        loadPhoneEnrichmentInput: async () => ({ email: 'ada@analytical.io' }),
        markPhoneEnrichmentRunning: lead.running,
        completePhoneEnrichment: lead.complete,
      },
    })
    const providerWorkers = await Promise.all(
      plan.steps.map((step) =>
        Worker.create({
          connection: env.nativeConnection,
          taskQueue: step.taskQueue,
          activities: { callPhoneProvider },
        })
      )
    )

    let result: EnrichPhoneWorkflowResult | undefined
    const workers = [mainWorker, ...providerWorkers]
    await Promise.all([
      ...workers.slice(1).map((worker) =>
        worker.runUntil(
          () =>
            new Promise<void>((resolve) => {
              const check = setInterval(() => result && (clearInterval(check), resolve()), 20)
            })
        )
      ),
      mainWorker.runUntil(async () => {
        result = await env.client.workflow.execute(enrichPhoneWorkflow, {
          taskQueue: MAIN_QUEUE,
          workflowId: `enrich-phone-test-${Date.now()}-${Math.random()}`,
          args: [{ leadId: 7, plan }],
        })
      }),
    ])
    return result!
  }

  it('stops at the first provider that finds a phone', async () => {
    const result = await run({
      one: found('3732702561'),
      two: found('1111111111'),
      three: found('2222222222'),
    })

    expect(result).toEqual({
      status: 'found',
      phone: '3732702561',
      provider: 'Provider one',
      attempts: [{ provider: 'Provider one', outcome: 'found' }],
    })
    expect(calls).toEqual({ one: 1 })
    expect(lead.running.mock.calls).toEqual([[7, 'Provider one']])
    expect(lead.complete).toHaveBeenCalledWith(7, {
      status: 'found',
      phone: '3732702561',
      provider: 'Provider one',
    })
  }, 60_000)

  it('moves on through providers without data or without the required input', async () => {
    const result = await run({ one: notFound, two: skipped, three: found('7549075690') })

    expect(result.status).toBe('found')
    expect(result.provider).toBe('Provider three')
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(['not_found', 'skipped', 'found'])
    expect(lead.running.mock.calls.map(([, provider]) => provider)).toEqual([
      'Provider one',
      'Provider two',
      'Provider three',
    ])
  }, 60_000)

  it('retries a retryable failure within the same provider', async () => {
    const result = await run({
      one: failsWith(
        () => ApplicationFailure.retryable('Provider one responded 500'),
        2,
        found('9778898839')
      ),
      two: notFound,
      three: notFound,
    })

    expect(result).toMatchObject({ status: 'found', phone: '9778898839', provider: 'Provider one' })
    expect(calls).toEqual({ one: 3 })
  }, 60_000)

  it('does not retry non-retryable failures and continues with the next provider', async () => {
    const result = await run({
      one: failsWith(() => ApplicationFailure.nonRetryable('Provider one responded 401')),
      two: notFound,
      three: notFound,
    })

    expect(calls).toEqual({ one: 1, two: 1, three: 1 })
    expect(result.status).toBe('failed')
    expect(result.attempts[0]).toEqual({
      provider: 'Provider one',
      outcome: 'failed',
      detail: 'Provider one responded 401',
    })
    expect(lead.complete).toHaveBeenCalledWith(7, { status: 'failed' })
  }, 60_000)

  it('gives up on a provider after its maximum attempts', async () => {
    const result = await run({
      one: notFound,
      two: failsWith(() => ApplicationFailure.retryable('Provider two responded 503')),
      three: found('2468013812'),
    })

    expect(calls).toEqual({ one: 1, two: 3, three: 1 })
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(['not_found', 'failed', 'found'])
    expect(result.status).toBe('found')
  }, 60_000)

  it('reports not_found when every provider answered without a phone', async () => {
    const result = await run({ one: notFound, two: skipped, three: notFound })

    expect(result.status).toBe('not_found')
    expect(lead.complete).toHaveBeenCalledWith(7, { status: 'not_found' })
  }, 60_000)
})
