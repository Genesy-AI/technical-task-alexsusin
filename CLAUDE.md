# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

TinyEnginy is a take-home exercise (see README.md for the full task list): a leads manager with CSV import, templated message generation and Temporal-backed email verification. Treat it as production code. The README's task section is the source of truth for the provider API specs used by the phone-enrichment feature.

The repo holds three independent pnpm projects, each with its own lockfile: `backend/`, `frontend/` and `shared/`. There is no root package.json or pnpm workspace, so run commands from inside each directory. Node version comes from each `.nvmrc` (v22).

## Commands

Backend (`cd backend`):
- `pnpm install`, then `pnpm migrate:dev` (applies Prisma migrations to the SQLite DB) and `pnpm gen:prisma`
- `temporal server start-dev`: must be running on `localhost:7233` before starting the API, because the API process also boots the worker
- `pnpm dev`: nodemon + ts-node on `src/index.ts`, port 4000
- `pnpm build`: runs `tsc`
- `pnpm test`: vitest in node env. Single file: `pnpm vitest run src/utils/messageGenerator.test.ts`. Single test: add `-t "<name>"`
- `pnpm migrate:dev --name <name>` after editing `prisma/schema.prisma`
- Settings: `cp config/appsettings.local.example.json config/appsettings.local.json` and fill in the phone provider keys. The API refuses to start with invalid or incomplete settings.
- The workflow test (`src/workflows/enrichPhoneWorkflow.test.ts`) uses `@temporalio/testing`'s time-skipping server, downloaded on first run. It does not need the dev server.

Shared (`cd shared`): `pnpm build` (tsc to `dist/`, which is gitignored), `pnpm test`. You rarely need to run these directly: `pnpm install` in backend or frontend installs and builds `shared` through `postinstall`, and their `dev`, `build` and `test` scripts rebuild it first. `pnpm vitest run` skips that rebuild, so after editing `shared/src` run `pnpm shared:build` (or `pnpm test`) before testing a consumer.

Frontend (`cd frontend`):
- `pnpm dev`: Vite. Reads `VITE_API_URL` from `frontend/.env` (`http://localhost:4000`) and throws at startup if it is unset
- `pnpm build`: `tsc -b && vite build`
- `pnpm lint`: ESLint, zero warnings allowed. Currently does not run, because the config is legacy `.eslintrc.cjs` while ESLint is v9
- `pnpm test`: vitest in jsdom with `src/test/setup.ts`. Single file: `pnpm vitest run src/utils/csvParser.test.ts`

Both projects use Prettier (`pnpm format`): no semicolons, single quotes, printWidth 110, es5 trailing commas.

## Architecture

### Shared package
- `shared/` is published to the other two projects as `@tinyenginy/shared` through `link:../shared`. Put code there when both backend and frontend need it (for example validation that runs on the client and is enforced again on the server).
- It compiles to ESM (`"type": "module"`, NodeNext, so relative imports need `.js` extensions). The CommonJS backend loads it with Node's `require(esm)`, which needs Node 22.12 or later. Keep it free of top-level `await` and runtime dependencies.
- `src/countries.ts` + `src/countryCode.ts`: the ISO 3166-1 alpha-2 country master (249 assigned codes, generated from a public dataset) and its helpers.
- `src/leadFields.ts`: parsers for the optional `phoneNumber`, `yearsAtCompany` and `linkedinUrl` fields. They return `{ ok, value | error }`, map empty values to null and normalize valid input (LinkedIn URLs become `https://www.linkedin.com/in/<handle>`).
- `src/templateFields.ts`: `LEAD_TEMPLATE_FIELDS`, the catalog of `{placeholders}` allowed in message templates (key, label, group). The backend generator and the frontend field picker both read it.

### Backend
- `src/index.ts` holds the whole Express API (every `/leads` route, inline CORS, Prisma client) and also calls `runTemporalWorker()`. One process serves both HTTP and the Temporal worker.
- Database: Prisma with SQLite at `prisma/dev.db`, which is committed. The datasource URL is hard-coded in `schema.prisma`; `.env.sample` is unused boilerplate. There is a single `lead` model.
- Temporal:
  - `src/worker.ts` registers workflows through `workflowsPath: require.resolve('./workflows')` and activities from `./workflows/activities`, on task queue `myQueue`, namespace `default`.
  - Workflows live in `src/workflows/workflows.ts` and are re-exported from `src/workflows/index.ts`. This code runs in Temporal's deterministic sandbox, so it can only import `@temporalio/workflow` and activity *types*. I/O belongs in activities (`src/workflows/activities/`, re-exported from its `index.ts`), called through `proxyActivities` with timeouts and retry policies.
  - The API reuses one Temporal client per process (`src/temporalClient.ts`).
  - `/leads/verify-emails` runs one `client.workflow.execute` per lead in parallel and responds when all of them finish. Workflow IDs are deterministic (`verify-email-<leadId>`) with `workflowIdConflictPolicy: 'USE_EXISTING'`, so concurrent requests attach to the running execution instead of starting duplicates. Once it finishes, a new request starts a new run. The activity's bounded retry policy (3 attempts, 3s `startToCloseTimeout`) guarantees the request ends in about 11s at most. A failed lead is reported in `errors` and its `emailVerified` is left untouched.
  - The `verifyEmail` activity is a mock: `john.doe` is always invalid, `jane.smith` takes 20s (so it always exhausts its retries) and any address with `+` is invalid. Keep it as is; fixes belong in the orchestration.
