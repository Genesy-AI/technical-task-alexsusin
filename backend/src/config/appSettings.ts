import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { z } from 'zod'

// Lead data a provider request template can reference as {{field}}.
export const PROVIDER_INPUT_FIELDS = [
  'fullName',
  'firstName',
  'lastName',
  'email',
  'jobTitle',
  'companyName',
  'companyWebsite',
] as const
export type ProviderInputField = (typeof PROVIDER_INPUT_FIELDS)[number]

const TEMPLATE_PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g

export const templateFields = (template: string): string[] =>
  Array.from(template.matchAll(TEMPLATE_PLACEHOLDER), (match) => match[1])

const retrySchema = z.object({
  maximumAttempts: z.number().int().min(1),
  initialIntervalMs: z.number().int().positive(),
  backoffCoefficient: z.number().min(1),
  maximumIntervalMs: z.number().int().positive().optional(),
})

const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('header'), name: z.string().min(1), secret: z.string().min(1).optional() }),
  z.object({ type: z.literal('query'), name: z.string().min(1), secret: z.string().min(1).optional() }),
])

const providerSchema = z.object({
  displayName: z.string().min(1),
  enabled: z.boolean().default(true),
  url: z.string().url(),
  method: z.enum(['GET', 'POST']).default('POST'),
  timeoutMs: z.number().int().positive(),
  auth: authSchema,
  // JSON body (POST) or query parameters (GET): parameter name -> template using {{field}} placeholders.
  request: z.record(z.string(), z.string()),
  response: z.object({
    // Dot path to the phone in the JSON response, e.g. "phone" or "data.phone".
    phonePath: z.string().min(1),
  }),
  retry: retrySchema.partial().optional(),
  rateLimit: z.object({ maxRequestsPerSecond: z.number().positive() }).optional(),
})

const phoneEnrichmentSchema = z
  .object({
    providerOrder: z.array(z.string().min(1)).min(1),
    workflowTimeoutMs: z.number().int().positive(),
    defaultRetry: retrySchema,
    providers: z.record(z.string(), providerSchema),
  })
  .superRefine((settings, ctx) => {
    settings.providerOrder.forEach((id, index) => {
      const provider = settings.providers[id]
      if (!provider) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providerOrder', index],
          message: `Unknown provider "${id}"`,
        })
        return
      }
      if (provider.enabled && provider.auth.type !== 'none' && !provider.auth.secret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providers', id, 'auth', 'secret'],
          message: 'Missing secret for an enabled provider (set it in appsettings.local.json or an env var)',
        })
      }
    })
    for (const [id, provider] of Object.entries(settings.providers)) {
      for (const [param, template] of Object.entries(provider.request)) {
        for (const field of templateFields(template)) {
          if (!(PROVIDER_INPUT_FIELDS as readonly string[]).includes(field)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['providers', id, 'request', param],
              message: `Unknown template field "{{${field}}}". Available: ${PROVIDER_INPUT_FIELDS.join(', ')}`,
            })
          }
        }
      }
    }
  })

export const appSettingsSchema = z.object({
  phoneEnrichment: phoneEnrichmentSchema,
})

export type AppSettings = z.infer<typeof appSettingsSchema>
export type PhoneEnrichmentSettings = AppSettings['phoneEnrichment']
export type ProviderSettings = z.infer<typeof providerSchema>
export type RetrySettings = z.infer<typeof retrySchema>

type JsonObject = { [key: string]: unknown }

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Objects are merged key by key; arrays and scalars from `override` replace the base value. */
export function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  const result: JsonObject = { ...base }
  for (const [key, value] of Object.entries(override)) {
    result[key] =
      isObject(value) && isObject(result[key]) ? deepMerge(result[key] as JsonObject, value) : value
  }
  return result
}

const coerceEnvValue = (value: string): unknown => {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  return value
}

/**
 * .NET-style overrides: `PhoneEnrichment__Providers__orionConnect__Auth__Secret=...` sets
 * phoneEnrichment.providers.orionConnect.auth.secret. Keys match case-insensitively and only variables whose
 * first segment is a top-level settings section are considered.
 */
export function applyEnvOverrides(settings: JsonObject, env: NodeJS.ProcessEnv): JsonObject {
  const result = structuredClone(settings)
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !name.includes('__')) continue
    const segments = name.split('__')
    let node: JsonObject = result
    let matched = true
    segments.forEach((segment, index) => {
      if (!matched) return
      const existingKey = Object.keys(node).find((key) => key.toLowerCase() === segment.toLowerCase())
      if (index === 0 && !existingKey) {
        matched = false
        return
      }
      // Keys not present in any file are created in camelCase (Secret -> secret), the convention of the files.
      const key = existingKey ?? segment.charAt(0).toLowerCase() + segment.slice(1)
      if (index === segments.length - 1) {
        node[key] = coerceEnvValue(value)
      } else {
        if (!isObject(node[key])) node[key] = {}
        node = node[key] as JsonObject
      }
    })
  }
  return result
}

const readJson = (file: string): JsonObject => {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch (error) {
    throw new Error(`Invalid settings file ${file}: ${error instanceof Error ? error.message : error}`)
  }
}

export interface LoadAppSettingsOptions {
  configDir?: string
  environment?: string
  env?: NodeJS.ProcessEnv
}

/**
 * Layers, later ones win: appsettings.json -> appsettings.{environment}.json -> appsettings.local.json
 * (gitignored, for secrets) -> environment variables. The result is validated and the process should not
 * start with invalid settings.
 */
export function loadAppSettings({
  configDir = path.resolve(__dirname, '../../config'),
  environment = process.env.NODE_ENV || 'development',
  env = process.env,
}: LoadAppSettingsOptions = {}): AppSettings {
  const files = ['appsettings.json', `appsettings.${environment}.json`, 'appsettings.local.json']
  const basePath = path.join(configDir, files[0])
  if (!existsSync(basePath)) throw new Error(`Missing settings file ${basePath}`)

  const merged = files
    .map((file) => path.join(configDir, file))
    .filter((file) => existsSync(file))
    .reduce<JsonObject>((settings, file) => deepMerge(settings, readJson(file)), {})

  const parsed = appSettingsSchema.safeParse(applyEnvOverrides(merged, env))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid app settings:\n${issues.join('\n')}`)
  }
  return parsed.data
}

let cachedSettings: AppSettings | undefined

export const getAppSettings = (): AppSettings => (cachedSettings ??= loadAppSettings())
