import { parseOptionalPhoneNumber } from '@tinyenginy/shared'
import { ProviderSettings, templateFields } from '../config/appSettings'
import type { ProviderInput } from './providerInput'

export type ProviderCallResult =
  | { outcome: 'found'; phone: string }
  | { outcome: 'not_found' }
  // The lead lacks data the provider needs (e.g. no corporate email for a company website): not called.
  | { outcome: 'skipped'; missingFields: string[] }

/** A failed provider call. `retryable` tells the activity whether Temporal should try again. */
export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'ProviderRequestError'
  }
}

/** Replaces {{field}} placeholders; reports the referenced fields the input does not have. */
export function renderTemplate(template: string, input: ProviderInput): { value: string; missing: string[] } {
  const missing = templateFields(template).filter((field) => !input[field as keyof ProviderInput])
  const value = template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_, field) => input[field as keyof ProviderInput] ?? ''
  )
  return { value, missing }
}

export type ProviderRequest = { url: string; init: RequestInit }

export function buildProviderRequest(
  provider: ProviderSettings,
  input: ProviderInput
): ProviderRequest | { missingFields: string[] } {
  const params: Record<string, string> = {}
  const missingFields = new Set<string>()
  for (const [name, template] of Object.entries(provider.request)) {
    const rendered = renderTemplate(template, input)
    rendered.missing.forEach((field) => missingFields.add(field))
    params[name] = rendered.value
  }
  if (missingFields.size > 0) return { missingFields: [...missingFields] }

  const url = new URL(provider.url)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (provider.auth.type === 'header') headers[provider.auth.name] = provider.auth.secret ?? ''
  if (provider.auth.type === 'query') url.searchParams.set(provider.auth.name, provider.auth.secret ?? '')

  if (provider.method === 'GET') {
    Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value))
    return { url: url.toString(), init: { method: 'GET', headers } }
  }

  headers['Content-Type'] = 'application/json'
  return { url: url.toString(), init: { method: provider.method, headers, body: JSON.stringify(params) } }
}

export function readPath(json: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node === null || typeof node !== 'object') return undefined
    return (node as Record<string, unknown>)[key]
  }, json)
}

/** Providers return the phone as a string or a number; anything that is not a valid phone counts as no data. */
export function extractPhone(provider: ProviderSettings, json: unknown): string | null {
  const raw = readPath(json, provider.response.phonePath)
  const text =
    typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : typeof raw === 'string' ? raw : ''
  const parsed = parseOptionalPhoneNumber(text)
  return parsed.ok ? parsed.value : null
}

// Timeouts, rate limiting and server errors are worth retrying; other 4xx (bad auth, missing input) are not.
export const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500

export function parseRetryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(header)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now)
}

export interface CallProviderOptions {
  /** Cancellation from the caller (the Temporal activity context). */
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/**
 * Calls one provider as described by its settings. Errors never include the request URL, because it may
 * carry the provider secret as a query parameter.
 */
export async function callProvider(
  provider: ProviderSettings,
  input: ProviderInput,
  { signal, fetchImpl = fetch }: CallProviderOptions = {}
): Promise<ProviderCallResult> {
  const request = buildProviderRequest(provider, input)
  if ('missingFields' in request) return { outcome: 'skipped', missingFields: request.missingFields }

  const timeout = AbortSignal.timeout(provider.timeoutMs)
  let response: Response
  try {
    response = await fetchImpl(request.url, {
      ...request.init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch (error) {
    const reason = timeout.aborted ? `timed out after ${provider.timeoutMs}ms` : (error as Error).message
    throw new ProviderRequestError(`${provider.displayName} request failed: ${reason}`, true)
  }

  if (!response.ok) {
    throw new ProviderRequestError(
      `${provider.displayName} responded ${response.status}`,
      isRetryableStatus(response.status),
      response.status === 429 ? parseRetryAfterMs(response.headers.get('retry-after')) : undefined
    )
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new ProviderRequestError(`${provider.displayName} returned a non-JSON response`, true)
  }

  const phone = extractPhone(provider, json)
  return phone ? { outcome: 'found', phone } : { outcome: 'not_found' }
}