- Request validation: the optional fields (`countryCode`, `phoneNumber`, `yearsAtCompany`, `linkedinUrl`) go through `src/utils/leadFields.ts` → `parseOptionalLeadFields`. `/leads/bulk` rejects a row with any invalid optional value and reports all of its errors in the response's `errors` array.
- Settings (`src/config/appSettings.ts`), .NET appsettings style: `config/appsettings.json` → `appsettings.{NODE_ENV}.json` → `appsettings.local.json` (gitignored, secrets) → env vars with `__` as separator (`PhoneEnrichment__Providers__orionConnect__Auth__Secret`, matched case-insensitively). Objects merge and arrays replace. Validated with zod at startup; use `getAppSettings()`.
- Phone enrichment (`src/phoneEnrichment/`, `enrichPhoneWorkflow`):
  - Providers are pure configuration under `phoneEnrichment.providers`: url, method, auth (`header`/`query`/`none` + secret), request template (`{{fullName}}`, `{{email}}`, `{{companyWebsite}}`... from `PROVIDER_INPUT_FIELDS`), response `phonePath`, timeout, optional retry override and rate limit. `providerOrder` sets the sequence. Adding a provider that fits this shape is config only.
  - `POST /leads/enrich-phone` resolves a plan from settings (`buildPhoneEnrichmentPlan`) and starts one workflow per lead (`enrich-phone-<leadId>`, `USE_EXISTING`) with `workflow.start`, so it returns immediately. The plan travels as workflow input: running workflows are not affected by config edits.
  - The workflow queries providers in order and stops at the first valid phone. Provider calls are activities on per-provider task queues (`phone-enrichment.<id>`) whose workers apply `maxTaskQueueActivitiesPerSecond`. 4xx except 408/429 are non-retryable, and 429 honours `Retry-After`. A provider that still fails after its retries is recorded and the next one is tried. A provider whose template needs a field the lead lacks is skipped (e.g. `companyWebsite`, derived from corporate email domains only).
  - Progress is persisted on the lead (`phoneEnrichmentStatus`: pending/running/found/not_found/failed, and `phoneEnrichmentProvider` holding the display name). The frontend polls `getMany` every 2s while any lead is in progress. A found phone overwrites `phoneNumber`.
  - The real provider APIs differ from the README: Nimbus answers `{ "phoneNmbr": number, "countryCode": "ES" }`, and all of them return 500 now and then.
- Message templating: `src/utils/messageGenerator.ts` resolves `{fieldName}` tokens for the keys in the shared `LEAD_TEMPLATE_FIELDS`. An unknown key, or a field that is empty for a lead, fails that lead.

### Frontend
- React 18, Vite, Tailwind v4 (through `@tailwindcss/vite`), TanStack Query, react-hot-toast. `main.tsx` → `Providers.tsx` (QueryClient + Toaster) → `App.tsx` → `components/LeadsList.tsx`, which is the main screen and opens `CsvImportModal` and `MessageTemplateModal`.
- API layer: `src/api/modules/leads.ts` declares each endpoint with `endpoint<Output, Input>(method, path | pathBuilder)` from `src/api/utils.ts`. Request/response types live one file per endpoint in `src/api/types/leads/`, and are written by hand to mirror the backend. Components call `api.leads.*` directly inside `useQuery`/`useMutation`, using query key `['leads', 'getMany']`. `src/api/mutations/useApiMutation.ts` is a typed alternative that only has `leads.create` wired up.
- CSV import: `src/utils/csvParser.ts` parses with PapaParse (headers are trimmed and lowercased), validates each row into `CsvLead` with the shared validators (errors come both as an ordered list, `errors`, and keyed by field, `fieldErrors`), and the modal posts the valid rows to `/leads/bulk`. The backend dedupes on firstName+lastName. The preview (`components/CsvPreviewTable.tsx`) shows one row per lead with the optional fields as chips (filled, invalid or empty), plus a per-column coverage bar. Each row expands into a detail with every value and its error; invalid rows start expanded. A new optional field needs an entry in its `OPTIONAL_FIELDS`.

### Adding a lead field touches all layers
`prisma/schema.prisma` + migration → a parser in `shared/src/leadFields.ts` (if it needs validation) → `backend/src/utils/leadFields.ts` and the `/leads/bulk` handler → `LEAD_TEMPLATE_FIELDS` in `shared/src/templateFields.ts` (the template picker and generator pick it up from there) → frontend `api/types/leads/*` (including the optimistic lead in `useApiMutation.ts`) → `csvParser.ts` `CsvLead` + `OPTIONAL_FIELD_HEADERS` aliases → `OPTIONAL_FIELDS` in `CsvPreviewTable.tsx` and the import mapping in `CsvImportModal` → `LeadsList` table columns.

## Known issues
- The frontend `leads.update` sends `PUT /leads/:id`, but the backend only defines `PATCH /leads/:id`. That handler also only updates `firstName` from `name` and `email`.
- `docs/` contains the sample CSVs and the UI wireframes. `leads-ok-*.csv` and `leads-with-errors.csv` come with the exercise; their `yearsInRole` column is ignored on purpose, because years in the role are not years at the company. `leads-new-fields.csv` covers valid and invalid phone, years and LinkedIn values.
