import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyEnvOverrides, deepMerge, loadAppSettings } from './appSettings'

const provider = (overrides: Record<string, unknown> = {}) => ({
  displayName: 'Test Provider',
  url: 'https://provider.example/lookup',
  timeoutMs: 1000,
  auth: { type: 'header', name: 'x-key' },
  request: { email: '{{email}}' },
  response: { phonePath: 'phone' },
  ...overrides,
})

const baseSettings = {
  phoneEnrichment: {
    providerOrder: ['first'],
    workflowTimeoutMs: 60000,
    defaultRetry: { maximumAttempts: 3, initialIntervalMs: 1000, backoffCoefficient: 2 },
    providers: { first: provider() },
  },
}

describe('deepMerge', () => {
  it('merges objects key by key and replaces arrays and scalars', () => {
    expect(deepMerge({ a: { b: 1, c: 2 }, list: [1, 2] }, { a: { c: 3 }, list: [9] })).toEqual({
      a: { b: 1, c: 3 },
      list: [9],
    })
  })
})

describe('applyEnvOverrides', () => {
  it('sets nested values case-insensitively and coerces types', () => {
    const result = applyEnvOverrides(baseSettings, {
      PhoneEnrichment__Providers__first__Auth__Secret: 'from-env',
      PHONEENRICHMENT__WORKFLOWTIMEOUTMS: '1234',
      PhoneEnrichment__Providers__first__Enabled: 'false',
    }) as { phoneEnrichment: { workflowTimeoutMs: number; providers: { first: Record<string, any> } } }

    expect(result.phoneEnrichment.providers.first.auth).toEqual({
      type: 'header',
      name: 'x-key',
      secret: 'from-env',
    })
    expect(result.phoneEnrichment.workflowTimeoutMs).toBe(1234)
    expect(result.phoneEnrichment.providers.first.enabled).toBe(false)
  })

  it('ignores variables that do not target a settings section', () => {
    expect(applyEnvOverrides(baseSettings, { SOME__OTHER__VAR: 'x', PATH: '/bin' })).toEqual(baseSettings)
  })
})

describe('loadAppSettings', () => {
  let configDir: string

  const write = (file: string, content: unknown) =>
    writeFileSync(path.join(configDir, file), JSON.stringify(content))

  beforeEach(() => {
    configDir = mkdtempSync(path.join(tmpdir(), 'appsettings-'))
  })

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true })
  })

  it('layers base, environment and local files, then env vars', () => {
    write('appsettings.json', baseSettings)
    write('appsettings.test.json', { phoneEnrichment: { workflowTimeoutMs: 2000 } })
    write('appsettings.local.json', {
      phoneEnrichment: { providers: { first: { auth: { secret: 'local' } } } },
    })

    const settings = loadAppSettings({
      configDir,
      environment: 'test',
      env: { PhoneEnrichment__DefaultRetry__MaximumAttempts: '5' },
    })

    expect(settings.phoneEnrichment.workflowTimeoutMs).toBe(2000)
    expect(settings.phoneEnrichment.defaultRetry.maximumAttempts).toBe(5)
    const auth = settings.phoneEnrichment.providers.first.auth
    expect(auth.type === 'header' && auth.secret).toBe('local')
    expect(settings.phoneEnrichment.providers.first.method).toBe('POST')
    expect(settings.phoneEnrichment.providers.first.enabled).toBe(true)
  })

  it('fails when an enabled provider has no secret', () => {
    write('appsettings.json', baseSettings)
    expect(() => loadAppSettings({ configDir, environment: 'test', env: {} })).toThrow(
      'phoneEnrichment.providers.first.auth.secret: Missing secret for an enabled provider'
    )
  })

  it('fails on unknown providers in the order and unknown template fields', () => {
    write('appsettings.json', {
      phoneEnrichment: {
        ...baseSettings.phoneEnrichment,
        providerOrder: ['first', 'missing'],
        providers: {
          first: provider({ auth: { type: 'none' }, request: { email: '{{emial}}' } }),
        },
      },
    })

    expect(() => loadAppSettings({ configDir, environment: 'test', env: {} })).toThrow(
      /providerOrder\.1: Unknown provider "missing"[\s\S]*request\.email: Unknown template field "\{\{emial\}\}"/
    )
  })

  it('fails when the base file is missing', () => {
    expect(() => loadAppSettings({ configDir, environment: 'test', env: {} })).toThrow(
      'Missing settings file'
    )
  })
})

describe('repository settings', () => {
  it('are valid once secrets are provided', () => {
    const settings = loadAppSettings({
      environment: 'test',
      env: {
        PhoneEnrichment__Providers__orionConnect__Auth__Secret: 'x',
        PhoneEnrichment__Providers__astraDialer__Auth__Secret: 'x',
        PhoneEnrichment__Providers__nimbusLookup__Auth__Secret: 'x',
      },
    })
    expect(settings.phoneEnrichment.providerOrder).toEqual(['orionConnect', 'astraDialer', 'nimbusLookup'])
  })
})
