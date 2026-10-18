import { describe, expect, it, vi } from 'vitest'
import type { ProviderSettings } from '../config/appSettings'
import {
  buildProviderRequest,
  callProvider,
  extractPhone,
  parseRetryAfterMs,
  ProviderRequestError,
  renderTemplate,
} from './providerClient'
import { buildProviderInput, companyWebsiteFromEmail } from './providerInput'

const provider = (overrides: Partial<ProviderSettings> = {}): ProviderSettings => ({
  displayName: 'Test Provider',
  enabled: true,
  url: 'https://provider.example/lookup',
  method: 'POST',
  timeoutMs: 1000,
  auth: { type: 'header', name: 'x-key', secret: 'header-secret' },
  request: { fullName: '{{fullName}}', email: '{{email}}' },
  response: { phonePath: 'phone' },
  ...overrides,
})

const input = buildProviderInput({
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@analytical.io',
  jobTitle: 'CTO',
  companyName: 'Analytical Engines',
})

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

describe('providerInput', () => {
  it('derives the company website from corporate emails only', () => {
    expect(companyWebsiteFromEmail('ada@Analytical.io')).toBe('analytical.io')
    expect(companyWebsiteFromEmail('ada@gmail.com')).toBeUndefined()
    expect(companyWebsiteFromEmail('not-an-email')).toBeUndefined()
  })

  it('builds the template input from the lead', () => {
    expect(input).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      fullName: 'Ada Lovelace',
      email: 'ada@analytical.io',
      jobTitle: 'CTO',
      companyName: 'Analytical Engines',
      companyWebsite: 'analytical.io',
    })
  })
})

describe('renderTemplate', () => {
  it('interpolates fields and reports missing ones', () => {
    expect(renderTemplate('{{firstName}} at {{ companyName }}', input)).toEqual({
      value: 'Ada at Analytical Engines',
      missing: [],
    })
    expect(renderTemplate('{{jobTitle}}', { email: 'x@y.com' })).toEqual({ value: '', missing: ['jobTitle'] })
  })
})

describe('buildProviderRequest', () => {
  it('sends a JSON body with header auth', () => {
    const request = buildProviderRequest(provider(), input)
    expect(request).toEqual({
      url: 'https://provider.example/lookup',
      init: {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-key': 'header-secret' },
        body: JSON.stringify({ fullName: 'Ada Lovelace', email: 'ada@analytical.io' }),
      },
    })
  })

  it('puts the secret in the query string for query auth', () => {
    const request = buildProviderRequest(
      provider({ auth: { type: 'query', name: 'api', secret: 's3cr3t' } }),
      input
    )
    expect('url' in request && request.url).toBe('https://provider.example/lookup?api=s3cr3t')
  })

  it('sends parameters in the query string for GET', () => {
    const request = buildProviderRequest(provider({ method: 'GET', auth: { type: 'none' } }), input)
    expect('url' in request && request.url).toBe(
      'https://provider.example/lookup?fullName=Ada+Lovelace&email=ada%40analytical.io'
    )
  })

  it('reports the fields the lead is missing', () => {
    const request = buildProviderRequest(provider({ request: { website: '{{companyWebsite}}' } }), {
      email: 'ada@gmail.com',
    })
    expect(request).toEqual({ missingFields: ['companyWebsite'] })
  })
})

describe('extractPhone', () => {
  it('reads string and numeric phones from the configured path', () => {
    expect(extractPhone(provider(), { phone: '+34 612 345 678' })).toBe('+34 612 345 678')
    expect(extractPhone(provider({ response: { phonePath: 'phoneNmbr' } }), { phoneNmbr: 2468013812 })).toBe(
      '2468013812'
    )
    expect(
      extractPhone(provider({ response: { phonePath: 'data.phone' } }), { data: { phone: '7549075690' } })
    ).toBe('7549075690')
  })

  it('treats missing, null and invalid values as no phone', () => {
    expect(extractPhone(provider(), {})).toBeNull()
    expect(extractPhone(provider(), { phone: null })).toBeNull()
    expect(extractPhone(provider(), { phone: 'unknown' })).toBeNull()
  })
})

describe('parseRetryAfterMs', () => {
  it('accepts seconds and HTTP dates', () => {
    expect(parseRetryAfterMs('3')).toBe(3000)
    expect(
      parseRetryAfterMs('Wed, 21 Oct 2026 07:28:05 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'))
    ).toBe(5000)
    expect(parseRetryAfterMs(null)).toBeUndefined()
    expect(parseRetryAfterMs('soon')).toBeUndefined()
  })
})

describe('callProvider', () => {
  it('returns the phone when the provider finds one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ phone: '3732702561' }))
    await expect(callProvider(provider(), input, { fetchImpl })).resolves.toEqual({
      outcome: 'found',
      phone: '3732702561',
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('returns not_found when the provider has no data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ phone: null }))
    await expect(callProvider(provider(), input, { fetchImpl })).resolves.toEqual({ outcome: 'not_found' })
  })

  it('skips the call when the lead lacks required input', async () => {
    const fetchImpl = vi.fn()
    await expect(
      callProvider(provider({ request: { jobTitle: '{{jobTitle}}' } }), { email: 'x@y.com' }, { fetchImpl })
    ).resolves.toEqual({ outcome: 'skipped', missingFields: ['jobTitle'] })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    [500, true],
    [503, true],
    [429, true],
    [408, true],
    [400, false],
    [401, false],
    [404, false],
  ])('classifies HTTP %i as retryable=%s', async (status, retryable) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'error' }, status))
    const error = await callProvider(provider(), input, { fetchImpl }).catch((e) => e)
    expect(error).toBeInstanceOf(ProviderRequestError)
    expect(error.retryable).toBe(retryable)
    expect(error.message).toBe(`Test Provider responded ${status}`)
  })

  it('passes Retry-After from 429 responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 429, { 'Retry-After': '2' }))
    const error = await callProvider(provider(), input, { fetchImpl }).catch((e) => e)
    expect(error.retryAfterMs).toBe(2000)
  })

  it('treats network errors and timeouts as retryable without leaking the secret', async () => {
    const secretProvider = provider({ auth: { type: 'query', name: 'api', secret: 's3cr3t' } })
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const error = await callProvider(secretProvider, input, { fetchImpl }).catch((e) => e)
    expect(error).toBeInstanceOf(ProviderRequestError)
    expect(error.retryable).toBe(true)
    expect(error.message).not.toContain('s3cr3t')

    const slowFetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        )
    )
    const timeoutError = await callProvider(provider({ timeoutMs: 20 }), input, {
      fetchImpl: slowFetch,
    }).catch((e) => e)
    expect(timeoutError.message).toBe('Test Provider request failed: timed out after 20ms')
    expect(timeoutError.retryable).toBe(true)
  })

  it('treats a non-JSON body as retryable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>', { status: 200 }))
    const error = await callProvider(provider(), input, { fetchImpl }).catch((e) => e)
    expect(error.retryable).toBe(true)
  })
})
